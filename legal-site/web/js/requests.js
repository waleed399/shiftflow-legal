import { state } from './state.js'
import { apiFetch } from './api.js'
import { esc } from './utils.js'

function fmtDate(iso) {
  if (!iso) return '?'
  const [, m, d] = iso.slice(0, 10).split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]}`
}

export async function renderRequests() {
  const container = document.getElementById('requests-content')
  container.innerHTML = '<div class="loader-inline"><div class="spinner"></div></div>'

  try {
    const [sr, tr] = await Promise.all([apiFetch('/swaps'), apiFetch('/time-off')])
    if (!sr || !tr) return

    const swaps   = (await sr.json()).filter(s => s.status === 'PENDING')
    const timeoff = (await tr.json()).filter(t => t.status === 'PENDING')

    updateBadge(swaps.length + timeoff.length)

    if (!swaps.length && !timeoff.length) {
      container.innerHTML = '<div class="empty-state"><p>All caught up — no pending requests</p></div>'
      return
    }

    let html = ''

    if (swaps.length) {
      html += `<div class="req-section"><div class="req-section-title">Swap requests <span class="req-count">${swaps.length}</span></div>`
      swaps.forEach(s => { html += swapCard(s) })
      html += '</div>'
    }

    if (timeoff.length) {
      html += `<div class="req-section"><div class="req-section-title">Time-off requests <span class="req-count">${timeoff.length}</span></div>`
      timeoff.forEach(t => { html += timeOffCard(t) })
      html += '</div>'
    }

    container.innerHTML = html
  } catch {
    container.innerHTML = '<div class="empty-state"><p>Failed to load requests — try again</p></div>'
  }
}

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

  const canApprove    = !isOpen || volunteers.length > 0
  const approveClick  = isOpen ? `approveSwapOpen('${s.id}')` : `approveSwap('${s.id}')`

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

function updateBadge(n) {
  state.pendingRequestCount = n
  const el = document.getElementById('req-badge')
  if (!el) return
  el.textContent = n > 0 ? String(n) : ''
  el.classList.toggle('visible', n > 0)
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
