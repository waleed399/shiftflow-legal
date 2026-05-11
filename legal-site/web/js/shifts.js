import { state } from './state.js'
import { apiFetch } from './api.js'
import { DAYS, MONTHS, DEPT_COLORS, addDays, isSameDay, toYMD, fmtDate, getWeekStartOf } from './utils.js'

let shiftsView = 'list'

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
  const listBtn  = document.getElementById('view-list-btn')
  const tableBtn = document.getElementById('view-table-btn')
  if (listBtn)  listBtn.classList.toggle('active',  view === 'list')
  if (tableBtn) tableBtn.classList.toggle('active', view === 'table')

  const contentArea = document.getElementById('shifts-content').parentElement
  if (view === 'table') {
    document.getElementById('action-bar').style.display = 'none'
    contentArea.classList.add('content-area-flush')
    renderTableView()
  } else {
    contentArea.classList.remove('content-area-flush')
    renderShiftsForDay()
  }
}

// ── Week navigation ───────────────────────────────────────────────────────────

export function changeWeek(dir) {
  const candidate = addDays(state.currentWeek, dir * 7)
  state.currentWeek = getWeekStartOf(candidate, state.currentOrg?.weekStartsOn)
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
    else renderShiftsForDay()
  } catch {
    document.getElementById('shifts-content').innerHTML = '<div class="empty-state"><p>Failed to load shifts.</p></div>'
  }
}

async function ensureOrgWorkers() {
  if (state.orgWorkers) return
  const res = await apiFetch('/organization/members')
  if (!res) return
  const all = await res.json()
  state.orgWorkers = all.filter(w => w.role === 'WORKER').sort((a, b) => a.name.localeCompare(b.name))
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
  el.innerHTML = `<div class="shifts-grid">${groups.map(([deptId, g]) => deptSection(g, getDeptColor(deptId))).join('')}</div>`
  updateActionBar()
}

function deptSection(group, color) {
  const totalAssigned = group.shifts.reduce((sum, s) => sum + (s.assignments?.length || 0), 0)
  const totalRequired = group.shifts.reduce((sum, s) => sum + (s.requiredWorkers || 0), 0)
  const badgeColor = totalAssigned === 0 ? '#ef4444' : totalAssigned < totalRequired ? '#f59e0b' : color
  return `
    <div class="dept-section" style="border-color:${color}40;box-shadow:0 4px 12px ${color}18">
      <div class="dept-header" style="background:${color}12">
        <div class="dept-stripe" style="background:${color}"></div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        <span class="dept-name" style="color:${color}">${group.dept?.name || 'Unknown'}</span>
        <span class="dept-worker-badge" style="background:${badgeColor}20;color:${badgeColor}">${totalAssigned}/${totalRequired} workers</span>
      </div>
      ${group.shifts.map(s => shiftRow(s, color)).join('')}
    </div>`
}

function shiftRow(shift, color) {
  const assigned = shift.assignments || []
  const count = assigned.length
  const required = shift.requiredWorkers
  const workerColor = count === 0 ? '#ef4444' : count < required ? '#f59e0b' : '#94a3b8'
  const workerText = count === 0 ? 'No workers assigned' : `${count} / ${required} workers`
  const understaffed = shift.understaffed ? '<span class="understaffed-badge">⚠ Understaffed</span>' : ''
  return `
    <div class="dept-shift-row" style="border-bottom-color:${color}18" onclick="openShiftModal('${shift.id}')">
      <div class="shift-time-col" style="min-width:68px">
        <span class="shift-time">${shift.startTime}</span>
        <div class="shift-time-sep"></div>
        <span class="shift-time">${shift.endTime}</span>
      </div>
      <div class="shift-row-body">
        <div class="shift-row-top">
          <span class="status-pill status-${shift.status}">${shift.status.toLowerCase()}</span>
          ${understaffed}
        </div>
        <div class="shift-workers-row" style="color:${workerColor}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <span>${workerText}</span>
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
      </div>`
    return
  }

  // Fetch workers if not yet loaded
  if (!state.orgWorkers) {
    el.innerHTML = '<div class="loader-inline"><div class="spinner"></div></div>'
    await ensureOrgWorkers()
  }

  const workers = state.orgWorkers || []
  if (workers.length === 0) {
    el.innerHTML = '<div class="empty-state"><p>No workers found in this organization.</p></div>'
    return
  }

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
    const initials = w.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
    return `
      <th class="dt-worker-th">
        <div class="dt-worker-avatar">${initials}</div>
        <div class="dt-worker-name">${w.name.split(' ')[0]}</div>
      </th>`
  }).join('')

  // ── Body rows ──
  const bodyRows = [...byDept.entries()].map(([deptId, dept]) => {
    const bandRow = `
      <tr class="dt-dept-band">
        <td class="dt-info-cell dt-dept-label">${dept.name}</td>
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
        const isAssigned  = (s.assignments || []).some(a => (a.worker?.id || a.id) === w.id)
        const wMins       = workerMinsMap.get(w.id) || 0
        const isAtLimit   = !isAssigned && (wMins + shiftMins > 720)
        const ranges      = workerRangeMap.get(w.id) || []
        const hasConflict = !isAssigned && ranges.some(r => r.shiftId !== s.id && r.startMins < sEnd && r.endMins > sStart)
        const isBlocked   = isAtLimit || hasConflict
        const canAssign   = !isAssigned && !isFull && !isBlocked
        const cellKey     = `${s.id}::${w.id}`

        let bg, clickAttr, content

        if (isAssigned) {
          bg = sColor + '18'
          clickAttr = `onclick="openShiftModal('${s.id}')"`
          content = `<div class="dt-cell-check" style="background:${sColor}">✓</div>`
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
                <span class="dt-corner-label dt-corner-top">Workers</span>
                <div class="dt-corner-line"></div>
                <span class="dt-corner-label dt-corner-bottom">Shifts</span>
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
        <span class="dt-legend-item" style="color:#94a3b8">— = shift full</span>
      </div>
    </div>`
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
  const selectedYMD = toYMD(state.selectedDay)
  const dayShifts = all.filter(s => s.date.substring(0, 10) === selectedYMD && s.status !== 'CANCELLED')
  const bar = document.getElementById('action-bar')
  if (shiftsView === 'table' || dayShifts.length === 0) { bar.style.display = 'none'; return }
  bar.style.display = 'flex'
  document.getElementById('btn-publish-day').disabled   = !dayShifts.some(s => s.status === 'DRAFT')
  document.getElementById('btn-unpublish-day').disabled = !dayShifts.some(s => s.status === 'PUBLISHED')
}

export async function publishDay() {
  document.getElementById('btn-publish-day').disabled = true
  try {
    const res = await apiFetch('/shifts/publish-day', { method: 'POST', body: JSON.stringify({ date: toYMD(state.selectedDay) }) })
    if (res?.ok) { delete state.shiftsCache[toYMD(state.currentWeek)]; await loadShifts() }
  } finally { updateActionBar() }
}

export async function unpublishDay() {
  document.getElementById('btn-unpublish-day').disabled = true
  try {
    const res = await apiFetch('/shifts/unpublish-day', { method: 'POST', body: JSON.stringify({ date: toYMD(state.selectedDay) }) })
    if (res?.ok) { delete state.shiftsCache[toYMD(state.currentWeek)]; await loadShifts() }
  } finally { updateActionBar() }
}

window.changeWeek    = changeWeek
window.publishDay    = publishDay
window.unpublishDay  = unpublishDay
window.setShiftsView = setShiftsView
window.assignInTable = assignInTable
