import { state } from './state.js'
import { apiFetch } from './api.js'
import { esc } from './utils.js'

let activeTab = 'timeoff'

function fmtDate(iso) {
  if (!iso) return '?'
  const [, m, d] = iso.slice(0, 10).split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]}`
}

// ── Render ────────────────────────────────────────────────────────────────────

export async function renderRequests() {
  const container = document.getElementById('requests-content')
  container.innerHTML = '<div class="loader-inline"><div class="spinner"></div></div>'

  try {
    const [sr, tr] = await Promise.all([apiFetch('/swaps'), apiFetch('/time-off')])
    if (!sr || !tr) return

    const allSwaps   = await sr.json()
    const allTimeoff = await tr.json()

    const pendingSwaps   = allSwaps.filter(s => s.status === 'PENDING')
    const pendingTimeoff = allTimeoff.filter(t => t.status === 'PENDING')

    updateBadge(pendingSwaps.length + pendingTimeoff.length)
    updateTabCounts(pendingSwaps.length, pendingTimeoff.length)

    const isTimeoff = activeTab === 'timeoff'
    const pending = isTimeoff ? pendingTimeoff : pendingSwaps
    const history = (isTimeoff ? allTimeoff : allSwaps)
      .filter(x => x.status !== 'PENDING')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

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

    container.innerHTML = html
  } catch {
    container.innerHTML = '<div class="empty-state"><p>Failed to load requests — try again</p></div>'
  }
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
    const [sr, tr] = await Promise.all([apiFetch('/swaps'), apiFetch('/time-off')])
    if (!sr?.ok || !tr?.ok) return
    const s = (await sr.json()).filter(x => x.status === 'PENDING').length
    const t = (await tr.json()).filter(x => x.status === 'PENDING').length
    updateBadge(s + t)
  } catch {}
}

window.approveSwap      = approveSwap
window.approveSwapOpen  = approveSwapOpen
window.denySwap         = denySwap
window.approveTimeOff   = approveTimeOff
window.denyTimeOff      = denyTimeOff
window.setReqTab        = setReqTab
