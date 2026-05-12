import { state } from './state.js'
import { apiFetch } from './api.js'
import { esc } from './utils.js'

let activeTab = 'timeoff'

// Pagination cursors — reset on each fresh renderRequests() call
let _swapsCursor   = null
let _timeoffCursor = null
let _swapsHasMore   = false
let _timeoffHasMore = false

function fmtDate(iso) {
  if (!iso) return '?'
  const [, m, d] = iso.slice(0, 10).split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]}`
}

// ── Render ────────────────────────────────────────────────────────────────────

export async function renderRequests() {
  // Reset pagination state for fresh load
  _swapsCursor = _timeoffCursor = null
  _swapsHasMore = _timeoffHasMore = false

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

    const allSwaps   = swapsPage.swaps   || []
    const allTimeoff = timeoffPage.requests || []

    _swapsCursor   = swapsPage.nextCursor
    _timeoffCursor = timeoffPage.nextCursor
    _swapsHasMore   = swapsPage.hasMore
    _timeoffHasMore = timeoffPage.hasMore

    const pendingSwaps   = allSwaps.filter(s => s.status === 'PENDING')
    const pendingTimeoff = allTimeoff.filter(t => t.status === 'PENDING')

    updateBadge(pendingSwaps.length + pendingTimeoff.length)
    updateTabCounts(pendingSwaps.length, pendingTimeoff.length)

    renderTab(allSwaps, allTimeoff)
  } catch {
    container.innerHTML = '<div class="empty-state"><p>Failed to load requests — try again</p></div>'
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
    container.innerHTML = '<div class="empty-state"><p>No requests yet</p></div>'
    return
  }

  let html = ''

  if (pending.length) {
    html += pending.map(x => isTimeoff ? timeOffCard(x) : swapCard(x)).join('')
  } else {
    html += '<div class="req-no-pending">No pending requests</div>'
  }

  if (history.length) {
    html += `<div class="req-history-divider"><span>History</span></div>`
    html += history.map(x => isTimeoff ? timeOffHistoryCard(x) : swapHistoryCard(x)).join('')
  }

  if (hasMore) {
    html += `<div class="req-load-more-wrap"><button class="req-load-more-btn" onclick="loadMoreRequests()">Load more</button></div>`
  }

  container.innerHTML = html
}

// ── Pending cards ─────────────────────────────────────────────────────────────

function swapCard(s) {
  const shift      = s.requesterAssignment?.shift
  const dept       = shift?.department?.name || '—'
  const date       = fmtDate(shift?.date)
  const time       = shift ? `${shift.startTime}–${shift.endTime}` : '—'
  const isOpen     = !s.targetWorkerId
  const volunteers = s.volunteers || []

  let meta = ''
  let volSelect = ''

  if (isOpen) {
    if (volunteers.length) {
      meta = `<div class="req-meta">${volunteers.length} volunteer${volunteers.length > 1 ? 's' : ''}</div>`
      volSelect = `<select class="req-select" id="vol-${esc(s.id)}">
        <option value="">Pick volunteer…</option>
        ${volunteers.map(v => `<option value="${esc(v.worker.id)}">${esc(v.worker.name)}</option>`).join('')}
      </select>`
    } else {
      meta = `<div class="req-meta req-dim">Open — no volunteers yet</div>`
    }
  } else {
    meta = `<div class="req-meta">→ ${esc(s.targetWorker?.name || 'Unknown')}</div>`
  }

  const canApprove   = !isOpen || volunteers.length > 0
  const approveClick = isOpen ? `approveSwapOpen('${s.id}')` : `approveSwap('${s.id}')`

  return `<div class="req-card" id="swap-${esc(s.id)}">
    <div class="req-body">
      <div class="req-who">${esc(s.requester?.name || 'Unknown')}</div>
      <div class="req-details">${esc(dept)} · ${esc(date)} · ${esc(time)}</div>
      ${meta}
      ${s.reason ? `<div class="req-reason">&ldquo;${esc(s.reason)}&rdquo;</div>` : ''}
      ${volSelect}
    </div>
    <div class="req-actions">
      <button class="req-btn req-approve" onclick="${approveClick}" ${canApprove ? '' : 'disabled'}>Approve</button>
      <button class="req-btn req-deny" onclick="denySwap('${s.id}')">Deny</button>
    </div>
  </div>`
}

function timeOffCard(t) {
  const start = fmtDate(t.startDate)
  const end   = fmtDate(t.endDate)
  const same  = t.startDate?.slice(0, 10) === t.endDate?.slice(0, 10)
  const range = same ? start : `${start} – ${end}`

  return `<div class="req-card" id="timeoff-${esc(t.id)}">
    <div class="req-body">
      <div class="req-who">${esc(t.worker?.name || 'Unknown')}</div>
      <div class="req-details">${range}</div>
      ${t.reason ? `<div class="req-reason">&ldquo;${esc(t.reason)}&rdquo;</div>` : ''}
    </div>
    <div class="req-actions">
      <button class="req-btn req-approve" onclick="approveTimeOff('${t.id}')">Approve</button>
      <button class="req-btn req-deny" onclick="denyTimeOff('${t.id}')">Deny</button>
    </div>
  </div>`
}

// ── History cards ─────────────────────────────────────────────────────────────

function statusBadge(status) {
  const map = { APPROVED: 'approved', DENIED: 'denied', CANCELLED: 'cancelled' }
  const cls   = map[status] || 'cancelled'
  const label = status.charAt(0) + status.slice(1).toLowerCase()
  return `<span class="req-status-badge req-status-${cls}">${label}</span>`
}

function swapHistoryCard(s) {
  const shift = s.requesterAssignment?.shift
  const dept  = shift?.department?.name || '—'
  const date  = fmtDate(shift?.date)
  const time  = shift ? `${shift.startTime}–${shift.endTime}` : '—'

  let meta = s.targetWorker ? `<div class="req-meta">→ ${esc(s.targetWorker.name)}</div>` : ''

  let reviewer = ''
  if (s.reviewedBy?.name && s.status !== 'CANCELLED') {
    const verb = s.status === 'APPROVED' ? 'Approved' : 'Denied'
    reviewer = `<div class="req-reviewer">${verb} by ${esc(s.reviewedBy.name)}</div>`
  }

  return `<div class="req-card req-card-history">
    <div class="req-body">
      <div class="req-who">${esc(s.requester?.name || 'Unknown')}</div>
      <div class="req-details">${esc(dept)} · ${esc(date)} · ${esc(time)}</div>
      ${meta}
      ${s.reason ? `<div class="req-reason">&ldquo;${esc(s.reason)}&rdquo;</div>` : ''}
      ${reviewer}
    </div>
    <div class="req-actions">${statusBadge(s.status)}</div>
  </div>`
}

function timeOffHistoryCard(t) {
  const start = fmtDate(t.startDate)
  const end   = fmtDate(t.endDate)
  const same  = t.startDate?.slice(0, 10) === t.endDate?.slice(0, 10)
  const range = same ? start : `${start} – ${end}`

  let reviewer = ''
  if (t.reviewedBy?.name && t.status !== 'CANCELLED') {
    const verb = t.status === 'APPROVED' ? 'Approved' : 'Denied'
    reviewer = `<div class="req-reviewer">${verb} by ${esc(t.reviewedBy.name)}</div>`
  }

  return `<div class="req-card req-card-history">
    <div class="req-body">
      <div class="req-who">${esc(t.worker?.name || 'Unknown')}</div>
      <div class="req-details">${range}</div>
      ${t.reason ? `<div class="req-reason">&ldquo;${esc(t.reason)}&rdquo;</div>` : ''}
      ${reviewer}
    </div>
    <div class="req-actions">${statusBadge(t.status)}</div>
  </div>`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  renderRequests()
}

async function doAction(fn) {
  try {
    const res = await fn()
    if (!res?.ok) {
      const d = await res?.json().catch(() => ({}))
      alert(d?.error || 'Action failed')
      return false
    }
    return true
  } catch { alert('Network error — try again'); return false }
}

async function approveSwap(id) {
  if (await doAction(() => apiFetch(`/swaps/${id}/approve`, { method: 'PATCH', body: '{}' })))
    renderRequests()
}

async function approveSwapOpen(id) {
  const vol = document.getElementById(`vol-${id}`)?.value
  if (!vol) { alert('Pick a volunteer first'); return }
  if (await doAction(() => apiFetch(`/swaps/${id}/approve`, { method: 'PATCH', body: JSON.stringify({ replacementWorkerId: vol }) })))
    renderRequests()
}

async function denySwap(id) {
  if (await doAction(() => apiFetch(`/swaps/${id}/deny`, { method: 'PATCH', body: '{}' })))
    renderRequests()
}

async function approveTimeOff(id) {
  if (await doAction(() => apiFetch(`/time-off/${id}/approve`, { method: 'PATCH', body: '{}' })))
    renderRequests()
}

async function denyTimeOff(id) {
  if (await doAction(() => apiFetch(`/time-off/${id}/deny`, { method: 'PATCH', body: '{}' })))
    renderRequests()
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
    const s  = (sd.swaps    || []).filter(x => x.status === 'PENDING').length
    const t  = (td.requests || []).filter(x => x.status === 'PENDING').length
    updateBadge(s + t)
  } catch {}
}

export async function loadMoreRequests() {
  const isTimeoff = activeTab === 'timeoff'
  const cursor    = isTimeoff ? _timeoffCursor : _swapsCursor
  const hasMore   = isTimeoff ? _timeoffHasMore : _swapsHasMore
  if (!hasMore || !cursor) return

  const btn = document.querySelector('.req-load-more-btn')
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…' }

  try {
    const path = isTimeoff ? `/time-off?limit=20&cursor=${cursor}` : `/swaps?limit=20&cursor=${cursor}`
    const res  = await apiFetch(path)
    if (!res?.ok) return
    const page = await res.json()

    const newItems = isTimeoff ? (page.requests || []) : (page.swaps || [])

    if (isTimeoff) {
      _timeoffCursor = page.nextCursor
      _timeoffHasMore = page.hasMore
    } else {
      _swapsCursor = page.nextCursor
      _swapsHasMore = page.hasMore
    }

    // Append history cards after the existing history section
    const wrap = document.querySelector('.req-load-more-wrap')
    if (wrap) {
      const historyCards = newItems
        .filter(x => x.status !== 'PENDING')
        .map(x => isTimeoff ? timeOffHistoryCard(x) : swapHistoryCard(x))
        .join('')
      wrap.insertAdjacentHTML('beforebegin', historyCards)

      if (page.hasMore) {
        if (btn) { btn.disabled = false; btn.textContent = 'Load more' }
      } else {
        wrap.remove()
      }
    }
  } catch {
    if (btn) { btn.disabled = false; btn.textContent = 'Load more' }
  }
}

window.approveSwap      = approveSwap
window.approveSwapOpen  = approveSwapOpen
window.denySwap         = denySwap
window.approveTimeOff   = approveTimeOff
window.denyTimeOff      = denyTimeOff
window.setReqTab        = setReqTab
window.loadMoreRequests = loadMoreRequests
