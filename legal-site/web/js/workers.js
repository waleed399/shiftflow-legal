import { state, ensureOrgWorkers } from './state.js'
import { apiFetch } from './api.js'
import { esc, getInitials, applyAvatars, toYMD } from './utils.js'

let _allWorkers     = []
let _allInvitations = []
let _counts         = null

// ── Entry point ───────────────────────────────────────────────────────────────

export async function renderWorkers() {
  const el = document.getElementById('workers-content')
  el.innerHTML = '<div class="loader-inline"><div class="spinner"></div></div>'

  _counts = null
  const [workers, invitations] = await Promise.all([
    ensureOrgWorkers(),
    fetchPendingInvitations(),
  ])
  _allWorkers     = workers
  _allInvitations = invitations
  renderPage()
}

// ── Data ──────────────────────────────────────────────────────────────────────

async function fetchPendingInvitations() {
  const res = await apiFetch('/organization/invitations')
  if (!res?.ok) return []
  const all = await res.json()
  return all.filter(i => i.status === 'PENDING')
}

function getShiftCounts() {
  if (_counts) return _counts
  const shifts = state.shiftsCache[toYMD(state.currentWeek)] || []
  _counts = new Map()
  shifts.forEach(s => {
    ;(s.assignments || []).forEach(a => {
      const id = a.worker?.id
      if (id) _counts.set(id, (_counts.get(id) || 0) + 1)
    })
  })
  return _counts
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderPage() {
  const el = document.getElementById('workers-content')
  const counts = getShiftCounts()

  el.innerHTML = `
    <div class="workers-toolbar">
      <span class="workers-count">${_allWorkers.length} worker${_allWorkers.length !== 1 ? 's' : ''}</span>
      <input class="workers-search" id="workers-search" placeholder="Search by name or email…" oninput="filterWorkers(this.value)">
      <button class="btn btn-success btn-sm" onclick="openInviteForm()">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Invite worker
      </button>
    </div>

    <div class="invite-form hidden" id="invite-form">
      <input class="form-input" type="email" id="invite-email" placeholder="worker@email.com" onkeydown="onInviteKey(event)">
      <button class="btn btn-success btn-sm" id="invite-submit-btn" onclick="submitInvite()">Send invite</button>
      <button class="btn btn-ghost btn-sm" onclick="closeInviteForm()">Cancel</button>
      <span class="invite-error" id="invite-error"></span>
    </div>

    ${_allWorkers.length === 0 ? `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        <p>No workers yet</p>
        <p style="font-size:0.8rem;margin-top:6px;max-width:260px;margin-left:auto;margin-right:auto">Use the Invite button above or share your invite code from <strong>Profile</strong>.</p>
      </div>` : `
      <div class="workers-grid" id="workers-grid">
        ${_allWorkers.map(w => workerCard(w, counts.get(w.id) || 0)).join('')}
      </div>`}

    <div id="invitations-section">${invitationsHtml(_allInvitations)}</div>`

  applyAvatars(el)
}

function workerCard(w, shiftCount) {
  const initials   = esc(getInitials(w.name))
  const shiftLabel = shiftCount > 0
    ? `<span class="worker-card-shifts-badge">${shiftCount} shift${shiftCount !== 1 ? 's' : ''} this week</span>`
    : `<span class="worker-card-shifts-badge worker-card-shifts-none">No shifts this week</span>`
  return `
    <div class="worker-card">
      <div class="worker-card-avatar" data-avatar="${esc(w.avatarUrl || '')}">${initials}</div>
      <div class="worker-card-info">
        <div class="worker-card-name">${esc(w.name || '—')}</div>
        <div class="worker-card-email">${esc(w.email || '')}</div>
        ${shiftLabel}
      </div>
    </div>`
}

function invitationsHtml(invitations) {
  if (!invitations.length) return ''
  return `
    <div class="workers-section-divider"><span>Pending invitations</span></div>
    <div class="pending-invites">
      ${invitations.map(inv => `
        <div class="pending-invite-row" id="inv-${esc(inv.id)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          <div class="pending-invite-info">
            <span class="pending-invite-email">${esc(inv.email || inv.phone || '—')}</span>
            <span class="pending-invite-meta">Sent ${daysAgo(inv.createdAt)} &middot; ${daysUntil(inv.expiresAt)}</span>
          </div>
          <div class="pending-invite-actions">
            <button class="btn btn-ghost btn-sm" onclick="resendInvite('${esc(inv.id)}')">Resend</button>
            <button class="btn btn-danger btn-sm" onclick="cancelInvite('${esc(inv.id)}')">Cancel</button>
          </div>
        </div>`).join('')}
    </div>`
}

function daysAgo(iso) {
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 86400000)
  return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`
}

function daysUntil(iso) {
  const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
  return d <= 0 ? 'expired' : d === 1 ? 'expires tomorrow' : `expires in ${d} days`
}

// ── Filter ────────────────────────────────────────────────────────────────────

export function filterWorkers(query) {
  const q = query.toLowerCase().trim()
  const filtered = q
    ? _allWorkers.filter(w =>
        (w.name  || '').toLowerCase().includes(q) ||
        (w.email || '').toLowerCase().includes(q))
    : _allWorkers

  const counts = getShiftCounts()
  const grid = document.getElementById('workers-grid')
  if (!grid) return
  if (!filtered.length) {
    grid.innerHTML = '<p class="workers-empty-filter">No workers match your search</p>'
    return
  }
  grid.innerHTML = filtered.map(w => workerCard(w, counts.get(w.id) || 0)).join('')
  applyAvatars(grid)
}

// ── Invite form ───────────────────────────────────────────────────────────────

export function openInviteForm() {
  const form = document.getElementById('invite-form')
  form.classList.remove('hidden')
  document.getElementById('invite-email').focus()
}

export function closeInviteForm() {
  document.getElementById('invite-form').classList.add('hidden')
  document.getElementById('invite-email').value = ''
  document.getElementById('invite-error').textContent = ''
}

export function onInviteKey(e) {
  if (e.key === 'Enter') submitInvite()
  if (e.key === 'Escape') closeInviteForm()
}

export async function submitInvite() {
  const emailEl = document.getElementById('invite-email')
  const errEl   = document.getElementById('invite-error')
  const btn     = document.getElementById('invite-submit-btn')
  const email   = emailEl.value.trim()

  if (!email) { errEl.textContent = 'Enter an email address'; return }
  errEl.textContent = ''
  btn.disabled = true
  btn.textContent = 'Sending…'

  try {
    const res = await apiFetch('/organization/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (!res?.ok) {
      const d = await res?.json().catch(() => ({}))
      errEl.textContent = d?.error || 'Failed to send invite'
      return
    }
    const inv = await res.json()
    _allInvitations = [inv, ..._allInvitations]
    closeInviteForm()
    document.getElementById('invitations-section').innerHTML = invitationsHtml(_allInvitations)
  } finally {
    btn.disabled = false
    btn.textContent = 'Send invite'
  }
}

// ── Invitation actions ────────────────────────────────────────────────────────

export async function resendInvite(id) {
  const res = await apiFetch(`/organization/invitations/${id}/resend`, { method: 'POST', body: '{}' })
  if (!res?.ok) { alert('Failed to resend — try again'); return }
  const row = document.getElementById(`inv-${id}`)
  if (row) {
    const meta = row.querySelector('.pending-invite-meta')
    if (meta) meta.textContent = 'Sent just now · expires in 7 days'
  }
}

export async function cancelInvite(id) {
  const res = await apiFetch(`/organization/invitations/${id}`, { method: 'DELETE' })
  if (!res?.ok) { alert('Failed to cancel — try again'); return }
  _allInvitations = _allInvitations.filter(i => i.id !== id)
  document.getElementById('invitations-section').innerHTML = invitationsHtml(_allInvitations)
}

// ── Window exports ────────────────────────────────────────────────────────────

window.filterWorkers  = filterWorkers
window.openInviteForm = openInviteForm
window.closeInviteForm = closeInviteForm
window.onInviteKey    = onInviteKey
window.submitInvite   = submitInvite
window.resendInvite   = resendInvite
window.cancelInvite   = cancelInvite
