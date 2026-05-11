import { state } from './state.js'
import { apiFetch } from './api.js'
import { DAYS, MONTHS, DEPT_COLORS, addDays, isSameDay, toYMD, fmtDate, getWeekStartOf } from './utils.js'

let shiftsView = 'list'

// Stable dept ID → color mapping (same dept always gets same color)
function getDeptColor(deptId) {
  if (!deptId) return DEPT_COLORS[0]
  let hash = 0
  for (let i = 0; i < deptId.length; i++) hash = (hash * 31 + deptId.charCodeAt(i)) | 0
  return DEPT_COLORS[Math.abs(hash) % DEPT_COLORS.length]
}

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
    tab.onclick = () => { state.selectedDay = day; renderDayTabs(); renderShiftsForDay() }
    container.appendChild(tab)
  }
}

export function setShiftsView(view) {
  shiftsView = view

  const listBtn  = document.getElementById('view-list-btn')
  const tableBtn = document.getElementById('view-table-btn')
  if (listBtn)  listBtn.classList.toggle('active',  view === 'list')
  if (tableBtn) tableBtn.classList.toggle('active', view === 'table')

  const dayTabs   = document.getElementById('day-tabs')
  const actionBar = document.getElementById('action-bar')
  const content   = document.getElementById('shifts-content').parentElement // .content-area

  if (view === 'table') {
    dayTabs.style.display   = 'none'
    actionBar.style.display = 'none'
    content.classList.add('content-area-flush')
    renderTableView()
  } else {
    dayTabs.style.display = ''
    content.classList.remove('content-area-flush')
    renderShiftsForDay()
  }
}

export function changeWeek(dir) {
  const candidate = addDays(state.currentWeek, dir * 7)
  state.currentWeek = getWeekStartOf(candidate, state.currentOrg?.weekStartsOn)
  const today = new Date()
  const weekEnd = addDays(state.currentWeek, 6)
  state.selectedDay = (today >= state.currentWeek && today <= weekEnd) ? today : new Date(state.currentWeek)
  renderWeekLabel()
  if (shiftsView === 'list') renderDayTabs()
  loadShifts()
}

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

function renderTableView() {
  const key = toYMD(state.currentWeek)
  const allShifts = state.shiftsCache[key] || []
  const today = new Date()
  const days = Array.from({ length: 7 }, (_, i) => addDays(state.currentWeek, i))

  // Build worker → day → [shifts] map
  const workerMap = new Map()
  allShifts.forEach(s => {
    if (s.status === 'CANCELLED') return
    const dateKey = s.date.substring(0, 10)
    const color = getDeptColor(s.department?.id)
    ;(s.assignments || []).forEach(a => {
      const wId   = a.worker?.id   || a.id
      const wName = a.worker?.name || a.name || '?'
      if (!workerMap.has(wId)) workerMap.set(wId, { name: wName, days: new Map() })
      const worker = workerMap.get(wId)
      if (!worker.days.has(dateKey)) worker.days.set(dateKey, [])
      worker.days.get(dateKey).push({ ...s, _color: color })
    })
  })

  const el = document.getElementById('shifts-content')

  if (workerMap.size === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        <p>No workers assigned this week</p>
      </div>`
    return
  }

  const workers = [...workerMap.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))

  const dayHeaders = days.map(d => {
    const isToday = isSameDay(d, today)
    return `
      <th class="roster-day-th${isToday ? ' roster-today-col' : ''}">
        <div class="roster-day-label">${DAYS[d.getDay()]}</div>
        <div class="roster-day-num${isToday ? ' roster-today-num' : ''}">${d.getDate()}</div>
      </th>`
  }).join('')

  const rows = workers.map(([, worker]) => {
    const initials = worker.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
    const cells = days.map(d => {
      const shifts = worker.days.get(toYMD(d)) || []
      if (shifts.length === 0) return `<td class="roster-cell roster-cell-empty"></td>`
      const cards = shifts.map(s => `
        <div class="roster-shift-card" style="border-left:3px solid ${s._color}" onclick="openShiftModal('${s.id}')">
          <div class="roster-shift-time">${s.startTime.substring(0, 5)}–${s.endTime.substring(0, 5)}</div>
          <div class="roster-shift-dept" style="color:${s._color}">${s.department?.name || ''}</div>
          <span class="status-pill status-${s.status}">${s.status.toLowerCase()}</span>
        </div>`).join('')
      return `<td class="roster-cell">${cards}</td>`
    }).join('')

    return `
      <tr class="roster-row">
        <td class="roster-worker-td">
          <div class="roster-avatar">${initials}</div>
          <span class="roster-worker-name">${worker.name}</span>
        </td>
        ${cells}
      </tr>`
  }).join('')

  el.innerHTML = `
    <div class="roster-wrapper">
      <table class="roster-table">
        <thead>
          <tr>
            <th class="roster-worker-th">Worker</th>
            ${dayHeaders}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
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
  } finally {
    updateActionBar()
  }
}

export async function unpublishDay() {
  document.getElementById('btn-unpublish-day').disabled = true
  try {
    const res = await apiFetch('/shifts/unpublish-day', { method: 'POST', body: JSON.stringify({ date: toYMD(state.selectedDay) }) })
    if (res?.ok) { delete state.shiftsCache[toYMD(state.currentWeek)]; await loadShifts() }
  } finally {
    updateActionBar()
  }
}

window.changeWeek   = changeWeek
window.publishDay   = publishDay
window.unpublishDay = unpublishDay
window.setShiftsView = setShiftsView
