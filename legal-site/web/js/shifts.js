import { state, ensureOrgWorkers } from './state.js'
import { apiFetch } from './api.js'
import { DAYS, MONTHS, DEPT_COLORS, DAY_FULL, AVAIL_ICONS, addDays, isSameDay, toYMD, fmtDate, getWeekStartOf, esc, getInitials, applyAvatars } from './utils.js'

let shiftsView = 'list'

const DAY_CODE = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

function getWeekViewDays() {
  const workDays = state.currentOrg?.workDays
  const result = []
  for (let i = 0; i < 7; i++) {
    const d = addDays(state.currentWeek, i)
    const code = DAY_CODE[d.getDay()]
    const include = workDays?.length ? workDays.includes(code) : (code !== 'SAT' && code !== 'SUN')
    if (include) result.push({ date: d, ymd: toYMD(d) })
  }
  return result
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDeptColor(deptId) {
  if (!deptId) return DEPT_COLORS[0]
  let hash = 0
  for (let i = 0; i < deptId.length; i++) hash = (hash * 31 + deptId.charCodeAt(i)) | 0
  return DEPT_COLORS[Math.abs(hash) % DEPT_COLORS.length]
}

function toMins(t) {
  if (!t) return 0
  const [h, m] = t.substring(0, 5).split(':').map(Number)
  return h * 60 + m
}

function normEnd(startMins, endMins) {
  return endMins <= startMins ? endMins + 1440 : endMins
}

function shiftDuration(start, end) {
  const s = toMins(start)
  const e = normEnd(s, toMins(end))
  const mins = e - s
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

const STATUS_COLORS = {
  DRAFT: '#94a3b8', PUBLISHED: '#1a2d4f', ACTIVE: '#f59e0b',
  COMPLETED: '#22c55e', CANCELLED: '#ef4444',
}

const AVAIL_PREF = {
  morning:   { color: '#f59e0b', label: 'Morning'   },
  afternoon: { color: '#f97316', label: 'Afternoon' },
  night:     { color: '#60a5fa', label: 'Night'     },
  any:       { color: '#22c55e', label: 'Any time'  },
  custom:    { color: '#3b82f6', label: 'Custom'    },
  off:       { color: '#ef4444', label: 'Day off'   },
}

let _availRosterCache = {}

// ── Week label & day tabs ─────────────────────────────────────────────────────

export function renderWeekLabel() {
  const end = addDays(state.currentWeek, 6)
  document.getElementById('week-label').textContent =
    `${state.currentWeek.getDate()} ${MONTHS[state.currentWeek.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`
}

export function renderDayTabs() {
  const today = new Date()
  const container = document.getElementById('day-tabs')
  container.innerHTML = ''
  for (let i = 0; i < 7; i++) {
    const day = addDays(state.currentWeek, i)
    const isToday  = isSameDay(day, today)
    const isActive = isSameDay(day, state.selectedDay)
    const tab = document.createElement('div')
    tab.className = `day-tab${isActive ? ' active' : ''}${isToday ? ' today' : ''}`
    tab.innerHTML = `<span>${DAYS[day.getDay()]}</span><span class="day-num">${day.getDate()}</span>`
    tab.onclick = () => {
      state.selectedDay = day
      renderDayTabs()
      if (shiftsView === 'table') renderTableView()
      else renderShiftsForDay()
    }
    container.appendChild(tab)
  }
}

// ── View toggle ───────────────────────────────────────────────────────────────

export function setShiftsView(view) {
  shiftsView = view
  document.getElementById('view-list-btn')?.classList.toggle('active',  view === 'list')
  document.getElementById('view-table-btn')?.classList.toggle('active', view === 'table')
  document.getElementById('view-week-btn')?.classList.toggle('active',  view === 'week')

  const contentArea = document.getElementById('shifts-content').parentElement
  if (view === 'list') {
    contentArea.classList.remove('content-area-flush')
    renderShiftsForDay()
  } else {
    contentArea.classList.add('content-area-flush')
    if (view === 'table') renderTableView()
    else renderWeekView()
    updateActionBar()
  }
}

// ── Week navigation ───────────────────────────────────────────────────────────

export function changeWeek(dir) {
  const candidate = addDays(state.currentWeek, dir * 7)
  state.currentWeek = getWeekStartOf(candidate, state.currentOrg?.weekStartsOn)
  _availRosterCache = {}
  const today = new Date()
  const weekEnd = addDays(state.currentWeek, 6)
  state.selectedDay = (today >= state.currentWeek && today <= weekEnd) ? today : new Date(state.currentWeek)
  renderWeekLabel()
  renderDayTabs()
  loadShifts()
}

// ── Data loading ──────────────────────────────────────────────────────────────

export async function loadShifts() {
  const key = toYMD(state.currentWeek)
  document.getElementById('shifts-content').innerHTML = '<div class="loader-inline"><div class="spinner"></div></div>'
  try {
    if (!state.shiftsCache[key]) {
      const res = await apiFetch(`/shifts?weekOf=${key}`)
      if (!res) return
      state.shiftsCache[key] = await res.json()
    }
    if (shiftsView === 'table') renderTableView()
    else if (shiftsView === 'week') renderWeekView()
    else renderShiftsForDay()
  } catch {
    document.getElementById('shifts-content').innerHTML = '<div class="empty-state"><p>Failed to load shifts.</p></div>'
  }
}

// ── List view ─────────────────────────────────────────────────────────────────

export function renderShiftsForDay() {
  const key = toYMD(state.currentWeek)
  const all = state.shiftsCache[key] || []
  const selectedYMD = toYMD(state.selectedDay)
  const dayShifts = all
    .filter(s => s.date.substring(0, 10) === selectedYMD && s.status !== 'CANCELLED')
    .sort((a, b) => a.startTime.localeCompare(b.startTime))

  const el = document.getElementById('shifts-content')

  if (dayShifts.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <p>No shifts scheduled for ${fmtDate(state.selectedDay)}</p>
        <button class="btn btn-success" style="margin-top:14px" onclick="openCreateShiftModal()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Create the first shift
        </button>
      </div>`
    updateActionBar()
    return
  }

  const groupMap = new Map()
  dayShifts.forEach(s => {
    const deptId = s.department?.id || 'unknown'
    if (!groupMap.has(deptId)) groupMap.set(deptId, { dept: s.department, shifts: [] })
    groupMap.get(deptId).shifts.push(s)
  })

  const groups = [...groupMap.entries()]
  el.innerHTML = renderDayStats(dayShifts) + `<div class="shifts-grid">${groups.map(([deptId, g], i) => deptSection(g, getDeptColor(deptId), i)).join('')}</div>`
  updateActionBar()
}

function renderDayStats(dayShifts) {
  const totalAssigned = dayShifts.reduce((s, sh) => s + (sh.assignments?.length || 0), 0)
  const totalRequired = dayShifts.reduce((s, sh) => s + (sh.requiredWorkers || 0), 0)
  const pct = totalRequired > 0 ? Math.round(totalAssigned / totalRequired * 100) : 100
  const coverageColor = pct >= 100 ? '#059669' : pct >= 60 ? '#d97706' : '#dc2626'
  return `
    <div class="day-stats">
      <div class="stat-chip">
        <span class="stat-chip-num">${dayShifts.length}</span>
        <span class="stat-chip-label">Shifts today</span>
      </div>
      <div class="stat-chip">
        <span class="stat-chip-num">${totalAssigned}</span>
        <span class="stat-chip-label">Workers assigned</span>
      </div>
      <div class="stat-chip">
        <span class="stat-chip-num" style="color:${coverageColor}">${pct}%</span>
        <span class="stat-chip-label">Coverage</span>
      </div>
    </div>`
}

function deptSection(group, color, index = 0) {
  const totalAssigned = group.shifts.reduce((sum, s) => sum + (s.assignments?.length || 0), 0)
  const totalRequired = group.shifts.reduce((sum, s) => sum + (s.requiredWorkers || 0), 0)
  const badgeColor = totalAssigned === 0 ? '#dc2626' : totalAssigned < totalRequired ? '#d97706' : color
  return `
    <div class="dept-section" style="animation-delay:${index * 0.06}s">
      <div class="dept-header" style="background:${color}10">
        <div class="dept-stripe" style="background:${color}"></div>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        <span class="dept-name" style="color:${color}">${esc(group.dept?.name || 'Unknown')}</span>
        <span class="dept-worker-badge" style="background:${badgeColor}22;color:${badgeColor}">${totalAssigned}/${totalRequired} workers</span>
      </div>
      ${group.shifts.map(s => shiftRow(s, color)).join('')}
    </div>`
}

function shiftRow(shift, color) {
  const assigned = shift.assignments || []
  const count    = assigned.length
  const required = shift.requiredWorkers || 1
  const pct      = Math.min(100, Math.round(count / required * 100))
  const workerColor = count === 0 ? '#dc2626' : count < required ? '#d97706' : '#059669'
  const workerText  = count === 0 ? 'No workers' : `${count} / ${required}`
  const understaffed = shift.understaffed ? '<span class="understaffed-badge">⚠ Understaffed</span>' : ''
  const borderColor  = STATUS_COLORS[shift.status] || '#94a3b8'
  const start = shift.startTime.substring(0, 5)
  const end   = shift.endTime.substring(0, 5)
  return `
    <div class="dept-shift-row" style="border-left:3px solid ${borderColor}" onclick="openShiftModal('${shift.id}')">
      <div class="shift-time-col">
        <span class="shift-time">${start}</span>
        <div class="shift-time-sep"></div>
        <span class="shift-time">${end}</span>
      </div>
      <div class="shift-row-body">
        <div class="shift-row-top">
          <span class="status-pill status-${shift.status}">${shift.status.toLowerCase()}</span>
          ${understaffed}
        </div>
        <div class="shift-coverage">
          <div class="coverage-bar">
            <div class="coverage-fill" style="width:${pct}%;background:${workerColor}"></div>
          </div>
          <span class="coverage-text" style="color:${workerColor}">${workerText}</span>
        </div>
      </div>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </div>`
}

// ── Table view ────────────────────────────────────────────────────────────────

export async function renderTableView() {
  const key = toYMD(state.currentWeek)
  const allShifts = state.shiftsCache[key] || []
  const selectedYMD = toYMD(state.selectedDay)
  const dayShifts = allShifts
    .filter(s => s.date.substring(0, 10) === selectedYMD && s.status !== 'CANCELLED')
    .sort((a, b) => a.startTime.localeCompare(b.startTime))

  const el = document.getElementById('shifts-content')

  if (dayShifts.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <p>No shifts scheduled for ${fmtDate(state.selectedDay)}</p>
        <button class="btn btn-success" style="margin-top:14px" onclick="openCreateShiftModal()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Create the first shift
        </button>
      </div>`
    return
  }

  // Fetch workers and week availability in parallel if needed
  if (!state.orgWorkers || !_availRosterCache[key]) {
    el.innerHTML = '<div class="loader-inline"><div class="spinner"></div></div>'
    await Promise.all([
      state.orgWorkers ? null : ensureOrgWorkers(),
      _availRosterCache[key] ? null : apiFetch(`/availability/week-roster/${key}`)
        .then(r => r?.ok ? r.json() : null)
        .then(d => { if (d) _availRosterCache[key] = d })
        .catch(() => {}),
    ].filter(Boolean))
  }

  const workers = state.orgWorkers || []
  if (workers.length === 0) {
    el.innerHTML = '<div class="empty-state"><p>No workers found in this organization.</p></div>'
    return
  }

  // Build per-worker availability prefs for the selected day
  const selectedDayFull = DAY_FULL[state.selectedDay.getDay()]
  const workerDayPrefs = new Map(
    (_availRosterCache[key] || []).map(r => {
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

  // Group by department
  const byDept = new Map()
  dayShifts.forEach(s => {
    const deptId = s.department?.id || 'unknown'
    if (!byDept.has(deptId)) byDept.set(deptId, { name: s.department?.name || 'Unknown', shifts: [] })
    byDept.get(deptId).shifts.push(s)
  })

  // ── Header row ──
  const workerCols = workers.map(w => {
    const initials = esc(getInitials(w.name))
    const pref     = workerDayPrefs.get(w.id)
    const cfg      = pref?.preference ? AVAIL_PREF[pref.preference] : null
    const isOff    = pref?.preference === 'off'
    const badge    = cfg ? `<span class="dt-avail-badge" style="background:${cfg.color}22;border-color:${cfg.color};color:${cfg.color}">${AVAIL_ICONS[pref.preference]}</span>` : ''
    const label    = cfg
      ? `<div class="dt-avail-label" style="color:${cfg.color}">${esc(pref.preference === 'custom' && pref.startTime ? `${pref.startTime}–${pref.endTime}` : cfg.label)}</div>`
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
      <tr class="dt-dept-band">
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
      const dur        = shiftDuration(s.startTime, s.endTime)
      const sStart     = toMins(s.startTime)
      const sEnd       = normEnd(sStart, toMins(s.endTime))
      const shiftMins  = sEnd - sStart

      const infoCell = `
        <td class="dt-info-cell" style="border-left:3px solid ${sColor}" onclick="openShiftModal('${s.id}')">
          <div class="dt-shift-time">${s.startTime.substring(0,5)} → ${s.endTime.substring(0,5)}</div>
          <div class="dt-shift-dur">${dur}</div>
          <div class="dt-shift-meta">
            <span style="color:${staffColor};font-weight:700">${!isFull ? '⚠ ' : ''}${assigned}/${required}</span>
            <span class="dt-status-pill" style="background:${sColor}18;color:${sColor}">${s.status.toLowerCase()}</span>
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

        let bg, clickAttr, content

        if (isAssigned) {
          bg = sColor + '18'
          clickAttr = `onclick="openShiftModal('${s.id}')"`
          content = `<div class="dt-cell-check" style="background:${sColor}">✓</div>`
        } else if (isWrongDept) {
          bg = '#f8fafc'
          clickAttr = ''
          content = `<div class="dt-cell-blocked"><span class="dt-blocked-icon">🔒</span><span class="dt-blocked-label" style="color:#94a3b8">dept</span></div>`
        } else if (isAtLimit) {
          bg = '#fff7ed'
          clickAttr = ''
          content = `<div class="dt-cell-blocked"><span class="dt-blocked-icon">🕐</span><span class="dt-blocked-label" style="color:#d97706">12h</span></div>`
        } else if (hasConflict) {
          bg = '#fff7ed'
          clickAttr = ''
          content = `<div class="dt-cell-blocked"><span class="dt-blocked-icon">🕐</span><span class="dt-blocked-label" style="color:#d97706">busy</span></div>`
        } else if (canAssign) {
          bg = 'transparent'
          clickAttr = `onclick="assignInTable('${s.id}','${w.id}')"`
          content = `<div class="dt-cell-plus">+</div>`
        } else {
          bg = 'transparent'
          clickAttr = ''
          content = `<div class="dt-cell-dash">—</div>`
        }

        return `<td class="dt-worker-cell${idx > 0 ? ' dt-row-border' : ''}" data-cell="${cellKey}" style="background:${bg};cursor:${isAssigned || canAssign ? 'pointer' : 'default'}" ${clickAttr}>${content}</td>`
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
                  <span class="dt-corner-label dt-corner-top">Workers</span>
                  <div class="dt-corner-line"></div>
                  <span class="dt-corner-label dt-corner-bottom">Shifts</span>
                </div>
              </th>
              ${workerCols}
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
      <div class="dt-legend">
        <span class="dt-legend-item"><span class="dt-legend-dot" style="background:#1a2d4f"></span>Published</span>
        <span class="dt-legend-item"><span class="dt-legend-dot" style="background:#94a3b8"></span>Draft</span>
        <span class="dt-legend-item"><span class="dt-legend-dot" style="background:#f59e0b"></span>Active</span>
        <span class="dt-legend-sep">·</span>
        <span class="dt-legend-item"><span class="dt-check-mini">✓</span> Assigned — click to view</span>
        <span class="dt-legend-item"><span class="dt-plus-mini">+</span> Click to assign</span>
        <span class="dt-legend-item" style="color:#d97706">🕐 busy / 12h = unavailable</span>
        <span class="dt-legend-item" style="color:#94a3b8">🔒 dept = wrong department</span>
        <span class="dt-legend-item" style="color:#94a3b8">— = shift full</span>
      </div>
    </div>`
  applyAvatars(el)
}

export async function assignInTable(shiftId, workerId) {
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
      cell.innerHTML = '<div class="dt-cell-plus">+</div>'
      cell.style.cursor = 'pointer'
    }
  } catch {
    cell.innerHTML = '<div class="dt-cell-plus">+</div>'
    cell.style.cursor = 'pointer'
  } finally {
    delete cell.dataset.assigning
  }
}

// ── Action bar (list view only) ───────────────────────────────────────────────

export function updateActionBar() {
  const key = toYMD(state.currentWeek)
  const all = state.shiftsCache[key] || []
  const weekActive = all.filter(s => s.status !== 'CANCELLED')
  const bar = document.getElementById('action-bar')
  if (weekActive.length === 0) { bar.style.display = 'none'; return }
  bar.style.display = 'flex'

  const showDay = shiftsView === 'list'
  ;['action-label-day', 'btn-publish-day', 'btn-unpublish-day', 'action-bar-sep'].forEach(id => {
    document.getElementById(id).style.display = showDay ? '' : 'none'
  })

  if (showDay) {
    const selectedYMD = toYMD(state.selectedDay)
    const dayShifts = weekActive.filter(s => s.date.substring(0, 10) === selectedYMD)
    document.getElementById('btn-publish-day').disabled   = !dayShifts.some(s => s.status === 'DRAFT')
    document.getElementById('btn-unpublish-day').disabled = !dayShifts.some(s => s.status === 'PUBLISHED')
  }

  const weekDraftCount = weekActive.filter(s => s.status === 'DRAFT').length
  document.getElementById('publish-week-label').textContent = `Publish week (${weekDraftCount})`
  document.getElementById('btn-publish-week').disabled  = weekDraftCount === 0
  document.getElementById('btn-unpublish-week').disabled = !weekActive.some(s => s.status === 'PUBLISHED')
}

export async function publishDay() {
  document.getElementById('btn-publish-day').disabled = true
  try {
    const res = await apiFetch('/shifts/publish-day', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: toYMD(state.selectedDay) }) })
    if (res?.ok) { delete state.shiftsCache[toYMD(state.currentWeek)]; await loadShifts() }
  } finally { updateActionBar() }
}

export async function unpublishDay() {
  document.getElementById('btn-unpublish-day').disabled = true
  try {
    const res = await apiFetch('/shifts/unpublish-day', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: toYMD(state.selectedDay) }) })
    if (res?.ok) { delete state.shiftsCache[toYMD(state.currentWeek)]; await loadShifts() }
  } finally { updateActionBar() }
}

export async function publishWeek() {
  const key = toYMD(state.currentWeek)
  const draftCount = (state.shiftsCache[key] || []).filter(s => s.status === 'DRAFT').length
  if (!confirm(`Publish ${draftCount} draft shift${draftCount !== 1 ? 's' : ''} for this week? Workers will be notified.`)) return

  const btn = document.getElementById('btn-publish-week')
  btn.disabled = true
  const label = document.getElementById('publish-week-label')
  const prevText = label.textContent
  label.textContent = 'Publishing…'

  try {
    const res = await apiFetch('/shifts/publish-week', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weekOf: key }) })
    if (res?.ok) { delete state.shiftsCache[key]; await loadShifts() }
  } finally {
    label.textContent = prevText
    updateActionBar()
  }
}

export async function unpublishWeek() {
  if (!confirm('Unpublish all published shifts for this week?')) return

  const key = toYMD(state.currentWeek)
  document.getElementById('btn-unpublish-week').disabled = true

  try {
    const res = await apiFetch('/shifts/unpublish-week', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weekOf: key }) })
    if (res?.ok) { delete state.shiftsCache[key]; await loadShifts() }
  } finally { updateActionBar() }
}

// ── Week roster view ──────────────────────────────────────────────────────────

export async function renderWeekView() {
  const key = toYMD(state.currentWeek)
  const allShifts = state.shiftsCache[key] || []
  const el = document.getElementById('shifts-content')

  if (!state.orgWorkers || !_availRosterCache[key]) {
    el.innerHTML = '<div class="loader-inline"><div class="spinner"></div></div>'
    await Promise.all([
      state.orgWorkers ? null : ensureOrgWorkers(),
      _availRosterCache[key] ? null : apiFetch(`/availability/week-roster/${key}`)
        .then(r => r?.ok ? r.json() : null)
        .then(d => { if (d) _availRosterCache[key] = d })
        .catch(() => {}),
    ].filter(Boolean))
  }

  const workers = state.orgWorkers || []
  if (workers.length === 0) {
    el.innerHTML = '<div class="empty-state"><p>No workers found.</p></div>'
    return
  }

  const weekDays = getWeekViewDays()
  const today    = new Date()

  const shiftsByDay = new Map()
  allShifts.filter(s => s.status !== 'CANCELLED').forEach(s => {
    const ymd = s.date.substring(0, 10)
    if (!shiftsByDay.has(ymd)) shiftsByDay.set(ymd, [])
    shiftsByDay.get(ymd).push(s)
  })

  const workerAvail = new Map(
    (_availRosterCache[key] || []).map(r => {
      const m = new Map()
      if (r.availability) (r.availability.slots || []).forEach(s => m.set(s.day, s.preference))
      return [r.worker.id, m]
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

  // Group workers by their actual department memberships (w.departmentIds from API)
  const unassigned = []
  workers.forEach(w => {
    const deptIds = w.departmentIds || []
    const activeDeptId = deptIds.find(id => deptMap.has(id)) // prefer a dept that has shifts this week
    if (activeDeptId) {
      deptMap.get(activeDeptId).workers.push(w)
    } else if (deptIds.length > 0) {
      // Worker has dept memberships but none have shifts this week — still show worker
      const [firstId] = deptIds
      if (!deptMap.has(firstId)) {
        // No shifts for this dept this week, skip creating an empty section; put in unassigned
        unassigned.push(w)
      } else {
        deptMap.get(firstId).workers.push(w)
      }
    } else {
      unassigned.push(w)
    }
  })
  const deptGroups = [...deptMap.values()].sort((a, b) => a.dept.name.localeCompare(b.dept.name))
  if (unassigned.length) deptGroups.push({ dept: null, workers: unassigned })

  const colSpan = weekDays.length + 1

  function workerRow(w, deptId = null) {
    const initials = esc(getInitials(w.name))
    const cells = weekDays.map(({ date, ymd }) => {
      const dayShifts = (shiftsByDay.get(ymd) || [])
        .filter(s => deptId === null || s.department?.id === deptId)
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
      const isOff = workerAvail.get(w.id)?.get(DAY_FULL[date.getDay()]) === 'off'

      if (dayShifts.length === 0) {
        return `<td class="wv-cell${isOff ? ' wv-cell-off' : ''}"><span class="wv-empty">—</span></td>`
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
          return `<div class="wv-pill wv-pill-assigned" style="background:${dColor};border-color:${dColor}" onclick="openShiftModal('${s.id}')">
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

        return `<div class="wv-pill wv-pill-open" data-assign="${s.id}::${w.id}" onclick="assignInWeekView('${s.id}','${w.id}')">
          <span class="wv-pill-plus">+</span>
          <span class="wv-pill-time">${start}–${end}</span>
        </div>`
      }).filter(Boolean).join('')

      return `<td class="wv-cell${isOff ? ' wv-cell-off' : ''}">${pills || '<span class="wv-empty">—</span>'}</td>`
    }).join('')

    return `<tr>
      <td class="wv-worker-cell">
        <div class="wv-worker-avatar" data-avatar="${esc(w.avatarUrl || '')}">${initials}</div>
        <div class="wv-worker-name">${esc(w.name.split(' ')[0])}</div>
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
          <span>Unassigned this week</span>
        </td></tr>`
    const emptyRow = grp.length === 0
      ? `<tr><td colspan="${colSpan}" class="wv-dept-empty">No workers assigned to this department yet</td></tr>`
      : ''
    return band + emptyRow + grp.map(w => workerRow(w, dept?.id ?? null)).join('')
  }).join('')

  el.innerHTML = `
    <div class="wv-outer">
      <div class="wv-scroll">
        <table class="wv-table">
          <thead><tr>
            <th class="wv-corner">Workers</th>
            ${dayHeaders}
          </tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    </div>`
  applyAvatars(el)
}

export async function assignInWeekView(shiftId, workerId) {
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
      pill.innerHTML = prev
      pill.style.pointerEvents = ''
      delete pill.dataset.assigning
    }
  } catch {
    pill.innerHTML = prev
    pill.style.pointerEvents = ''
    delete pill.dataset.assigning
  }
}

window.changeWeek       = changeWeek
window.publishDay       = publishDay
window.unpublishDay     = unpublishDay
window.publishWeek      = publishWeek
window.unpublishWeek    = unpublishWeek
window.setShiftsView    = setShiftsView
window.assignInTable    = assignInTable
window.assignInWeekView = assignInWeekView
