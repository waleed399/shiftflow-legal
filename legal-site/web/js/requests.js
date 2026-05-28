import { state } from './state.js'
import { apiFetch } from './api.js'
import { esc, MONTHS } from './utils.js'
import { t } from './i18n.js'
import { requireWebManage } from './profile.js'

let activeTab = 'timeoff'

// Cached data from last fetch — tab switching re-renders without re-fetching
let _cachedSwaps   = null
let _cachedTimeoff = null

// Pagination cursors — reset on each fresh renderRequests() call
let _swapsCursor   = null
let _timeoffCursor = null
let _swapsHasMore   = false
let _timeoffHasMore = false

function fmtDate(iso) {
  if (!iso) return '?'
  const [, m, d] = iso.slice(0, 10).split('-')
  return `${parseInt(d, 10)} ${MONTHS[parseInt(m, 10) - 1]}`
}

// ── Render ────────────────────────────────────────────────────────────────────

export async function renderRequests() {
  // If cache is already warm (seeded by loadPendingCount), render immediately
  if (_cachedSwaps !== null) {
    renderTab(_cachedSwaps, _cachedTimeoff)
    return
  }

  const container = document.getElementById('requests-content')
  container.innerHTML = '<div class="loader-inline"><div class="spinner"></div></div>'

  try {
    const [sr, tr] = await Promise.all([
      apiFetch('/swaps?limit=20'),
      apiFetch('/time-off?limit=20'),
    ])
    if (!sr || !tr) return

    const swapsPage   = await sr.json()
    const timeoffPage = await tr.json()

    _cachedSwaps   = swapsPage.swaps    || []
    _cachedTimeoff = timeoffPage.requests || []
    _swapsCursor   = swapsPage.nextCursor
    _timeoffCursor = timeoffPage.nextCursor
    _swapsHasMore   = swapsPage.hasMore
    _timeoffHasMore = timeoffPage.hasMore

    const pendingSwaps   = _cachedSwaps.filter(s => s.status === 'PENDING')
    const pendingTimeoff = _cachedTimeoff.filter(t => t.status === 'PENDING')

    updateBadge(pendingSwaps.length + pendingTimeoff.length)
    updateTabCounts(pendingSwaps.length, pendingTimeoff.length)

    renderTab(_cachedSwaps, _cachedTimeoff)
  } catch {
    container.innerHTML = `<div class="empty-state"><p>${t('requests.failedLoad')}</p></div>`
  }
}

function renderTab(allSwaps, allTimeoff) {
  const container = document.getElementById('requests-content')
  const isTimeoff  = activeTab === 'timeoff'
  const all        = isTimeoff ? allTimeoff : allSwaps
  const pending    = all.filter(x => x.status === 'PENDING')
  const history    = all.filter(x => x.status !== 'PENDING')
  const hasMore    = isTimeoff ? _timeoffHasMore : _swapsHasMore

  if (!pending.length && !history.length) {
    container.innerHTML = `<div class="empty-state"><p>${t('requests.noRequests')}</p></div>`
    return
  }

  let html = ''

  if (pending.length) {
    html += pending.map(x => isTimeoff ? timeOffCard(x) : swapCard(x)).join('')
  } else {
    html += `<div class="req-no-pending">${t('requests.noPending')}</div>`
  }

  if (history.length) {
    html += `<div class="req-history-divider"><span>${t('requests.history')}</span></div>`
    html += history.map(x => isTimeoff ? timeOffHistoryCard(x) : swapHistoryCard(x)).join('')
  }

  if (hasMore) {
    html += `<div class="req-load-more-wrap"><button class="req-load-more-btn" onclick="loadMoreRequests()">${t('requests.loadMore')}</button></div>`
  }

  container.innerHTML = html
}

// ── Pending cards ─────────────────────────────────────────────────────────────

function swapCard(s) {
  const shift      = s.requesterAssignment?.shift
  const dept       = shift?.department?.name || t('common.dash')
  const date       = fmtDate(shift?.date)
  const time       = shift ? `${shift.startTime}–${shift.endTime}` : t('common.dash')
  const isOpen     = !s.targetWorkerId
  const volunteers = s.volunteers || []

  let meta = ''
  let volSelect = ''

  if (isOpen) {
    if (volunteers.length) {
      const volLabel = volunteers.length === 1 ? t('requests.volunteerOne', { n: 1 }) : t('requests.volunteerMany', { n: volunteers.length })
      meta = `<div class="req-meta">${volLabel}</div>`
      volSelect = `<select class="req-select" id="vol-${esc(s.id)}">
        <option value="">${t('requests.pickVolunteer')}</option>
        ${volunteers.map(v => `<option value="${esc(v.worker.id)}">${esc(v.worker.name)}</option>`).join('')}
      </select>`
    } else {
      meta = `<div class="req-meta req-dim">${t('requests.openNoVolunteers')}</div>`
    }
  } else {
    meta = `<div class="req-meta">→ ${esc(s.targetWorker?.name || t('common.unknown'))}</div>`
  }

  const canApprove   = !isOpen || volunteers.length > 0
  const approveClick = isOpen ? `approveSwapOpen('${s.id}')` : `approveSwap('${s.id}')`

  return `<div class="req-card req-card-swap" id="swap-${esc(s.id)}">
    <div class="req-body">
      <div class="req-who">${esc(s.requester?.name || t('common.unknown'))}</div>
      <div class="req-details">${esc(dept)} · ${esc(date)} · ${esc(time)}</div>
      ${meta}
      ${s.reason ? `<div class="req-reason">&ldquo;${esc(s.reason)}&rdquo;</div>` : ''}
      ${volSelect}
    </div>
    <div class="req-actions">
      <button class="req-btn req-approve" onclick="${approveClick}" ${canApprove ? '' : 'disabled'}>${t('requests.approve')}</button>
      <button class="req-btn req-deny" onclick="denySwap('${s.id}')">${t('requests.deny')}</button>
    </div>
  </div>`
}

function timeOffCard(req) {
  const start = fmtDate(req.startDate)
  const end   = fmtDate(req.endDate)
  const same  = req.startDate?.slice(0, 10) === req.endDate?.slice(0, 10)
  const range = same ? start : `${start} – ${end}`

  return `<div class="req-card req-card-timeoff" id="timeoff-${esc(req.id)}">
    <div class="req-body">
      <div class="req-who">${esc(req.worker?.name || t('common.unknown'))}</div>
      <div class="req-details">${range}</div>
      ${req.reason ? `<div class="req-reason">&ldquo;${esc(req.reason)}&rdquo;</div>` : ''}
    </div>
    <div class="req-actions">
      <button class="req-btn req-approve" onclick="approveTimeOff('${req.id}')">${t('requests.approve')}</button>
      <button class="req-btn req-deny" onclick="denyTimeOff('${req.id}')">${t('requests.deny')}</button>
    </div>
  </div>`
}

// ── History cards ─────────────────────────────────────────────────────────────

function statusBadge(status) {
  const map = { APPROVED: 'approved', DENIED: 'denied', CANCELLED: 'cancelled' }
  const cls   = map[status] || 'cancelled'
  return `<span class="req-status-badge req-status-${cls}">${t(`requests.statusBadge.${status}`)}</span>`
}

function swapHistoryCard(s) {
  const shift = s.requesterAssignment?.shift
  const dept  = shift?.department?.name || t('common.dash')
  const date  = fmtDate(shift?.date)
  const time  = shift ? `${shift.startTime}–${shift.endTime}` : t('common.dash')

  let meta = s.targetWorker ? `<div class="req-meta">→ ${esc(s.targetWorker.name)}</div>` : ''

  let reviewer = ''
  if (s.reviewedBy?.name && s.status !== 'CANCELLED') {
    const key = s.status === 'APPROVED' ? 'requests.approvedBy' : 'requests.deniedBy'
    reviewer = `<div class="req-reviewer">${t(key, { name: esc(s.reviewedBy.name) })}</div>`
  }

  return `<div class="req-card req-card-history">
    <div class="req-body">
      <div class="req-who">${esc(s.requester?.name || t('common.unknown'))}</div>
      <div class="req-details">${esc(dept)} · ${esc(date)} · ${esc(time)}</div>
      ${meta}
      ${s.reason ? `<div class="req-reason">&ldquo;${esc(s.reason)}&rdquo;</div>` : ''}
      ${reviewer}
    </div>
    <div class="req-actions">${statusBadge(s.status)}</div>
  </div>`
}

function timeOffHistoryCard(req) {
  const start = fmtDate(req.startDate)
  const end   = fmtDate(req.endDate)
  const same  = req.startDate?.slice(0, 10) === req.endDate?.slice(0, 10)
  const range = same ? start : `${start} – ${end}`

  let reviewer = ''
  if (req.reviewedBy?.name && req.status !== 'CANCELLED') {
    const key = req.status === 'APPROVED' ? 'requests.approvedBy' : 'requests.deniedBy'
    reviewer = `<div class="req-reviewer">${t(key, { name: esc(req.reviewedBy.name) })}</div>`
  }

  return `<div class="req-card req-card-history">
    <div class="req-body">
      <div class="req-who">${esc(req.worker?.name || t('common.unknown'))}</div>
      <div class="req-details">${range}</div>
      ${req.reason ? `<div class="req-reason">&ldquo;${esc(req.reason)}&rdquo;</div>` : ''}
      ${reviewer}
    </div>
    <div class="req-actions">${statusBadge(req.status)}</div>
  </div>`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function refreshBadges() {
  const ps = (_cachedSwaps   || []).filter(s => s.status === 'PENDING').length
  const pt = (_cachedTimeoff || []).filter(t => t.status === 'PENDING').length
  updateBadge(ps + pt)
  updateTabCounts(ps, pt)
}

function updateBadge(n) {
  state.pendingRequestCount = n
  const el = document.getElementById('req-badge')
  if (!el) return
  el.textContent = n > 0 ? String(n) : ''
  el.classList.toggle('visible', n > 0)
}

function updateTabCounts(swapCount, timeoffCount) {
  const tc = document.getElementById('req-tab-count-timeoff')
  const sc = document.getElementById('req-tab-count-swaps')
  if (tc) { tc.textContent = timeoffCount || ''; tc.classList.toggle('visible', timeoffCount > 0) }
  if (sc) { sc.textContent = swapCount || '';    sc.classList.toggle('visible', swapCount > 0) }
}

function setReqTab(tab) {
  activeTab = tab
  document.getElementById('req-tab-timeoff').classList.toggle('active', tab === 'timeoff')
  document.getElementById('req-tab-swaps').classList.toggle('active', tab === 'swaps')
  if (_cachedSwaps !== null) {
    renderTab(_cachedSwaps, _cachedTimeoff)
  } else {
    renderRequests()
  }
}

async function doAction(fn) {
  try {
    const res = await fn()
    if (!res?.ok) {
      const d = await res?.json().catch(() => ({}))
      alert(d?.error || t('requests.actionFailed'))
      return false
    }
    return true
  } catch { alert(t('common.networkError')); return false }
}

function disableSwapBtns(id) {
  document.getElementById(`swap-${id}`)?.querySelectorAll('.req-btn').forEach(b => { b.disabled = true })
}
function enableSwapBtns(id) {
  document.getElementById(`swap-${id}`)?.querySelectorAll('.req-btn').forEach(b => { b.disabled = false })
}
function disableTimeOffBtns(id) {
  document.getElementById(`timeoff-${id}`)?.querySelectorAll('.req-btn').forEach(b => { b.disabled = true })
}
function enableTimeOffBtns(id) {
  document.getElementById(`timeoff-${id}`)?.querySelectorAll('.req-btn').forEach(b => { b.disabled = false })
}

function patchCachedSwap(id, status) {
  if (_cachedSwaps) _cachedSwaps = _cachedSwaps.map(s => s.id === id ? { ...s, status } : s)
}
function patchCachedTimeOff(id, status) {
  if (_cachedTimeoff) _cachedTimeoff = _cachedTimeoff.map(t => t.id === id ? { ...t, status } : t)
}

async function approveSwap(id) {
  if (!requireWebManage()) return
  disableSwapBtns(id)
  if (await doAction(() => apiFetch(`/swaps/${id}/approve`, { method: 'PATCH', body: '{}' }))) {
    patchCachedSwap(id, 'APPROVED')
    refreshBadges()
    window.dismissNotification?.(id)
    renderTab(_cachedSwaps, _cachedTimeoff)
  } else {
    enableSwapBtns(id)
  }
}

async function approveSwapOpen(id) {
  if (!requireWebManage()) return
  const vol = document.getElementById(`vol-${id}`)?.value
  if (!vol) { alert(t('requests.pickVolunteerFirst')); return }
  disableSwapBtns(id)
  if (await doAction(() => apiFetch(`/swaps/${id}/approve`, { method: 'PATCH', body: JSON.stringify({ replacementWorkerId: vol }) }))) {
    patchCachedSwap(id, 'APPROVED')
    refreshBadges()
    window.dismissNotification?.(id)
    renderTab(_cachedSwaps, _cachedTimeoff)
  } else {
    enableSwapBtns(id)
  }
}

async function denySwap(id) {
  if (!requireWebManage()) return
  disableSwapBtns(id)
  if (await doAction(() => apiFetch(`/swaps/${id}/deny`, { method: 'PATCH', body: '{}' }))) {
    patchCachedSwap(id, 'DENIED')
    refreshBadges()
    window.dismissNotification?.(id)
    renderTab(_cachedSwaps, _cachedTimeoff)
  } else {
    enableSwapBtns(id)
  }
}

async function approveTimeOff(id) {
  if (!requireWebManage()) return
  disableTimeOffBtns(id)
  if (await doAction(() => apiFetch(`/time-off/${id}/approve`, { method: 'PATCH', body: '{}' }))) {
    patchCachedTimeOff(id, 'APPROVED')
    refreshBadges()
    window.dismissNotification?.(id)
    renderTab(_cachedSwaps, _cachedTimeoff)
  } else {
    enableTimeOffBtns(id)
  }
}

async function denyTimeOff(id) {
  if (!requireWebManage()) return
  disableTimeOffBtns(id)
  if (await doAction(() => apiFetch(`/time-off/${id}/deny`, { method: 'PATCH', body: '{}' }))) {
    patchCachedTimeOff(id, 'DENIED')
    refreshBadges()
    window.dismissNotification?.(id)
    renderTab(_cachedSwaps, _cachedTimeoff)
  } else {
    enableTimeOffBtns(id)
  }
}

export async function loadPendingCount() {
  try {
    const [sr, tr] = await Promise.all([
      apiFetch('/swaps?limit=20'),
      apiFetch('/time-off?limit=20'),
    ])
    if (!sr?.ok || !tr?.ok) return
    const sd = await sr.json()
    const td = await tr.json()

    // Seed the cache so navigating to Requests doesn't re-fetch
    _cachedSwaps   = sd.swaps    || []
    _cachedTimeoff = td.requests || []
    _swapsCursor   = sd.nextCursor
    _timeoffCursor = td.nextCursor
    _swapsHasMore   = sd.hasMore  || false
    _timeoffHasMore = td.hasMore  || false

    const s = _cachedSwaps.filter(x => x.status === 'PENDING').length
    const t = _cachedTimeoff.filter(x => x.status === 'PENDING').length
    updateBadge(s + t)
    updateTabCounts(s, t)
  } catch {}
}

export async function loadMoreRequests() {
  const isTimeoff = activeTab === 'timeoff'
  const cursor    = isTimeoff ? _timeoffCursor : _swapsCursor
  const hasMore   = isTimeoff ? _timeoffHasMore : _swapsHasMore
  if (!hasMore || !cursor) return

  const btn = document.querySelector('.req-load-more-btn')
  if (btn) { btn.disabled = true; btn.textContent = t('requests.loading') }

  try {
    const path = isTimeoff ? `/time-off?limit=20&cursor=${cursor}` : `/swaps?limit=20&cursor=${cursor}`
    const res  = await apiFetch(path)
    if (!res?.ok) return
    const page = await res.json()

    const newItems = isTimeoff ? (page.requests || []) : (page.swaps || [])

    if (isTimeoff) {
      _cachedTimeoff  = [...(_cachedTimeoff || []), ...newItems]
      _timeoffCursor  = page.nextCursor
      _timeoffHasMore = page.hasMore
    } else {
      _cachedSwaps  = [...(_cachedSwaps || []), ...newItems]
      _swapsCursor  = page.nextCursor
      _swapsHasMore = page.hasMore
    }

    renderTab(_cachedSwaps, _cachedTimeoff)
  } catch {
    if (btn) { btn.disabled = false; btn.textContent = t('requests.loadMore') }
  }
}

window.approveSwap      = approveSwap
window.approveSwapOpen  = approveSwapOpen
window.denySwap         = denySwap
window.approveTimeOff   = approveTimeOff
window.denyTimeOff      = denyTimeOff
window.setReqTab        = setReqTab
window.loadMoreRequests = loadMoreRequests
