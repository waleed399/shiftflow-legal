// Day-roster table view — shifts down the side, workers across the top, one
// cell per shift × worker. Clicking a "+" cell assigns the worker; blocked
// cells show the reason (over 12h, conflict, wrong department, full shift).
//
// Public surface:
//   renderTableView, assignInTable

import { state, ensureOrgWorkers } from './state.js'
import { apiFetch } from './api.js'
import { DAY_FULL, AVAIL_ICONS, toYMD, fmtDate, esc, getInitials, applyAvatars, showToast } from './utils.js'
import { t } from './i18n.js'
import { requireWebManage } from './profile.js'
import {
  loadShifts,
  STATUS_COLORS,
  getDeptColor,
  availPref,
  applyShiftFilters,
  getActiveFilters,
  toMins,
  normEnd,
  shiftDuration,
  getAvailRosterCache,
} from './shifts.js'
import { renderFilterBar } from './shiftsFilterBar.js'
import { syncViewChrome } from './shifts.js'
import { applyColumnStretch } from './shiftsTableFit.js'

export async function renderTableView() {
  const key = toYMD(state.currentWeek)
  const allShifts = state.shiftsCache[key] || []
  const selectedYMD = toYMD(state.selectedDay)
  const dayShifts = allShifts
    .filter(s => s.date.substring(0, 10) === selectedYMD && s.status !== 'CANCELLED')
    .sort((a, b) => a.startTime.localeCompare(b.startTime))

  const el = document.getElementById('shifts-content')

  renderFilterBar(dayShifts)

  if (dayShifts.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <p>${t('shifts.noShiftsForDay', { date: fmtDate(state.selectedDay) })}</p>
        <button class="btn btn-success" style="margin-top:14px" onclick="openCreateShiftModal()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          ${t('shifts.createFirst')}
        </button>
      </div>`
    syncViewChrome()
    return
  }

  // Fetch workers and week availability in parallel if needed
  const availCache = getAvailRosterCache()
  if (!state.orgWorkers || !availCache[key]) {
    el.innerHTML = '<div class="loader-inline"><div class="spinner"></div></div>'
    await Promise.all([
      state.orgWorkers ? null : ensureOrgWorkers(),
      availCache[key] ? null : apiFetch(`/availability/week-roster/${key}`)
        .then(r => r?.ok ? r.json() : null)
        .then(d => { if (d) availCache[key] = d })
        .catch(() => {}),
    ].filter(Boolean))
  }

  const workers = state.orgWorkers || []
  if (workers.length === 0) {
    el.innerHTML = `<div class="empty-state"><p>${t('shifts.noWorkersFound')}</p></div>`
    syncViewChrome()
    return
  }

  // Build per-worker availability prefs for the selected day
  const selectedDayFull = DAY_FULL[state.selectedDay.getDay()]
  const workerDayPrefs = new Map(
    (availCache[key] || []).map(r => {
      if (!r.availability) return [r.worker.id, null]
      const slot = (r.availability.slots || []).find(s => s.day === selectedDayFull)
      return [r.worker.id, slot
        ? { preference: slot.preference, startTime: slot.startTime, endTime: slot.endTime }
        : { preference: 'off' }
      ]
    })
  )

  // Pre-compute each worker's time ranges for conflict detection
  const workerMinsMap  = new Map() // workerId → total assigned minutes today
  const workerRangeMap = new Map() // workerId → [{startMins, endMins, shiftId}]
  dayShifts.forEach(s => {
    const sStart = toMins(s.startTime)
    const sEnd   = normEnd(sStart, toMins(s.endTime))
    ;(s.assignments || []).forEach(a => {
      const wid    = a.worker?.id || a.id
      const aStart = a.blockStart ? toMins(a.blockStart) : sStart
      const aEnd   = a.blockEnd   ? normEnd(aStart, toMins(a.blockEnd)) : sEnd
      workerMinsMap.set(wid, (workerMinsMap.get(wid) || 0) + (aEnd - aStart))
      const ranges = workerRangeMap.get(wid) || []
      ranges.push({ startMins: aStart, endMins: aEnd, shiftId: s.id })
      workerRangeMap.set(wid, ranges)
    })
  })

  // Group by department (apply active filters)
  const filteredDayShifts = applyShiftFilters(dayShifts)
  if (filteredDayShifts.length === 0 && getActiveFilters().size > 0) {
    el.innerHTML = `
      <div class="empty-state" style="padding-top:40px">
        <p style="color:var(--muted)">${t('shifts.filterNoMatch')}</p>
        <button class="btn-link" style="margin-top:8px" onclick="clearShiftFilters()">${t('shifts.filterClearLink')}</button>
      </div>`
    syncViewChrome()
    return
  }
  const byDept = new Map()
  filteredDayShifts.forEach(s => {
    const deptId = s.department?.id || 'unknown'
    if (!byDept.has(deptId)) byDept.set(deptId, { name: s.department?.name || t('common.unknown'), shifts: [] })
    byDept.get(deptId).shifts.push(s)
  })

  // ── Header row ──
  const workerCols = workers.map(w => {
    const initials = esc(getInitials(w.name))
    const pref     = workerDayPrefs.get(w.id)
    // Slots may have an explicit preference, or just startTime/endTime (treat as custom).
    const prefKey  = pref?.preference || (pref?.startTime && pref?.endTime ? 'custom' : null)
    const cfg      = prefKey ? availPref(prefKey) : null
    const isOff    = prefKey === 'off'
    const badge    = cfg ? `<span class="dt-avail-badge" style="background:${cfg.color}22;border-color:${cfg.color};color:${cfg.color}">${AVAIL_ICONS[prefKey]}</span>` : ''
    const label    = cfg
      ? `<div class="dt-avail-label" style="color:${cfg.color}">${esc(prefKey === 'custom' && pref.startTime ? `${pref.startTime}–${pref.endTime}` : cfg.label)}</div>`
      : ''
    return `
      <th class="dt-worker-th">
        <div class="dt-worker-avatar-wrap">
          <div class="dt-worker-avatar${isOff ? ' dt-avail-off' : ''}" data-avatar="${esc(w.avatarUrl || '')}">${initials}</div>
          ${badge}
        </div>
        <div class="dt-worker-name">${esc(w.name.split(' ')[0])}</div>
        ${label}
      </th>`
  }).join('')

  // ── Body rows ──
  const bodyRows = [...byDept.entries()].map(([deptId, dept]) => {
    const bandRow = `
      <tr class="dt-dept-band" style="--dept:${getDeptColor(deptId)}">
        <td class="dt-info-cell dt-dept-label">${esc(dept.name)}</td>
        ${workers.map(() => '<td class="dt-dept-spacer"></td>').join('')}
      </tr>`

    const shiftRows = dept.shifts.map((s, idx) => {
      const assigned = (s.assignments || []).length
      const required = s.requiredWorkers || 0
      const isFull   = assigned >= required
      const isEmpty  = assigned === 0
      const staffColor = isFull ? '#22c55e' : isEmpty ? '#ef4444' : '#f59e0b'
      const sColor     = STATUS_COLORS[s.status] || '#94a3b8'
      // The box is striped by DEPARTMENT, not status. A generated draft should
      // look like the department it belongs to, which is how a manager scans
      // the roster; the status pill beside it still says draft or published, so
      // nothing is lost by giving the stripe to the more useful signal.
      const dColor     = getDeptColor(s.department?.id)
      const dur        = shiftDuration(s.startTime, s.endTime)
      const sStart     = toMins(s.startTime)
      const sEnd       = normEnd(sStart, toMins(s.endTime))
      const shiftMins  = sEnd - sStart

      const infoCell = `
        <td class="dt-info-cell" style="border-left:3px solid ${dColor}" onclick="openShiftModal('${s.id}')">
          <div class="dt-shift-time">${s.startTime.substring(0,5)} → ${s.endTime.substring(0,5)}</div>
          <div class="dt-shift-dur">${dur}</div>
          <div class="dt-shift-meta">
            <span style="color:${staffColor};font-weight:700">${!isFull ? '⚠ ' : ''}${assigned}/${required}</span>
            <span class="dt-status-pill" style="background:${sColor}18;color:${sColor}">${t(`shifts.status.${s.status}`)}</span>
          </div>
        </td>`

      const workerCells = workers.map(w => {
        const isAssigned   = (s.assignments || []).some(a => (a.worker?.id || a.id) === w.id)
        const wMins        = workerMinsMap.get(w.id) || 0
        const isAtLimit    = !isAssigned && (wMins + shiftMins > 720)
        const ranges       = workerRangeMap.get(w.id) || []
        const hasConflict  = !isAssigned && ranges.some(r => r.shiftId !== s.id && r.startMins < sEnd && r.endMins > sStart)
        const deptIds      = w.departmentIds || []
        const isWrongDept  = !isAssigned && s.department?.id && deptIds.length > 0 && !deptIds.includes(s.department.id)
        const isBlocked    = isAtLimit || hasConflict || isWrongDept
        const canAssign    = !isAssigned && !isFull && !isBlocked
        const cellKey      = `${s.id}::${w.id}`

        let bgCls = '', bgStyle = '', clickAttr, content

        if (isAssigned) {
          bgStyle = `background:${sColor}18`
          clickAttr = `onclick="openShiftModal('${s.id}')"`
          content = `<div class="dt-cell-check" style="background:${sColor}">✓</div>`
        } else if (isWrongDept) {
          bgCls = ' dt-cell-wrong-dept'
          clickAttr = ''
          content = `<div class="dt-cell-blocked"><span class="dt-blocked-icon">🔒</span><span class="dt-blocked-label dt-blocked-muted">${t('shifts.cell.dept')}</span></div>`
        } else if (isAtLimit) {
          bgCls = ' dt-cell-limit'
          clickAttr = ''
          content = `<div class="dt-cell-blocked"><span class="dt-blocked-icon">🕐</span><span class="dt-blocked-label dt-blocked-warn">${t('shifts.cell.twelveH')}</span></div>`
        } else if (hasConflict) {
          bgCls = ' dt-cell-limit'
          clickAttr = ''
          content = `<div class="dt-cell-blocked"><span class="dt-blocked-icon">🕐</span><span class="dt-blocked-label dt-blocked-warn">${t('shifts.cell.busy')}</span></div>`
        } else if (canAssign) {
          // The whole cell is the click target, so the whole cell carries the
          // affordance. The + is just its label.
          bgCls = ' dt-cell-open'
          clickAttr = `onclick="assignInTable('${s.id}','${w.id}')"`
          content = `<div class="dt-cell-plus">+</div>`
        } else {
          clickAttr = ''
          content = `<div class="dt-cell-dash">—</div>`
        }

        return `<td class="dt-worker-cell${idx > 0 ? ' dt-row-border' : ''}${bgCls}" data-cell="${cellKey}" style="${bgStyle};cursor:${isAssigned || canAssign ? 'pointer' : 'default'}" ${clickAttr}>${content}</td>`
      }).join('')

      return `<tr>${infoCell}${workerCells}</tr>`
    }).join('')

    return bandRow + shiftRows
  }).join('')

  el.innerHTML = `
    <div class="dt-outer">
      <div class="dt-scroll-wrap">
        <table class="dt-table">
          <thead>
            <tr>
              <th class="dt-corner">
                <div class="dt-corner-inner">
                  <span class="dt-corner-label dt-corner-top">${t('shifts.cell.workers')}</span>
                  <div class="dt-corner-line"></div>
                  <span class="dt-corner-label dt-corner-bottom">${t('shifts.cell.shiftsCorner')}</span>
                </div>
              </th>
              ${workerCols}
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
      <div class="dt-legend">
        <span class="dt-legend-item"><span class="dt-legend-dot" style="background:#1a2d4f"></span>${t('shifts.legend.published')}</span>
        <span class="dt-legend-item"><span class="dt-legend-dot" style="background:#94a3b8"></span>${t('shifts.legend.draft')}</span>
        <span class="dt-legend-item"><span class="dt-legend-dot" style="background:#f59e0b"></span>${t('shifts.legend.active')}</span>
        <span class="dt-legend-sep">·</span>
        <span class="dt-legend-item"><span class="dt-check-mini">✓</span> ${t('shifts.legend.assigned')}</span>
        <span class="dt-legend-item"><span class="dt-plus-mini">+</span> ${t('shifts.legend.clickToAssign')}</span>
        <span class="dt-legend-item" style="color:#d97706">${t('shifts.legend.busyOrLimit')}</span>
        <span class="dt-legend-item" style="color:#94a3b8">${t('shifts.legend.wrongDept')}</span>
        <span class="dt-legend-item" style="color:#94a3b8">${t('shifts.legend.shiftFull')}</span>
      </div>
    </div>`
  applyAvatars(el)
  applyColumnStretch()
  syncViewChrome()
}

export async function assignInTable(shiftId, workerId) {
  if (!requireWebManage()) return
  const cellKey = `${shiftId}::${workerId}`
  const cell = document.querySelector(`[data-cell="${cellKey}"]`)
  if (!cell || cell.dataset.assigning) return
  cell.dataset.assigning = '1'
  cell.innerHTML = '<div class="dt-cell-loading"><div class="spinner" style="width:18px;height:18px;border-width:2px"></div></div>'
  cell.style.cursor = 'default'

  try {
    const res = await apiFetch(`/shifts/${shiftId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workerId }),
    })
    if (res?.ok) {
      delete state.shiftsCache[toYMD(state.currentWeek)]
      await loadShifts()
    } else {
      const d = await res?.json().catch(() => ({}))
      showToast(d?.error || t('shifts.failedAssign'))
      cell.innerHTML = '<div class="dt-cell-plus">+</div>'
      cell.style.cursor = 'pointer'
    }
  } catch {
    showToast(t('common.networkError'))
    cell.innerHTML = '<div class="dt-cell-plus">+</div>'
    cell.style.cursor = 'pointer'
  } finally {
    delete cell.dataset.assigning
  }
}
