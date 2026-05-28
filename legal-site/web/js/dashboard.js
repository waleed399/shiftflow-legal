import { state } from './state.js'
import { apiFetch } from './api.js'
import { esc, addDays, toYMD, isSameDay } from './utils.js'
import { t } from './i18n.js'
import { requireWebManage } from './profile.js'

let _pendingSwaps   = []
let _pendingTimeoff = []
let _weekShifts     = []

export async function renderDashboard() {
  const el = document.getElementById('dashboard-content')
  el.innerHTML = '<div class="loader-inline"><div class="spinner"></div></div>'
  try {
    await Promise.all([_loadWeekShifts(), _loadPendingRequests()])
    el.innerHTML = _buildHTML()
  } catch {
    el.innerHTML = `<div class="empty-state"><p>${t('common.networkError')}</p></div>`
  }
}

async function _loadWeekShifts() {
  const key = toYMD(state.currentWeek)
  if (!state.shiftsCache[key]) {
    const res = await apiFetch(`/shifts?weekOf=${key}`)
    if (!res) return
    state.shiftsCache[key] = await res.json()
  }
  _weekShifts = state.shiftsCache[key] || []
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

// ── Build HTML ────────────────────────────────────────────────────────────────

function _buildHTML() {
  const today    = new Date()
  const todayYMD = toYMD(today)

  const todayShifts = _weekShifts
    .filter(s => s.date?.substring(0, 10) === todayYMD && s.status !== 'CANCELLED')
    .sort((a, b) => a.startTime.localeCompare(b.startTime))

  const totalAssigned = todayShifts.reduce((n, s) => n + (s.assignments?.length || 0), 0)
  const totalRequired = todayShifts.reduce((n, s) => n + (s.requiredWorkers || 0), 0)
  const coverage      = totalRequired > 0 ? Math.round(totalAssigned / totalRequired * 100) : (todayShifts.length ? 100 : 0)
  const pendingTotal  = _pendingSwaps.length + _pendingTimeoff.length

  const firstName  = state.currentUser?.name?.split(' ')[0] || ''
  const hour       = today.getHours()
  const greetKey   = hour < 12 ? 'dashboard.goodMorning' : hour < 17 ? 'dashboard.goodAfternoon' : 'dashboard.goodEvening'
  const coverColor = coverage >= 100 ? '#059669' : coverage >= 60 ? '#d97706' : '#dc2626'

  const weekTotal = _weekShifts.filter(s => s.status !== 'CANCELLED').length

  return `
    <div class="dash-hero">
      <div class="dash-greeting">
        <span class="dash-greeting-text">${t(greetKey, { name: esc(firstName) })}</span>
        <span class="dash-date">${_fmtFullDate(today)}</span>
      </div>
      <button class="dash-refresh-btn" onclick="window._dashRefresh()" title="${t('dashboard.refresh')}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
      </button>
    </div>

    <div class="dash-kpis">
      <div class="dash-kpi">
        <div class="dash-kpi-icon dash-kpi-icon-blue">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </div>
        <div class="dash-kpi-body">
          <div class="dash-kpi-num">${todayShifts.length}</div>
          <div class="dash-kpi-label">${t('dashboard.shiftsToday')}</div>
        </div>
      </div>
      <div class="dash-kpi">
        <div class="dash-kpi-icon dash-kpi-icon-green">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <div class="dash-kpi-body">
          <div class="dash-kpi-num">${totalAssigned}</div>
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
      <div class="dash-kpi${pendingTotal > 0 ? ' dash-kpi-alert' : ''}" ${pendingTotal > 0 ? 'onclick="window.showView(\'requests\')" style="cursor:pointer"' : ''}>
        <div class="dash-kpi-icon${pendingTotal > 0 ? ' dash-kpi-icon-red' : ' dash-kpi-icon-muted'}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        </div>
        <div class="dash-kpi-body">
          <div class="dash-kpi-num">${pendingTotal}</div>
          <div class="dash-kpi-label">${t('dashboard.pendingRequests')}</div>
        </div>
        ${pendingTotal > 0 ? '<div class="dash-kpi-arrow">→</div>' : ''}
      </div>
    </div>

    ${_buildWeekBars(weekTotal)}

    <div class="dash-main">
      <div class="dash-panel">
        <div class="dash-panel-header">
          <span class="dash-panel-title">${t('dashboard.todaysShifts')}</span>
          <button class="dash-panel-link" onclick="window.showView('shifts')">${t('dashboard.viewAll')}</button>
        </div>
        <div class="dash-shifts-list">
          ${todayShifts.length
            ? todayShifts.map(_shiftRow).join('')
            : `<div class="dash-empty-msg">${t('dashboard.noShiftsToday')}</div>`}
        </div>
      </div>
      <div class="dash-panel">
        <div class="dash-panel-header">
          <span class="dash-panel-title">${t('dashboard.pendingApprovals')}</span>
          ${pendingTotal > 0 ? `<button class="dash-panel-link" onclick="window.showView('requests')">${t('dashboard.viewAll')}</button>` : ''}
        </div>
        <div id="dash-pending-list">${_buildPendingHTML()}</div>
      </div>
    </div>
  `
}

function _buildWeekBars(weekTotal) {
  const today    = new Date()
  const DAY_CODES = ['SUN','MON','TUE','WED','THU','FRI','SAT']
  const days = []

  for (let i = 0; i < 7; i++) {
    const d      = addDays(state.currentWeek, i)
    const ymd    = toYMD(d)
    const shifts = _weekShifts.filter(s => s.date?.substring(0, 10) === ymd && s.status !== 'CANCELLED')
    days.push({ d, shifts, isToday: isSameDay(d, today), code: DAY_CODES[d.getDay()] })
  }

  const maxCount = Math.max(...days.map(dy => dy.shifts.length), 1)

  const bars = days.map(({ d, shifts, isToday, code }) => {
    const pct   = Math.round(shifts.length / maxCount * 100)
    const color = isToday ? 'var(--red)' : 'var(--navy-mid)'
    return `
      <div class="dash-week-day${isToday ? ' dash-week-day-today' : ''}">
        <div class="dash-week-bar-wrap">
          <div class="dash-week-bar" style="height:${Math.max(pct, 5)}%; background:${color}"></div>
        </div>
        <div class="dash-week-label">
          <div class="dash-week-day-name">${t(`days.short.${code}`)}</div>
          <div class="dash-week-count">${shifts.length}</div>
        </div>
      </div>`
  }).join('')

  return `
    <div class="dash-week-section">
      <div class="dash-week-header">
        <span class="dash-week-title">${t('dashboard.thisWeek')}</span>
        <span class="dash-week-subtitle">${t('dashboard.shiftsTotal', { n: weekTotal })}</span>
      </div>
      <div class="dash-week-bars">${bars}</div>
    </div>`
}

function _shiftRow(shift) {
  const isActive = shift.status === 'ACTIVE'
  const dept     = shift.department?.name || '—'
  const assigned = shift.assignments?.length || 0
  const required = shift.requiredWorkers || 0
  const full     = assigned >= required
  const color    = full ? '#059669' : assigned > 0 ? '#d97706' : '#dc2626'

  return `
    <div class="dash-shift-row">
      ${isActive
        ? '<span class="dash-live-dot" title="Active"></span>'
        : '<span class="dash-live-dot-spacer"></span>'}
      <div class="dash-shift-time">${shift.startTime?.substring(0, 5) || '—'}</div>
      <div class="dash-shift-dept">${esc(dept)}</div>
      <div class="dash-shift-coverage" style="color:${color}">${assigned}/${required}</div>
    </div>`
}

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
  const start = _fmtShortDate(req.startDate)
  const end   = _fmtShortDate(req.endDate)
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
  const date   = _fmtShortDate(shift?.date)
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

function _fmtShortDate(iso) {
  if (!iso) return '?'
  const [, m, d] = iso.slice(0, 10).split('-')
  const months = t('months.short')
  return `${parseInt(d, 10)} ${Array.isArray(months) ? months[parseInt(m, 10) - 1] : ''}`
}

function _fmtFullDate(date) {
  const CODES  = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY']
  const dayStr = t(`days.full.${CODES[date.getDay()]}`)
  const months = t('months.short')
  const moStr  = Array.isArray(months) ? months[date.getMonth()] : ''
  return `${dayStr}, ${date.getDate()} ${moStr} ${date.getFullYear()}`
}

// ── Inline approve / deny ─────────────────────────────────────────────────────

async function _doAction(fn) {
  try {
    const res = await fn()
    return res?.ok ?? false
  } catch { return false }
}

function _removePending(type, id) {
  if (type === 'timeoff') _pendingTimeoff = _pendingTimeoff.filter(r => r.id !== id)
  else                    _pendingSwaps   = _pendingSwaps.filter(s => s.id !== id)

  // Sync nav badge
  const total = _pendingSwaps.length + _pendingTimeoff.length
  state.pendingRequestCount = total
  const badge = document.getElementById('req-badge')
  if (badge) {
    badge.textContent = total > 0 ? String(total) : ''
    badge.classList.toggle('visible', total > 0)
  }

  window.dismissNotification?.(id)

  const list = document.getElementById('dash-pending-list')
  if (list) list.innerHTML = _buildPendingHTML()
}

function _disableBtns(cardId) {
  document.getElementById(cardId)?.querySelectorAll('button').forEach(b => { b.disabled = true })
}
function _enableBtns(cardId) {
  document.getElementById(cardId)?.querySelectorAll('button').forEach(b => { b.disabled = false })
}

window._dashApproveTimeoff = async (id) => {
  if (!requireWebManage()) return
  _disableBtns(`dash-timeoff-${id}`)
  if (await _doAction(() => apiFetch(`/time-off/${id}/approve`, { method: 'PATCH', body: '{}' })))
    _removePending('timeoff', id)
  else
    _enableBtns(`dash-timeoff-${id}`)
}

window._dashDenyTimeoff = async (id) => {
  if (!requireWebManage()) return
  _disableBtns(`dash-timeoff-${id}`)
  if (await _doAction(() => apiFetch(`/time-off/${id}/deny`, { method: 'PATCH', body: '{}' })))
    _removePending('timeoff', id)
  else
    _enableBtns(`dash-timeoff-${id}`)
}

window._dashApproveSwap = async (id) => {
  if (!requireWebManage()) return
  _disableBtns(`dash-swap-${id}`)
  if (await _doAction(() => apiFetch(`/swaps/${id}/approve`, { method: 'PATCH', body: '{}' })))
    _removePending('swap', id)
  else
    _enableBtns(`dash-swap-${id}`)
}

window._dashDenySwap = async (id) => {
  if (!requireWebManage()) return
  _disableBtns(`dash-swap-${id}`)
  if (await _doAction(() => apiFetch(`/swaps/${id}/deny`, { method: 'PATCH', body: '{}' })))
    _removePending('swap', id)
  else
    _enableBtns(`dash-swap-${id}`)
}

window._dashRefresh = () => renderDashboard()
