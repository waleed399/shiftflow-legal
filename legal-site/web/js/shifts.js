import { state, ensureOrgWorkers } from './state.js'
import { apiFetch } from './api.js'
import { DAYS, MONTHS, DEPT_COLORS, DAY_FULL, AVAIL_ICONS, addDays, isSameDay, toYMD, fmtDate, getWeekStartOf, esc, getInitials, applyAvatars, showToast } from './utils.js'
import { t } from './i18n.js'
import { requireWebManage } from './profile.js'

let shiftsView = 'list'
let _activeFilters = new Set()

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

const AVAIL_PREF_COLORS = {
  morning: '#f59e0b', afternoon: '#f97316', night: '#60a5fa',
  any: '#22c55e', custom: '#3b82f6', off: '#ef4444',
}
function availPref(key) {
  return { color: AVAIL_PREF_COLORS[key], label: t(`availability.pref.${key}`) }
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
  _activeFilters = new Set()
  document.getElementById('view-list-btn')?.classList.toggle('active',  view === 'list')
  document.getElementById('view-table-btn')?.classList.toggle('active', view === 'table')
  document.getElementById('view-week-btn')?.classList.toggle('active',  view === 'week')
  document.getElementById('day-tabs').style.display = view === 'week' ? 'none' : ''

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
  _activeFilters = new Set()
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
    document.getElementById('shifts-content').innerHTML = `<div class="empty-state"><p>${t('shifts.failedLoad')}</p></div>`
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
    updateActionBar()
    return
  }

  const filteredShifts = applyShiftFilters(dayShifts)

  const groupMap = new Map()
  filteredShifts.forEach(s => {
    const deptId = s.department?.id || 'unknown'
    if (!groupMap.has(deptId)) groupMap.set(deptId, { dept: s.department, shifts: [] })
    groupMap.get(deptId).shifts.push(s)
  })

  if (filteredShifts.length === 0) {
    el.innerHTML = `
      <div class="empty-state" style="padding-top:40px">
        <p style="color:var(--muted)">${t('shifts.filterNoMatch')}</p>
        <button class="btn-link" style="margin-top:8px" onclick="clearShiftFilters()">${t('shifts.filterClearLink')}</button>
      </div>`
    updateActionBar()
    return
  }

  const groups = [...groupMap.entries()]
  el.innerHTML = renderDayStats(dayShifts) + `<div class="shifts-grid">${groups.map(([deptId, g], i) => deptSection(g, getDeptColor(deptId), i)).join('')}</div>`
  updateActionBar()
}

function applyShiftFilters(shifts) {
  if (_activeFilters.size === 0) return shifts
  return shifts.filter(s => {
    if (_activeFilters.has('needs_workers') && (s.assignments?.length || 0) >= (s.requiredWorkers || 0)) return false
    if (_activeFilters.has('understaffed') && (s.assignments?.length || 0) >= (s.requiredWorkers || 0)) return false
    const timeFilters = ['morning', 'afternoon', 'evening'].filter(k => _activeFilters.has(k))
    if (timeFilters.length > 0) {
      const hour = parseInt(s.startTime?.substring(0, 2) || '0', 10)
      const block = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
      if (!timeFilters.includes(block)) return false
    }
    const deptFilters = [..._activeFilters].filter(k => k.startsWith('dept:'))
    if (deptFilters.length > 0 && !deptFilters.includes(`dept:${s.department?.id}`)) return false
    return true
  })
}

function renderFilterBar(dayShifts) {
  const bar = document.getElementById('shift-filter-bar')
  if (!bar) return
  if (dayShifts.length === 0) { bar.style.display = 'none'; return }
  bar.style.display = ''

  const hasUnderstaffed = dayShifts.some(s => (s.assignments?.length || 0) < (s.requiredWorkers || 0))
  const depts = []
  const seen = new Set()
  dayShifts.forEach(s => {
    if (s.department?.id && !seen.has(s.department.id)) {
      seen.add(s.department.id)
      depts.push(s.department)
    }
  })

  const clearBtn = _activeFilters.size > 0
    ? `<button class="filter-chip filter-chip-clear" onclick="clearShiftFilters()">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        ${t('shifts.filterClear', { count: _activeFilters.size })}
       </button>
       <div class="filter-divider"></div>`
    : ''

  const understaffedChip = hasUnderstaffed
    ? `<button class="filter-chip ${_activeFilters.has('understaffed') ? 'active' : ''}" style="--chip-color:#f59e0b" onclick="toggleShiftFilter('understaffed')">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        ${t('shifts.filterUnderstaffed')}
       </button>
       <div class="filter-divider"></div>`
    : ''

  const chips = [
    { key: 'needs_workers', label: t('shifts.filterNeedsWorkers'), color: '#ef4444',
      icon: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>` },
    { key: 'morning',       label: t('shifts.filterMorning'),      color: '#f59e0b',
      icon: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="2" x2="12" y2="9"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/></svg>` },
    { key: 'afternoon',     label: t('shifts.filterAfternoon'),    color: '#3b82f6',
      icon: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>` },
    { key: 'evening',       label: t('shifts.filterEvening'),      color: '#8b5cf6',
      icon: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>` },
  ].map(({ key, label, color, icon }) =>
    `<button class="filter-chip ${_activeFilters.has(key) ? 'active' : ''}" style="--chip-color:${color}" onclick="toggleShiftFilter('${key}')">
      ${icon}${label}
     </button>`
  ).join('')

  const deptChips = depts.length > 1
    ? `<div class="filter-divider"></div>` + depts.map(d =>
        `<button class="filter-chip ${_activeFilters.has(`dept:${d.id}`) ? 'active' : ''}" style="--chip-color:${getDeptColor(d.id)}" onclick="toggleShiftFilter('dept:${esc(d.id)}')">
          ${esc(d.name)}
         </button>`
      ).join('')
    : ''

  bar.innerHTML = `<div class="filter-bar-scroll">${clearBtn}${understaffedChip}${chips}${deptChips}</div>`
}

export function toggleShiftFilter(key) {
  _activeFilters.has(key) ? _activeFilters.delete(key) : _activeFilters.add(key)
  _rerenderCurrentView()
}

export function clearShiftFilters() {
  _activeFilters = new Set()
  _rerenderCurrentView()
}

function _rerenderCurrentView() {
  if (shiftsView === 'table') renderTableView()
  else if (shiftsView === 'week') renderWeekView()
  else renderShiftsForDay()
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
        <span class="stat-chip-label">${t('shifts.shiftsToday')}</span>
      </div>
      <div class="stat-chip">
        <span class="stat-chip-num">${totalAssigned}</span>
        <span class="stat-chip-label">${t('shifts.workersAssigned')}</span>
      </div>
      <div class="stat-chip">
        <span class="stat-chip-num" style="color:${coverageColor}">${pct}%</span>
        <span class="stat-chip-label">${t('shifts.coverage')}</span>
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
        <span class="dept-name" style="color:${color}">${esc(group.dept?.name || t('common.unknown'))}</span>
        <span class="dept-worker-badge" style="background:${badgeColor}22;color:${badgeColor}">${t('shifts.workerCountSlash', { assigned: totalAssigned, required: totalRequired })}</span>
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
  const workerText  = count === 0 ? t('shifts.noWorkers') : `${count} / ${required}`
  const understaffed = shift.understaffed ? `<span class="understaffed-badge">${t('shifts.understaffed')}</span>` : ''
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
          <span class="status-pill status-${shift.status}">${t(`shifts.status.${shift.status}`)}</span>
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
    el.innerHTML = `<div class="empty-state"><p>${t('shifts.noWorkersFound')}</p></div>`
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

  // Group by department (apply active filters)
  const filteredDayShifts = applyShiftFilters(dayShifts)
  if (filteredDayShifts.length === 0 && _activeFilters.size > 0) {
    el.innerHTML = `
      <div class="empty-state" style="padding-top:40px">
        <p style="color:var(--muted)">${t('shifts.filterNoMatch')}</p>
        <button class="btn-link" style="margin-top:8px" onclick="clearShiftFilters()">${t('shifts.filterClearLink')}</button>
      </div>`
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
  document.getElementById('publish-week-label').textContent = t('shifts.publishWeekCount', { count: weekDraftCount })
  document.getElementById('btn-publish-week').disabled  = weekDraftCount === 0
  document.getElementById('btn-unpublish-week').disabled = !weekActive.some(s => s.status === 'PUBLISHED')
}

export async function publishDay() {
  if (!requireWebManage()) return
  document.getElementById('btn-publish-day').disabled = true
  try {
    const res = await apiFetch('/shifts/publish-day', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: toYMD(state.selectedDay) }) })
    if (res?.ok) { delete state.shiftsCache[toYMD(state.currentWeek)]; await loadShifts() }
  } finally { updateActionBar() }
}

export async function unpublishDay() {
  if (!requireWebManage()) return
  document.getElementById('btn-unpublish-day').disabled = true
  try {
    const res = await apiFetch('/shifts/unpublish-day', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: toYMD(state.selectedDay) }) })
    if (res?.ok) { delete state.shiftsCache[toYMD(state.currentWeek)]; await loadShifts() }
  } finally { updateActionBar() }
}

export async function publishWeek() {
  if (!requireWebManage()) return
  const key = toYMD(state.currentWeek)
  const draftCount = (state.shiftsCache[key] || []).filter(s => s.status === 'DRAFT').length
  const msg = draftCount === 1
    ? t('shifts.confirmPublishWeekOne', { count: draftCount })
    : t('shifts.confirmPublishWeek', { count: draftCount })
  if (!confirm(msg)) return

  const btn = document.getElementById('btn-publish-week')
  btn.disabled = true
  const label = document.getElementById('publish-week-label')
  const prevText = label.textContent
  label.textContent = t('shifts.publishing')

  try {
    const res = await apiFetch('/shifts/publish-week', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weekOf: key }) })
    if (res?.ok) { delete state.shiftsCache[key]; await loadShifts() }
  } finally {
    label.textContent = prevText
    updateActionBar()
  }
}

export async function unpublishWeek() {
  if (!requireWebManage()) return
  if (!confirm(t('shifts.confirmUnpublishWeek'))) return

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
    (_availRosterCache[key] || []).map(r => {
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
        const wDeptIds    = w.departmentIds || []
        const isWrongDept = s.department?.id && wDeptIds.length > 0 && !wDeptIds.includes(s.department.id)
        if (isWrongDept) return null

        return `<div class="wv-pill wv-pill-open" data-assign="${s.id}::${w.id}" onclick="assignInWeekView('${s.id}','${w.id}')">
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

// ── Create Shifts from Templates ──────────────────────────────────────────────

const CS_WEEK_OPTIONS = [1, 2, 4, 8, 12]
const CS_CODE_TO_IDX  = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 }
const CS_OFFSET_MON   = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 }
const CS_OFFSET_SUN   = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 }

let _csTemplates  = []
let _csGrid       = {}   // templateId → Set<dayCode>
let _csWeeksAhead = 4
let _csStartWeek  = null
let _csMinWeek    = null

function csWorkDays()   { return state.currentOrg?.workDays || ['MON','TUE','WED','THU','FRI'] }
function csWeekStart()  { return state.currentOrg?.weekStartsOn || 'MONDAY' }
function csDayOffset(d) { return csWeekStart() === 'SUNDAY' ? CS_OFFSET_SUN[d] : CS_OFFSET_MON[d] }
function csDayLabel(d)  { return DAYS[CS_CODE_TO_IDX[d]] || d.slice(0,3) }

function csTotalShifts() {
  const wd = csWorkDays()
  return Object.values(_csGrid).reduce((s, set) => s + [...set].filter(d => wd.includes(d)).length, 0) * _csWeeksAhead
}

export async function openCreateShiftsModal() {
  if (!requireWebManage()) return
  document.getElementById('create-shifts-modal').classList.remove('hidden')
  const body = document.getElementById('cs-modal-body')
  const btn  = document.getElementById('cs-submit-btn')
  body.innerHTML = `<div style="padding:32px;text-align:center"><div class="spinner" style="margin:0 auto 16px;width:32px;height:32px;border-width:3px"></div><p style="color:var(--muted);font-size:0.875rem">${t('shifts.csLoading')}</p></div>`
  btn.disabled = true
  _csTemplates = []; _csGrid = {}; _csWeeksAhead = 4

  const ws = csWeekStart()
  _csMinWeek   = getWeekStartOf(new Date(), ws)
  _csStartWeek = addDays(_csMinWeek, 7)

  try {
    const [tmplRes, latestRes] = await Promise.all([
      apiFetch('/shift-templates'),
      apiFetch('/shifts/latest-date'),
    ])
    if (!tmplRes || !latestRes) { closeCreateShiftsModal(); return }
    _csTemplates = await tmplRes.json()
    const { latestDate } = await latestRes.json()
    if (latestDate) {
      const latestWeek    = getWeekStartOf(new Date(latestDate + 'T00:00:00'), ws)
      const weekAfterLatest = addDays(latestWeek, 7)
      const nextWeek      = addDays(_csMinWeek, 7)
      _csStartWeek = weekAfterLatest > nextWeek ? weekAfterLatest : nextWeek
    }
    const wd = csWorkDays()
    _csTemplates.forEach(tmpl => { _csGrid[tmpl.id] = new Set(wd) })
    renderCreateShiftsGrid()
  } catch {
    body.innerHTML = `<div class="empty-state"><p>${t('common.networkError')}</p></div>`
  }
}

function renderCreateShiftsGrid() {
  if (_csTemplates.length === 0) {
    document.getElementById('cs-modal-body').innerHTML = `<div class="empty-state"><p>${t('shifts.csNoTemplates')}</p></div>`
    document.getElementById('cs-submit-btn').disabled = true
    return
  }

  const wd = csWorkDays()
  const weekEnd  = addDays(_csStartWeek, 6)
  const weekLabel = `${_csStartWeek.getDate()} ${MONTHS[_csStartWeek.getMonth()]} – ${weekEnd.getDate()} ${MONTHS[weekEnd.getMonth()]} ${weekEnd.getFullYear()}`
  const canPrev  = _csStartWeek > _csMinWeek

  // Week pills
  const pills = CS_WEEK_OPTIONS.map(w => {
    const on = _csWeeksAhead === w
    return `<button class="cs-week-pill${on ? ' cs-week-pill-on' : ''}" onclick="csSetWeeks(${w})">${w}w</button>`
  }).join('')

  // Day headers
  const dayHeaders = wd.map(d => {
    const allOn = _csTemplates.every(tmpl => _csGrid[tmpl.id]?.has(d))
    return `<th class="cs-day-th${allOn ? ' cs-day-all' : ''}" onclick="csToggleCol('${d}')">${csDayLabel(d)}</th>`
  }).join('')

  // Group templates by department
  const deptMap = new Map()
  _csTemplates.forEach(tmpl => {
    const key = tmpl.department?.id || 'none'
    if (!deptMap.has(key)) deptMap.set(key, { name: tmpl.department?.name || '—', templates: [] })
    deptMap.get(key).templates.push(tmpl)
  })
  const groups = [...deptMap.values()].sort((a, b) => a.name.localeCompare(b.name))

  const bodyRows = groups.map(({ name, templates }) => {
    const band = `<tr class="cs-dept-band"><td colspan="${wd.length + 1}">${esc(name)}</td></tr>`
    const rows = templates.map(tmpl => {
      const cells = wd.map(d => {
        const on = _csGrid[tmpl.id]?.has(d)
        return `<td class="cs-cell" onclick="csCellToggle('${tmpl.id}','${d}')">
          <div class="cs-dot${on ? ' cs-dot-on' : ''}" style="${on ? `background:${esc(tmpl.color||'#6366f1')}` : ''}"></div>
        </td>`
      }).join('')
      return `<tr class="cs-tmpl-row">
        <td class="cs-tmpl-cell" onclick="csToggleRow('${tmpl.id}')">
          <div class="cs-tmpl-inner">
            <div class="cs-tmpl-dot" style="background:${esc(tmpl.color||'#6366f1')}"></div>
            <div><span class="cs-tmpl-name">${esc(tmpl.name)}</span><span class="cs-tmpl-time">${tmpl.startTime.substring(0,5)} – ${tmpl.endTime.substring(0,5)}</span></div>
          </div>
        </td>${cells}
      </tr>`
    }).join('')
    return band + rows
  }).join('')

  document.getElementById('cs-modal-body').innerHTML = `
    <div class="cs-section-label">${t('shifts.csStartWeek')}</div>
    <div class="cs-week-nav">
      <button class="week-btn" onclick="csNavWeek(-1)" ${canPrev ? '' : 'disabled style="opacity:.3"'}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <span class="cs-week-label">${weekLabel}</span>
      <button class="week-btn" onclick="csNavWeek(1)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
    <p class="cs-hint">${t('shifts.csExistingHint')}</p>

    <div class="cs-section-label">${t('shifts.csWeeksAhead')}</div>
    <div class="cs-week-pills">${pills}</div>

    <div class="cs-section-label">${t('shifts.csShiftTypes')}</div>
    <div class="cs-grid-wrap">
      <table class="cs-grid">
        <thead><tr><th class="cs-tmpl-th">${t('shifts.csShift')}</th>${dayHeaders}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
    <p class="cs-hint">${t('shifts.csToggleHint')}</p>`

  const total = csTotalShifts()
  const btn = document.getElementById('cs-submit-btn')
  btn.disabled = total === 0
  btn.textContent = total > 0 ? t('shifts.csCreate', { count: total }) : t('shifts.csCreate', { count: 0 })
}

export function closeCreateShiftsModal() {
  document.getElementById('create-shifts-modal').classList.add('hidden')
}

export async function submitCreateShifts() {
  if (!requireWebManage()) return
  const wd       = csWorkDays()
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = toYMD(tomorrow)
  const jobs = []

  for (let w = 0; w < _csWeeksAhead; w++) {
    const weekStart = addDays(_csStartWeek, w * 7)
    for (const tmpl of _csTemplates) {
      const active = _csGrid[tmpl.id] || new Set()
      for (const d of wd) {
        if (!active.has(d)) continue
        const shiftDate = addDays(weekStart, csDayOffset(d))
        const dateStr   = toYMD(shiftDate)
        if (dateStr < tomorrowStr) continue
        jobs.push({ date: dateStr, startTime: tmpl.startTime, endTime: tmpl.endTime, departmentId: tmpl.departmentId, requiredWorkers: tmpl.requiredWorkers, templateId: tmpl.id })
      }
    }
  }

  if (jobs.length === 0) { showToast(t('shifts.csNothingSelected')); return }

  const btn = document.getElementById('cs-submit-btn')
  const prev = btn.textContent
  btn.disabled = true
  btn.textContent = t('shifts.csGenerating')

  try {
    const res = await apiFetch('/shifts/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shifts: jobs }),
    })
    if (res?.ok) {
      const { created, skipped } = await res.json()
      closeCreateShiftsModal()
      // Navigate to the start week so user sees the created shifts
      state.currentWeek = _csStartWeek
      state.selectedDay = _csStartWeek
      state.shiftsCache = {}
      renderWeekLabel()
      renderDayTabs()
      await loadShifts()
      const msg = skipped > 0
        ? `${t('shifts.csDone', { count: created })} · ${t('shifts.csSkipped', { count: skipped })}`
        : t('shifts.csDone', { count: created })
      showToast(msg, 'success')
    } else {
      const d = await res?.json().catch(() => ({}))
      showToast(d?.error || t('shifts.csFailed'))
      btn.disabled = false; btn.textContent = prev
    }
  } catch {
    showToast(t('common.networkError'))
    btn.disabled = false; btn.textContent = prev
  }
}

window.openCreateShiftsModal  = openCreateShiftsModal
window.closeCreateShiftsModal = closeCreateShiftsModal
window.submitCreateShifts     = submitCreateShifts
window.csNavWeek   = (dir) => { const c = addDays(_csStartWeek, dir * 7); if (dir < 0 && c < _csMinWeek) return; _csStartWeek = c; renderCreateShiftsGrid() }
window.csSetWeeks  = (w)   => { _csWeeksAhead = w; renderCreateShiftsGrid() }
window.csToggleCol = (d)   => { const allOn = _csTemplates.every(t => _csGrid[t.id]?.has(d)); _csTemplates.forEach(t => { const s = new Set(_csGrid[t.id]||[]); allOn ? s.delete(d) : s.add(d); _csGrid[t.id] = s }); renderCreateShiftsGrid() }
window.csToggleRow = (id)  => { const wd = csWorkDays(); const s = _csGrid[id]||new Set(); _csGrid[id] = wd.every(d => s.has(d)) ? new Set() : new Set(wd); renderCreateShiftsGrid() }
window.csCellToggle = (id, d) => { const s = new Set(_csGrid[id]||[]); s.has(d) ? s.delete(d) : s.add(d); _csGrid[id] = s; renderCreateShiftsGrid() }
window.onCreateShiftsOverlayClick = (e) => { if (e.target.id === 'create-shifts-modal') closeCreateShiftsModal() }

// ── Generate Schedule ─────────────────────────────────────────────────────────

let _genData = null
let _genSelected = null

export async function openGenerateModal() {
  if (!requireWebManage()) return
  document.getElementById('generate-modal').classList.remove('hidden')
  const body = document.getElementById('generate-modal-body')
  const applyBtn = document.getElementById('gen-apply-btn')
  body.innerHTML = `<div style="padding:32px;text-align:center"><div class="spinner" style="margin:0 auto 16px;width:32px;height:32px;border-width:3px"></div><p style="color:var(--muted);font-size:0.875rem">${t('shifts.generateLoading')}</p></div>`
  applyBtn.disabled = true
  _genData = null
  _genSelected = null

  const key = toYMD(state.currentWeek)
  try {
    const res = await apiFetch('/schedule/auto-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekOf: key }),
    })
    if (!res) { closeGenerateModal(); return }
    if (res.status === 409 || res.status === 422) {
      const d = await res.json()
      body.innerHTML = `<div class="empty-state"><p style="color:${res.status === 409 ? '#dc2626' : 'inherit'}">${esc(d.error)}</p></div>`
      return
    }
    if (!res.ok) {
      body.innerHTML = `<div class="empty-state"><p>${t('shifts.generateFailed')}</p></div>`
      return
    }
    _genData = await res.json()
    _genSelected = 'optimal'
    renderGenOptions()
  } catch {
    body.innerHTML = `<div class="empty-state"><p>${t('common.networkError')}</p></div>`
  }
}

function renderGenOptions() {
  if (!_genData) return
  const { options, invalidAvailability } = _genData

  const cards = options.map(opt => {
    const fullyStaffed = opt.preview.filter(s => !s.understaffed).length
    const total = opt.preview.length
    const warnCount = opt.warnings.length
    const isSelected = _genSelected === opt.id
    const coverageCls = fullyStaffed === total ? 'gen-stat-ok' : 'gen-stat-warn'
    return `
      <div class="gen-option-card${isSelected ? ' gen-option-selected' : ''}" onclick="selectGenOption('${opt.id}')">
        <div class="gen-option-top">
          <span class="gen-option-label">${esc(opt.label)}</span>
          <div class="gen-option-radio${isSelected ? ' gen-radio-on' : ''}"></div>
        </div>
        <div class="gen-option-desc">${esc(opt.description)}</div>
        <div class="gen-option-stats">
          <span class="gen-stat-chip ${coverageCls}">${fullyStaffed}/${total} ${t('shifts.generateFullyStaffed')}</span>
          ${warnCount > 0 ? `<span class="gen-stat-chip gen-stat-warn">${warnCount} ${warnCount === 1 ? t('shifts.generateWarning') : t('shifts.generateWarnings')}</span>` : ''}
        </div>
      </div>`
  }).join('')

  const selected = options.find(o => o.id === _genSelected)
  const warningsHtml = selected?.warnings?.length ? `
    <div class="gen-warnings-box">
      <p>${t('shifts.generateWarningsFor', { label: esc(selected.label) })}</p>
      <ul>${selected.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>
    </div>` : ''

  const invalidHtml = invalidAvailability?.length ? `
    <div class="gen-invalid-box">
      ⚠ ${esc(invalidAvailability.map(w => w.name).join(', '))} — ${t('shifts.generateInvalidAvail')}
    </div>` : ''

  document.getElementById('generate-modal-body').innerHTML = `
    <div class="gen-options-grid">${cards}</div>
    ${warningsHtml}${invalidHtml}`
  document.getElementById('gen-apply-btn').disabled = false
}

export function closeGenerateModal() {
  document.getElementById('generate-modal').classList.add('hidden')
}

export async function confirmGenerate() {
  if (!requireWebManage()) return
  if (!_genData || !_genSelected) return
  const selected = _genData.options.find(o => o.id === _genSelected)
  if (!selected) return

  const btn = document.getElementById('gen-apply-btn')
  const prev = btn.textContent
  btn.disabled = true
  btn.textContent = t('shifts.generateApplying')

  try {
    const res = await apiFetch('/schedule/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekOf: _genData.weekOf, preview: selected.preview }),
    })
    if (res?.ok) {
      closeGenerateModal()
      delete state.shiftsCache[toYMD(state.currentWeek)]
      await loadShifts()
      showToast(t('shifts.generateApplied'))
    } else {
      const d = await res?.json().catch(() => ({}))
      showToast(d?.error || t('shifts.generateApplyFailed'))
      btn.disabled = false
      btn.textContent = prev
    }
  } catch {
    showToast(t('common.networkError'))
    btn.disabled = false
    btn.textContent = prev
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
window.openGenerateModal    = openGenerateModal
window.closeGenerateModal   = closeGenerateModal
window.confirmGenerate      = confirmGenerate
window.selectGenOption      = (id) => { _genSelected = id; renderGenOptions() }
window.onGenerateOverlayClick = (e) => { if (e.target.id === 'generate-modal') closeGenerateModal() }
window.toggleShiftFilter  = toggleShiftFilter
window.clearShiftFilters  = clearShiftFilters
