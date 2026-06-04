// Week roster view — workers down the side, days across the top. Each cell
// shows the worker's shifts that day (✓ for assigned, "+" pill for open slots
// the worker can fill). Honors availability prefs, conflicts, dept membership.
//
// Public surface:
//   renderWeekView, assignInWeekView

import { state, ensureOrgWorkers } from './state.js'
import { apiFetch } from './api.js'
import { DAYS, DAY_FULL, AVAIL_ICONS, isSameDay, toYMD, esc, getInitials, applyAvatars, showToast } from './utils.js'
import { t } from './i18n.js'
import { requireWebManage } from './profile.js'
import {
  loadShifts,
  getDeptColor,
  getWeekViewDays,
  STATUS_COLORS,
  availPref,
  applyShiftFilters,
  toMins,
  normEnd,
  getAvailRosterCache,
} from './shifts.js'
import { renderFilterBar } from './shiftsListView.js'

export async function renderWeekView() {
  const key = toYMD(state.currentWeek)
  const allShifts = state.shiftsCache[key] || []
  const el = document.getElementById('shifts-content')

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
    el.innerHTML = `<div class="empty-state"><p>${t('shifts.noWorkersFoundShort')}</p></div>`
    return
  }

  const weekDays = getWeekViewDays()
  const today    = new Date()

  const allActiveShifts = allShifts.filter(s => s.status !== 'CANCELLED')
  renderFilterBar(allActiveShifts)

  const shiftsByDay = new Map()
  const workerWeekMins = new Map()
  allActiveShifts.forEach(s => {
    const ymd = s.date.substring(0, 10)
    if (!shiftsByDay.has(ymd)) shiftsByDay.set(ymd, [])
    shiftsByDay.get(ymd).push(s)
    const sStart = toMins(s.startTime)
    const sEnd   = normEnd(sStart, toMins(s.endTime))
    ;(s.assignments || []).forEach(a => {
      const wid    = a.worker?.id || a.id
      const aStart = a.blockStart ? toMins(a.blockStart) : sStart
      const aEnd   = a.blockEnd   ? normEnd(aStart, toMins(a.blockEnd)) : sEnd
      workerWeekMins.set(wid, (workerWeekMins.get(wid) || 0) + (aEnd - aStart))
    })
  })

  const workerAvail = new Map(
    (availCache[key] || []).map(r => {
      const slots = new Map()
      ;(r.availability?.slots || []).forEach(s => slots.set(s.day, {
        preference: s.preference,
        startTime: s.startTime,
        endTime: s.endTime,
      }))
      return [r.worker.id, { hasAvail: !!r.availability, slots }]
    })
  )

  const dayHeaders = weekDays.map(({ date }) => {
    const isToday = isSameDay(date, today)
    return `<th class="wv-day-th${isToday ? ' wv-today' : ''}">
      <div class="wv-day-name">${DAYS[date.getDay()]}</div>
      <div class="wv-day-num">${date.getDate()}</div>
    </th>`
  }).join('')

  // Seed dept sections from shifts — every dept with shifts this week gets a band
  const deptMap = new Map() // deptId → {dept, workers[]}
  allShifts.filter(s => s.status !== 'CANCELLED' && s.department).forEach(s => {
    if (!deptMap.has(s.department.id)) deptMap.set(s.department.id, { dept: s.department, workers: [] })
  })

  // Group workers by department memberships:
  // • No memberships (no restrictions) → appears in every dept section
  // • Has memberships → appears in each dept section they belong to that has shifts this week
  // • Has memberships but none have shifts this week → Unassigned
  const unassigned = []
  workers.forEach(w => {
    const deptIds = w.departmentIds || []
    if (deptIds.length === 0) {
      deptMap.forEach(entry => entry.workers.push(w))
    } else {
      let placed = false
      deptIds.forEach(id => { if (deptMap.has(id)) { deptMap.get(id).workers.push(w); placed = true } })
      if (!placed) unassigned.push(w)
    }
  })
  const deptGroups = [...deptMap.values()].sort((a, b) => a.dept.name.localeCompare(b.dept.name))
  if (unassigned.length) deptGroups.push({ dept: null, workers: unassigned })

  const colSpan = weekDays.length + 1

  function workerRow(w, deptId = null, rowIdx = 0) {
    const initials = esc(getInitials(w.name))
    const altCls   = rowIdx % 2 === 1 ? ' wv-row-alt' : ''
    const cells = weekDays.map(({ date, ymd }) => {
      const dayShifts = applyShiftFilters(
        (shiftsByDay.get(ymd) || [])
          .filter(s => deptId === null || s.department?.id === deptId)
          .sort((a, b) => a.startTime.localeCompare(b.startTime))
      )

      const dayFull = DAY_FULL[date.getDay()]
      const avail   = workerAvail.get(w.id)
      const slot    = avail?.hasAvail ? (avail.slots.get(dayFull) || { preference: 'off' }) : null
      const prefKey = slot?.preference || (slot?.startTime && slot?.endTime ? 'custom' : null)
      const showChip = prefKey && prefKey !== 'any'
      const cfg     = showChip ? availPref(prefKey) : null
      const isOff   = prefKey === 'off'
      const isToday = isSameDay(date, today)
      const availChip = cfg
        ? `<div class="wv-avail-chip" style="background:${cfg.color}1A;border-color:${cfg.color}66;color:${cfg.color}">
            <span class="wv-avail-icon">${AVAIL_ICONS[prefKey]}</span>
            <span class="wv-avail-label">${esc(prefKey === 'custom' && slot.startTime ? `${slot.startTime.substring(0,5)}–${slot.endTime.substring(0,5)}` : cfg.label)}</span>
          </div>`
        : ''
      const cellCls = `wv-cell${isOff ? ' wv-cell-off' : ''}${isToday ? ' wv-cell-today' : ''}`

      if (dayShifts.length === 0) {
        return `<td class="${cellCls}">${availChip}${availChip ? '' : '<span class="wv-empty">—</span>'}</td>`
      }

      const assignedIds = new Set(
        dayShifts.filter(s => (s.assignments || []).some(a => (a.worker?.id || a.id) === w.id)).map(s => s.id)
      )
      const assignedRanges = dayShifts
        .filter(s => assignedIds.has(s.id))
        .map(s => {
          const a  = (s.assignments || []).find(a => (a.worker?.id || a.id) === w.id)
          const sS = toMins(s.startTime)
          const aS = a?.blockStart ? toMins(a.blockStart) : sS
          const aE = a?.blockEnd   ? normEnd(aS, toMins(a.blockEnd)) : normEnd(sS, toMins(s.endTime))
          return { startMins: aS, endMins: aE }
        })

      const pills = dayShifts.map(s => {
        const start  = s.startTime.substring(0, 5)
        const end    = s.endTime.substring(0, 5)
        const dColor = getDeptColor(s.department?.id)
        const sColor = STATUS_COLORS[s.status] || '#94a3b8'

        if (assignedIds.has(s.id)) {
          return `<div class="wv-pill wv-pill-assigned" style="background:${dColor};border-color:${dColor}" onclick="openShiftModal('${s.id}')" role="button" tabindex="0">
            <span class="wv-pill-check">✓</span>
            <span class="wv-pill-time">${start}–${end}</span>
            <span class="wv-pill-status" style="background:${sColor}"></span>
          </div>`
        }

        const isFull      = (s.assignments || []).length >= (s.requiredWorkers || 1)
        if (isFull) return null
        const sStart      = toMins(s.startTime)
        const sEnd        = normEnd(sStart, toMins(s.endTime))
        const hasConflict = assignedRanges.some(r => r.startMins < sEnd && r.endMins > sStart)
        if (hasConflict) return null
        const wDeptIds    = w.departmentIds || []
        const isWrongDept = s.department?.id && wDeptIds.length > 0 && !wDeptIds.includes(s.department.id)
        if (isWrongDept) return null

        return `<div class="wv-pill wv-pill-open" data-assign="${s.id}::${w.id}" onclick="assignInWeekView('${s.id}','${w.id}')" role="button" tabindex="0">
          <span class="wv-pill-plus">+</span>
          <span class="wv-pill-time">${start}–${end}</span>
        </div>`
      }).filter(Boolean).join('')

      return `<td class="${cellCls}">${availChip}${pills || (availChip ? '' : '<span class="wv-empty">—</span>')}</td>`
    }).join('')

    const weekMins = workerWeekMins.get(w.id) || 0
    const hoursLabel = weekMins
      ? (weekMins % 60 === 0 ? `${weekMins / 60}h` : `${Math.floor(weekMins / 60)}h ${weekMins % 60}m`)
      : ''

    return `<tr class="wv-worker-row${altCls}">
      <td class="wv-worker-cell">
        <div class="wv-worker-avatar" data-avatar="${esc(w.avatarUrl || '')}">${initials}</div>
        <div class="wv-worker-info">
          <div class="wv-worker-name">${esc(w.name.split(' ')[0])}</div>
          ${hoursLabel ? `<div class="wv-worker-mins">${hoursLabel}</div>` : ''}
        </div>
      </td>
      ${cells}
    </tr>`
  }

  const bodyRows = deptGroups.map(({ dept, workers: grp }) => {
    const color = getDeptColor(dept?.id)
    const band  = dept
      ? `<tr class="wv-dept-band"><td colspan="${colSpan}" class="wv-dept-label">
          <span class="wv-dept-stripe" style="background:${color}"></span>
          <span style="color:${color}">${esc(dept.name)}</span>
        </td></tr>`
      : `<tr class="wv-dept-band"><td colspan="${colSpan}" class="wv-dept-label wv-dept-unassigned">
          <span class="wv-dept-stripe" style="background:#94a3b8"></span>
          <span>${t('shifts.unassignedThisWeek')}</span>
        </td></tr>`
    const emptyRow = grp.length === 0
      ? `<tr><td colspan="${colSpan}" class="wv-dept-empty">${t('shifts.deptNoWorkers')}</td></tr>`
      : ''
    return band + emptyRow + grp.map((w, i) => workerRow(w, dept?.id ?? null, i)).join('')
  }).join('')

  el.innerHTML = `
    <div class="wv-outer">
      <div class="wv-scroll">
        <table class="wv-table">
          <thead><tr>
            <th class="wv-corner">${t('shifts.cell.workers')}</th>
            ${dayHeaders}
          </tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    </div>`
  applyAvatars(el)
}

export async function assignInWeekView(shiftId, workerId) {
  if (!requireWebManage()) return
  const pill = document.querySelector(`.wv-pill-open[data-assign="${shiftId}::${workerId}"]`)
  if (!pill || pill.dataset.assigning) return
  pill.dataset.assigning = '1'
  const prev = pill.innerHTML
  pill.innerHTML = '<div class="spinner" style="width:12px;height:12px;border-width:2px"></div>'
  pill.style.pointerEvents = 'none'

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
      pill.innerHTML = prev
      pill.style.pointerEvents = ''
      delete pill.dataset.assigning
    }
  } catch {
    showToast(t('common.networkError'))
    pill.innerHTML = prev
    pill.style.pointerEvents = ''
    delete pill.dataset.assigning
  }
}
