import { state } from './state.js'
import { apiFetch } from './api.js'
import { esc, addDays, toYMD, isSameDay, DEPT_COLORS } from './utils.js'
import { t } from './i18n.js'
import { requireWebManage } from './profile.js'

let _pendingSwaps   = []
let _pendingTimeoff = []
let _dashWeek       = null  // week being viewed (may differ from state.currentWeek)
let _selectedDay    = null  // day selected in the strip

// ── Entry point ───────────────────────────────────────────────────────────────

export async function renderDashboard() {
  _dashWeek    = state.currentWeek   // always reset to current week on nav
  _selectedDay = new Date()          // always default to actual today

  const el = document.getElementById('dashboard-content')
  if (!el) return
  el.innerHTML = '<div class="loader-inline"><div class="spinner"></div></div>'
  try {
    await Promise.all([_loadWeekShifts(), _loadPendingRequests()])
    el.innerHTML = _buildHTML()
  } catch {
    el.innerHTML = `<div class="empty-state"><p>${t('common.networkError')}</p></div>`
  }
}

function _rerender() {
  const el = document.getElementById('dashboard-content')
  if (el) el.innerHTML = _buildHTML()
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function _loadWeekShifts() {
  const key = toYMD(_dashWeek)
  if (!state.shiftsCache[key]) {
    const res = await apiFetch(`/shifts?weekOf=${key}`)
    if (!res) return
    state.shiftsCache[key] = await res.json()
  }
}

async function _loadPendingRequests() {
  const [sr, tr] = await Promise.all([
    apiFetch('/swaps?limit=20'),
    apiFetch('/time-off?limit=20'),
  ])
  if (!sr || !tr) return
  const swapsData   = await sr.json()
  const timeoffData = await tr.json()
  _pendingSwaps   = (swapsData.swaps     || []).filter(s => s.status === 'PENDING')
  _pendingTimeoff = (timeoffData.requests || []).filter(r => r.status === 'PENDING')
}

function _weekShifts() {
  return state.shiftsCache[toYMD(_dashWeek)] || []
}

// ── Full HTML build ───────────────────────────────────────────────────────────

function _buildHTML() {
  const today        = new Date()
  const selYMD       = toYMD(_selectedDay)
  const allShifts    = _weekShifts()
  const selShifts    = allShifts
    .filter(s => s.date?.substring(0, 10) === selYMD && s.status !== 'CANCELLED')
    .sort((a, b) => a.startTime.localeCompare(b.startTime))

  const assigned     = selShifts.reduce((n, s) => n + (s.assignments?.length || 0), 0)
  const required     = selShifts.reduce((n, s) => n + (s.requiredWorkers || 0), 0)
  const coverage     = required > 0 ? Math.round(assigned / required * 100) : (selShifts.length ? 100 : 0)
  const pendingTotal = _pendingSwaps.length + _pendingTimeoff.length
  const isToday      = isSameDay(_selectedDay, today)
  const coverColor   = coverage >= 100 ? '#059669' : coverage >= 60 ? '#d97706' : '#dc2626'
  const firstName    = state.currentUser?.name?.split(' ')[0] || ''
  const hour         = today.getHours()

  const panelTitle = _dayPanelTitle(isToday)

  return `
    ${_buildHero(firstName, hour)}

    ${_buildKPIs(selShifts.length, assigned, coverage, coverColor, pendingTotal, isToday)}

    ${_buildWeekStrip(allShifts)}

    <div class="dash-main">
      <div class="dash-panel">
        <div class="dash-panel-header">
          <span class="dash-panel-title">${panelTitle}</span>
          <button class="dash-panel-link" onclick="window.showView('shifts')">${t('dashboard.viewAll')}</button>
        </div>
        <div class="dash-shifts-list">
          ${selShifts.length
            ? _buildDeptSections(selShifts)
            : `<div class="dash-empty-msg">${t('dashboard.noShiftsForDay')}</div>`}
        </div>
      </div>
      <div class="dash-panel">
        <div class="dash-panel-header">
          <span class="dash-panel-title">${t('dashboard.pendingApprovals')}</span>
          ${pendingTotal > 0 ? `<button class="dash-panel-link" onclick="window.showView('requests')">${t('dashboard.viewAll')}</button>` : ''}
        </div>
        <div id="dash-pending-list">${_buildPendingHTML()}</div>
      </div>
    </div>`
}

function _dayPanelTitle(isToday) {
  if (isToday) return t('dashboard.todaysShifts')
  const CODES   = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY']
  const dayName = t(`days.full.${CODES[_selectedDay.getDay()]}`)
  const months  = t('months.short')
  const mo      = Array.isArray(months) ? months[_selectedDay.getMonth()] : ''
  return `${dayName}, ${_selectedDay.getDate()} ${mo}`
}

// ── Hero (greeting + time-of-day icon) ────────────────────────────────────────

const _ICONS = {
  morning: `
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>`,
  afternoon: `
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M17 8h1a4 4 0 1 1 0 8h-1"/>
      <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/>
      <line x1="6" y1="2" x2="6" y2="4"/>
      <line x1="10" y1="2" x2="10" y2="4"/>
      <line x1="14" y1="2" x2="14" y2="4"/>
    </svg>`,
  evening: `
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>`,
}

function _buildHero(firstName, hour) {
  const period = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
  const greetKey = `dashboard.good${period[0].toUpperCase()}${period.slice(1)}`
  const iconColors = { morning: '#f59e0b', afternoon: '#f97316', evening: '#6366f1' }
  const iconBgs    = { morning: 'rgba(245,158,11,0.12)', afternoon: 'rgba(249,115,22,0.12)', evening: 'rgba(99,102,241,0.12)' }

  return `
    <div class="dash-hero">
      <div class="dash-hero-left">
        <div class="dash-time-icon" style="color:${iconColors[period]};background:${iconBgs[period]}">
          ${_ICONS[period]}
        </div>
        <div class="dash-greeting">
          <span class="dash-greeting-text">${t(greetKey, { name: esc(firstName) })}</span>
          <span class="dash-date">${_fmtFullDate(new Date())}</span>
        </div>
      </div>
      <button class="dash-refresh-btn" onclick="window._dashRefresh()" title="${t('dashboard.refresh')}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
      </button>
    </div>`
}

// ── KPI cards ─────────────────────────────────────────────────────────────────

function _buildKPIs(shiftsCount, assigned, coverage, coverColor, pendingTotal, isToday) {
  return `
    <div class="dash-kpis">
      <div class="dash-kpi">
        <div class="dash-kpi-icon dash-kpi-icon-blue">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </div>
        <div class="dash-kpi-body">
          <div class="dash-kpi-num">${shiftsCount}</div>
          <div class="dash-kpi-label">${isToday ? t('dashboard.shiftsToday') : t('dashboard.shiftsDay')}</div>
        </div>
      </div>
      <div class="dash-kpi">
        <div class="dash-kpi-icon dash-kpi-icon-green">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <div class="dash-kpi-body">
          <div class="dash-kpi-num">${assigned}</div>
          <div class="dash-kpi-label">${t('dashboard.workersAssigned')}</div>
        </div>
      </div>
      <div class="dash-kpi">
        <div class="dash-kpi-icon" style="background:${coverage >= 100 ? 'rgba(5,150,105,0.12)' : coverage >= 60 ? 'rgba(217,119,6,0.12)' : 'rgba(220,38,38,0.12)'}; color:${coverColor}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        </div>
        <div class="dash-kpi-body">
          <div class="dash-kpi-num" style="color:${coverColor}">${coverage}%</div>
          <div class="dash-kpi-label">${t('dashboard.coverage')}</div>
        </div>
      </div>
      <div class="dash-kpi${pendingTotal > 0 ? ' dash-kpi-alert' : ''}" ${pendingTotal > 0 ? "onclick=\"window.showView('requests')\" style=\"cursor:pointer\" role=\"button\" tabindex=\"0\"" : ''}>
        <div class="dash-kpi-icon${pendingTotal > 0 ? ' dash-kpi-icon-red' : ' dash-kpi-icon-muted'}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        </div>
        <div class="dash-kpi-body">
          <div class="dash-kpi-num">${pendingTotal}</div>
          <div class="dash-kpi-label">${t('dashboard.pendingRequests')}</div>
        </div>
        ${pendingTotal > 0 ? '<div class="dash-kpi-arrow">→</div>' : ''}
      </div>
    </div>`
}

// ── Interactive week strip ────────────────────────────────────────────────────

function _buildWeekStrip(allShifts) {
  const today    = new Date()
  const weekEnd  = addDays(_dashWeek, 6)
  const months   = t('months.short')
  const mo1      = Array.isArray(months) ? months[_dashWeek.getMonth()] : ''
  const mo2      = Array.isArray(months) ? months[weekEnd.getMonth()] : ''
  const sameMonth = _dashWeek.getMonth() === weekEnd.getMonth()
  const weekLabel = sameMonth
    ? `${_dashWeek.getDate()} – ${weekEnd.getDate()} ${mo2} ${weekEnd.getFullYear()}`
    : `${_dashWeek.getDate()} ${mo1} – ${weekEnd.getDate()} ${mo2} ${weekEnd.getFullYear()}`

  const DAY_CODES = ['SUN','MON','TUE','WED','THU','FRI','SAT']

  const dayCells = []
  for (let i = 0; i < 7; i++) {
    const d      = addDays(_dashWeek, i)
    const ymd    = toYMD(d)
    const code   = DAY_CODES[d.getDay()]
    const count  = allShifts.filter(s => s.date?.substring(0, 10) === ymd && s.status !== 'CANCELLED').length
    const isTod  = isSameDay(d, today)
    const isSel  = isSameDay(d, _selectedDay)
    dayCells.push(`
      <button class="dash-day-btn${isSel ? ' active' : ''}${isTod ? ' today' : ''}"
              onclick="window._dashSelectDay('${ymd}')">
        <span class="dash-day-name">${t(`days.short.${code}`)}</span>
        <span class="dash-day-num">${d.getDate()}</span>
        ${count > 0
          ? `<span class="dash-day-count">${count}</span>`
          : `<span class="dash-day-dot"></span>`}
      </button>`)
  }

  return `
    <div class="dash-week-section">
      <div class="dash-week-nav">
        <button class="dash-week-nav-btn" onclick="window._dashChangeWeek(-1)" title="${t('dashboard.prevWeek')}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span class="dash-week-nav-label">${weekLabel}</span>
        <button class="dash-week-nav-btn" onclick="window._dashChangeWeek(1)" title="${t('dashboard.nextWeek')}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
      <div class="dash-day-strip">${dayCells.join('')}</div>
    </div>`
}

// ── Department-grouped shift sections ────────────────────────────────────────

const _STATUS_COLORS = {
  DRAFT: '#94a3b8', PUBLISHED: '#1a2d4f', ACTIVE: '#f59e0b',
  COMPLETED: '#22c55e', CANCELLED: '#ef4444',
}

function _getDeptColor(deptId) {
  if (!deptId) return DEPT_COLORS[0]
  let hash = 0
  for (let i = 0; i < deptId.length; i++) hash = (hash * 31 + deptId.charCodeAt(i)) | 0
  return DEPT_COLORS[Math.abs(hash) % DEPT_COLORS.length]
}

function _buildDeptSections(shifts) {
  const groupMap = new Map()
  shifts.forEach(s => {
    const deptId = s.department?.id || 'unknown'
    if (!groupMap.has(deptId)) groupMap.set(deptId, { dept: s.department, shifts: [] })
    groupMap.get(deptId).shifts.push(s)
  })
  return [...groupMap.entries()].map(([deptId, g]) => _deptSection(g, _getDeptColor(deptId))).join('')
}

function _deptSection(group, color) {
  const totalAssigned = group.shifts.reduce((sum, s) => sum + (s.assignments?.length || 0), 0)
  const totalRequired = group.shifts.reduce((sum, s) => sum + (s.requiredWorkers || 0), 0)
  const badgeColor = totalAssigned === 0 ? '#dc2626' : totalAssigned < totalRequired ? '#d97706' : color
  return `
    <div>
      <div class="dept-header" style="background:${color}10">
        <div class="dept-stripe" style="background:${color}"></div>
        <span class="dept-name" style="color:${color}">${esc(group.dept?.name || t('common.unknown'))}</span>
        <span class="dept-worker-badge" style="background:${badgeColor}22;color:${badgeColor}">${totalAssigned}/${totalRequired}</span>
      </div>
      ${group.shifts.map(s => _dashShiftRow(s)).join('')}
    </div>`
}

function _dashShiftRow(shift) {
  const assigned    = shift.assignments?.length || 0
  const required    = shift.requiredWorkers || 0
  const pct         = Math.min(100, required > 0 ? Math.round(assigned / required * 100) : 100)
  const workerColor = assigned === 0 ? '#dc2626' : assigned < required ? '#d97706' : '#059669'
  const borderColor = _STATUS_COLORS[shift.status] || '#94a3b8'
  const start       = shift.startTime?.substring(0, 5) || '—'
  const end         = shift.endTime?.substring(0, 5) || '—'
  const dur         = _duration(shift.startTime, shift.endTime)
  return `
    <div class="dept-shift-row" style="border-left:3px solid ${borderColor}" onclick="window.showView('shifts')" role="button" tabindex="0">
      <div class="shift-time-col">
        <span class="shift-time">${start}</span>
        <div class="shift-time-sep"></div>
        <span class="shift-time">${end}</span>
      </div>
      <div class="shift-row-body">
        <div class="shift-row-top">
          <span class="status-pill status-${shift.status}">${t(`shifts.status.${shift.status}`)}</span>
          ${dur ? `<span style="font-size:0.65rem;color:var(--muted)">${dur}</span>` : ''}
        </div>
        <div class="shift-coverage">
          <div class="coverage-bar">
            <div class="coverage-fill" style="width:${pct}%;background:${workerColor}"></div>
          </div>
          <span class="coverage-text" style="color:${workerColor}">${assigned}/${required}</span>
        </div>
      </div>
    </div>`
}

function _duration(start, end) {
  if (!start || !end) return ''
  const [sh, sm] = start.substring(0, 5).split(':').map(Number)
  const [eh, em] = end.substring(0, 5).split(':').map(Number)
  let mins = (eh * 60 + em) - (sh * 60 + sm)
  if (mins <= 0) mins += 1440
  const h = Math.floor(mins / 60), m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

// ── Pending requests ──────────────────────────────────────────────────────────

function _buildPendingHTML() {
  if (!_pendingSwaps.length && !_pendingTimeoff.length) {
    return `<div class="dash-pending-empty">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      <span>${t('dashboard.allClear')}</span>
    </div>`
  }
  return [
    ..._pendingTimeoff.slice(0, 5).map(_timeoffCard),
    ..._pendingSwaps.slice(0, 5).map(_swapCard),
  ].join('')
}

function _timeoffCard(req) {
  const start = _fmtShort(req.startDate)
  const end   = _fmtShort(req.endDate)
  const same  = req.startDate?.slice(0, 10) === req.endDate?.slice(0, 10)
  const range = same ? start : `${start} – ${end}`
  return `
    <div class="dash-req-card" id="dash-timeoff-${esc(req.id)}">
      <div class="dash-req-type-badge dash-req-type-timeoff">${t('dashboard.timeOff')}</div>
      <div class="dash-req-body">
        <div class="dash-req-who">${esc(req.worker?.name || t('common.unknown'))}</div>
        <div class="dash-req-detail">${esc(range)}</div>
        ${req.reason ? `<div class="dash-req-reason">&ldquo;${esc(req.reason)}&rdquo;</div>` : ''}
      </div>
      <div class="dash-req-actions">
        <button class="dash-req-btn dash-req-approve" onclick="window._dashApproveTimeoff('${esc(req.id)}')">${t('requests.approve')}</button>
        <button class="dash-req-btn dash-req-deny"    onclick="window._dashDenyTimeoff('${esc(req.id)}')">${t('requests.deny')}</button>
      </div>
    </div>`
}

function _swapCard(swap) {
  const shift  = swap.requesterAssignment?.shift
  const dept   = shift?.department?.name || '—'
  const date   = _fmtShort(shift?.date)
  const time   = shift ? `${shift.startTime?.substring(0,5)}–${shift.endTime?.substring(0,5)}` : '—'
  const isOpen = !swap.targetWorkerId
  return `
    <div class="dash-req-card" id="dash-swap-${esc(swap.id)}">
      <div class="dash-req-type-badge dash-req-type-swap">${t('dashboard.swap')}</div>
      <div class="dash-req-body">
        <div class="dash-req-who">${esc(swap.requester?.name || t('common.unknown'))}</div>
        <div class="dash-req-detail">${esc(dept)} · ${esc(date)} · ${esc(time)}</div>
        ${!isOpen
          ? `<div class="dash-req-detail">→ ${esc(swap.targetWorker?.name || '')}</div>`
          : `<div class="dash-req-detail dash-req-open">${t('dashboard.openSwap')}</div>`}
        ${swap.reason ? `<div class="dash-req-reason">&ldquo;${esc(swap.reason)}&rdquo;</div>` : ''}
      </div>
      <div class="dash-req-actions">
        <button class="dash-req-btn dash-req-approve" onclick="window._dashApproveSwap('${esc(swap.id)}')">${t('requests.approve')}</button>
        <button class="dash-req-btn dash-req-deny"    onclick="window._dashDenySwap('${esc(swap.id)}')">${t('requests.deny')}</button>
      </div>
    </div>`
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function _fmtShort(iso) {
  if (!iso) return '?'
  const [, m, d] = iso.slice(0, 10).split('-')
  const months = t('months.short')
  return `${parseInt(d, 10)} ${Array.isArray(months) ? months[parseInt(m, 10) - 1] : ''}`
}

function _fmtFullDate(date) {
  const CODES  = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY']
  const day    = t(`days.full.${CODES[date.getDay()]}`)
  const months = t('months.short')
  const mo     = Array.isArray(months) ? months[date.getMonth()] : ''
  return `${day}, ${date.getDate()} ${mo} ${date.getFullYear()}`
}

// ── Window-exposed actions ────────────────────────────────────────────────────

window._dashSelectDay = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number)
  _selectedDay = new Date(y, m - 1, d)
  _rerender()
}

window._dashChangeWeek = async (dir) => {
  _dashWeek = addDays(_dashWeek, dir * 7)

  // Snap back to today if today falls in the newly selected week, otherwise first day
  const today = new Date()
  const todayInWeek = Array.from({ length: 7 }, (_, i) => addDays(_dashWeek, i)).some(d => isSameDay(d, today))
  _selectedDay = todayInWeek ? today : new Date(_dashWeek)

  // Fetch week data if not cached
  const key = toYMD(_dashWeek)
  if (!state.shiftsCache[key]) {
    // Dim the strip while loading
    const strip = document.querySelector('.dash-week-section')
    if (strip) strip.style.opacity = '0.5'
    await _loadWeekShifts()
  }
  _rerender()
}

async function _doAction(fn) {
  try { const res = await fn(); return res?.ok ?? false } catch { return false }
}

function _removePending(type, id) {
  if (type === 'timeoff') _pendingTimeoff = _pendingTimeoff.filter(r => r.id !== id)
  else                    _pendingSwaps   = _pendingSwaps.filter(s => s.id !== id)

  const total = _pendingSwaps.length + _pendingTimeoff.length
  state.pendingRequestCount = total
  const badge = document.getElementById('req-badge')
  if (badge) { badge.textContent = total > 0 ? String(total) : ''; badge.classList.toggle('visible', total > 0) }
  window.dismissNotification?.(id)
  _rerender()
}

function _disableBtns(id) { document.getElementById(id)?.querySelectorAll('button').forEach(b => { b.disabled = true }) }
function _enableBtns(id)  { document.getElementById(id)?.querySelectorAll('button').forEach(b => { b.disabled = false }) }

window._dashApproveTimeoff = async (id) => {
  if (!requireWebManage()) return
  _disableBtns(`dash-timeoff-${id}`)
  if (await _doAction(() => apiFetch(`/time-off/${id}/approve`, { method: 'PATCH', body: '{}' }))) _removePending('timeoff', id)
  else _enableBtns(`dash-timeoff-${id}`)
}
window._dashDenyTimeoff = async (id) => {
  if (!requireWebManage()) return
  _disableBtns(`dash-timeoff-${id}`)
  if (await _doAction(() => apiFetch(`/time-off/${id}/deny`, { method: 'PATCH', body: '{}' }))) _removePending('timeoff', id)
  else _enableBtns(`dash-timeoff-${id}`)
}
window._dashApproveSwap = async (id) => {
  if (!requireWebManage()) return
  _disableBtns(`dash-swap-${id}`)
  if (await _doAction(() => apiFetch(`/swaps/${id}/approve`, { method: 'PATCH', body: '{}' }))) _removePending('swap', id)
  else _enableBtns(`dash-swap-${id}`)
}
window._dashDenySwap = async (id) => {
  if (!requireWebManage()) return
  _disableBtns(`dash-swap-${id}`)
  if (await _doAction(() => apiFetch(`/swaps/${id}/deny`, { method: 'PATCH', body: '{}' }))) _removePending('swap', id)
  else _enableBtns(`dash-swap-${id}`)
}

window._dashRefresh = () => renderDashboard()
