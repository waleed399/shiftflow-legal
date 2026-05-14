import { state, ensureOrgWorkers } from './state.js'
import { apiFetch } from './api.js'
import { esc, getInitials, applyAvatars, toYMD } from './utils.js'

// ── Module state ──────────────────────────────────────────────────────────────

let _allWorkers      = []
let _allDepts        = []
let _allInvitations  = []
let _counts          = null
let _drawerWorkerId  = null
let _confirmCallback = null

// ── Dept color ────────────────────────────────────────────────────────────────

const DEPT_COLORS = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ef4444','#14b8a6']

function deptColor(id) {
  let h = 0
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) | 0
  return DEPT_COLORS[Math.abs(h) % DEPT_COLORS.length]
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function renderWorkers() {
  const el = document.getElementById('workers-content')
  el.innerHTML = '<div class="loader-inline"><div class="spinner"></div></div>'

  state.orgWorkers = null  // force fresh fetch so departmentIds are current
  _counts = null

  const [workers, depts, invitations] = await Promise.all([
    ensureOrgWorkers(),
    fetchDepts(),
    fetchPendingInvitations(),
  ])
  _allWorkers     = workers
  _allDepts       = depts
  _allInvitations = invitations

  renderPage()
}

// ── Data ──────────────────────────────────────────────────────────────────────

async function fetchDepts() {
  const res = await apiFetch('/departments')
  if (!res?.ok) return []
  return res.json()
}

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

// ── Page render ───────────────────────────────────────────────────────────────

function renderPage() {
  const el     = document.getElementById('workers-content')
  const counts = getShiftCounts()

  el.innerHTML = `
    <div class="workers-layout">

      <div class="dept-panel">
        <div class="dept-panel-header">
          <span class="dept-panel-title">Departments</span>
        </div>
        <div class="dept-list" id="dept-list">
          ${deptListHtml()}
        </div>
        <div class="dept-add-form" id="dept-add-form">
          <input class="form-input dept-add-input" id="dept-add-input"
                 placeholder="New department name…" maxlength="60"
                 onkeydown="onDeptAddKey(event)">
          <div class="dept-add-row">
            <button class="btn btn-success btn-sm" id="dept-add-btn" onclick="submitCreateDept()">Add</button>
            <button class="btn btn-ghost btn-sm" onclick="cancelCreateDept()">Cancel</button>
          </div>
          <div class="dept-add-error" id="dept-add-error"></div>
        </div>
        <button class="dept-add-trigger" onclick="openCreateDept()">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New department
        </button>
      </div>

      <div class="workers-panel">
        <div class="workers-toolbar">
          <span class="workers-count">${_allWorkers.length} worker${_allWorkers.length !== 1 ? 's' : ''}</span>
          <input class="workers-search" id="workers-search" placeholder="Search…" oninput="filterWorkers(this.value)">
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

        <div class="workers-panel-scroll">
          ${_allWorkers.length === 0 ? `
            <div class="empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              <p>No workers yet</p>
              <p style="font-size:0.8rem;margin-top:6px;max-width:260px;margin-left:auto;margin-right:auto">Use the Invite button above or share your invite code from <strong>Profile</strong>.</p>
            </div>` : `
            <div class="workers-grid" id="workers-grid">
              ${_allWorkers.map(w => workerCard(w, counts.get(w.id) || 0)).join('')}
            </div>`}
          <div id="invitations-section">${invitationsHtml(_allInvitations)}</div>
        </div>
      </div>

    </div>`

  applyAvatars(el)
}

// ── Dept panel HTML ───────────────────────────────────────────────────────────

function deptListHtml() {
  if (!_allDepts.length) {
    return '<div class="dept-empty">No departments yet</div>'
  }
  return _allDepts.map(d => {
    const color      = deptColor(d.id)
    const memberCount = _allWorkers.filter(w => (w.departmentIds || []).includes(d.id)).length
    return `
      <div class="dept-item" id="dept-item-${esc(d.id)}">
        <div class="dept-item-stripe" style="background:${color}"></div>
        <div class="dept-item-body">
          <div class="dept-item-name" id="dept-name-${esc(d.id)}">${esc(d.name)}</div>
          <div class="dept-item-count">${memberCount} worker${memberCount !== 1 ? 's' : ''}</div>
        </div>
        <div class="dept-item-actions">
          <button class="dept-action-btn" title="Rename" onclick="renameDept('${esc(d.id)}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="dept-action-btn dept-action-delete" title="Delete" onclick="deleteDept('${esc(d.id)}','${esc(d.name)}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </div>`
  }).join('')
}

// ── Worker card ───────────────────────────────────────────────────────────────

function workerCard(w, shiftCount) {
  const initials   = esc(getInitials(w.name))
  const shiftLabel = shiftCount > 0
    ? `<span class="worker-card-shifts-badge">${shiftCount} shift${shiftCount !== 1 ? 's' : ''} this week</span>`
    : `<span class="worker-card-shifts-badge worker-card-shifts-none">No shifts this week</span>`

  const deptIds = w.departmentIds || []
  let deptBadges
  if (deptIds.length === 0) {
    deptBadges = `<span class="worker-dept-badge worker-dept-any">All departments</span>`
  } else {
    deptBadges = deptIds.map(id => {
      const dept  = _allDepts.find(d => d.id === id)
      if (!dept) return ''
      const color = deptColor(id)
      return `<span class="worker-dept-badge" style="border-color:${color};color:${color};background:${color}18">${esc(dept.name)}</span>`
    }).join('')
  }

  return `
    <div class="worker-card worker-card-clickable" onclick="openWorkerDrawer('${esc(w.id)}')">
      <div class="worker-card-avatar" data-avatar="${esc(w.avatarUrl || '')}">${initials}</div>
      <div class="worker-card-info">
        <div class="worker-card-name">${esc(w.name || '—')}</div>
        <div class="worker-card-email">${esc(w.email || '')}</div>
        <div class="worker-card-dept-badges">${deptBadges}</div>
        ${shiftLabel}
      </div>
      <svg class="worker-card-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </div>`
}

// ── Dept CRUD ─────────────────────────────────────────────────────────────────

export function openCreateDept() {
  document.getElementById('dept-add-form').classList.add('active')
  document.getElementById('dept-add-input').focus()
}

export function cancelCreateDept() {
  document.getElementById('dept-add-form').classList.remove('active')
  document.getElementById('dept-add-input').value = ''
  document.getElementById('dept-add-error').textContent = ''
}

export function onDeptAddKey(e) {
  if (e.key === 'Enter') submitCreateDept()
  if (e.key === 'Escape') cancelCreateDept()
}

export async function submitCreateDept() {
  const input = document.getElementById('dept-add-input')
  const errEl = document.getElementById('dept-add-error')
  const btn   = document.getElementById('dept-add-btn')
  const name  = input.value.trim()
  if (!name) { errEl.textContent = 'Enter a department name'; return }
  errEl.textContent = ''
  btn.disabled = true
  btn.textContent = '…'

  try {
    const res = await apiFetch('/departments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res?.ok) {
      const d = await res?.json().catch(() => ({}))
      errEl.textContent = d?.error || 'Failed to create department'
      return
    }
    const dept = await res.json()
    _allDepts = [..._allDepts, dept]
    cancelCreateDept()
    document.getElementById('dept-list').innerHTML = deptListHtml()
  } finally {
    btn.disabled = false
    btn.textContent = 'Add'
  }
}

export function renameDept(id) {
  const nameEl = document.getElementById(`dept-name-${id}`)
  if (!nameEl || nameEl.querySelector('input')) return

  const currentName = nameEl.textContent.trim()
  nameEl.innerHTML = `<input class="dept-rename-input" id="dept-rename-${esc(id)}"
    value="${esc(currentName)}" maxlength="60"
    onblur="submitRenameDept('${esc(id)}')"
    onkeydown="onDeptRenameKey(event,'${esc(id)}')">`
  const inp = document.getElementById(`dept-rename-${id}`)
  inp.focus()
  inp.select()
}

export async function submitRenameDept(id) {
  const input = document.getElementById(`dept-rename-${id}`)
  if (!input) return
  const newName = input.value.trim()
  const dept    = _allDepts.find(d => d.id === id)
  if (!dept) return

  const nameEl = document.getElementById(`dept-name-${id}`)
  if (!newName || newName === dept.name) {
    if (nameEl) nameEl.textContent = dept.name
    return
  }

  input.disabled = true
  const res = await apiFetch(`/departments/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName }),
  })
  if (!res?.ok) {
    if (nameEl) nameEl.textContent = dept.name
    alert('Failed to rename — try again')
    return
  }
  _allDepts = _allDepts.map(d => d.id === id ? { ...d, name: newName } : d)
  document.getElementById('dept-list').innerHTML = deptListHtml()
  renderWorkersGrid()
}

export function onDeptRenameKey(e, id) {
  if (e.key === 'Enter') e.target.blur()
  if (e.key === 'Escape') {
    const dept   = _allDepts.find(d => d.id === id)
    const nameEl = document.getElementById(`dept-name-${id}`)
    if (nameEl && dept) nameEl.textContent = dept.name
  }
}

export function deleteDept(id, name) {
  showConfirmDialog(
    `Delete "${name}"?`,
    `Removing this department will unassign all workers from it and cancel any upcoming shifts tagged to <strong>${esc(name)}</strong>. This cannot be undone.`,
    async () => {
      const res = await apiFetch(`/departments/${id}`, { method: 'DELETE' })
      if (!res?.ok) { alert('Failed to delete department — try again'); return }
      _allDepts   = _allDepts.filter(d => d.id !== id)
      _allWorkers = _allWorkers.map(w => ({
        ...w,
        departmentIds: (w.departmentIds || []).filter(did => did !== id),
      }))
      document.getElementById('dept-list').innerHTML = deptListHtml()
      renderWorkersGrid()
    }
  )
}

// ── Worker drawer ─────────────────────────────────────────────────────────────

export function openWorkerDrawer(workerId) {
  const worker = _allWorkers.find(w => w.id === workerId)
  if (!worker) return
  _drawerWorkerId = workerId

  const drawer   = document.getElementById('worker-drawer')
  const backdrop = document.getElementById('drawer-backdrop')
  const deptIds  = worker.departmentIds || []

  drawer.innerHTML = `
    <div class="drawer-header">
      <div class="drawer-worker-info">
        <div class="drawer-avatar" data-avatar="${esc(worker.avatarUrl || '')}">${esc(getInitials(worker.name))}</div>
        <div>
          <div class="drawer-worker-name">${esc(worker.name || '—')}</div>
          <div class="drawer-worker-email">${esc(worker.email || '')}</div>
        </div>
      </div>
      <button class="modal-close" onclick="closeWorkerDrawer()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="drawer-section-label">Department membership</div>
    <div class="drawer-dept-hint">
      ${deptIds.length === 0
        ? 'Currently has access to <strong>all departments</strong>. Assign one to restrict.'
        : 'Toggle departments to add or remove this worker.'}
    </div>
    <div class="drawer-dept-list" id="drawer-dept-list">
      ${drawerDeptListHtml(deptIds)}
    </div>`

  applyAvatars(drawer)
  backdrop.classList.add('active')
  drawer.classList.add('open')
}

function drawerDeptListHtml(deptIds) {
  if (!_allDepts.length) {
    return '<div class="dept-empty" style="padding:12px 0">No departments created yet.</div>'
  }
  return _allDepts.map(d => {
    const color   = deptColor(d.id)
    const checked = deptIds.includes(d.id)
    return `
      <div class="drawer-dept-toggle ${checked ? 'checked' : ''}" id="drawer-toggle-${esc(d.id)}"
           onclick="toggleDeptMembership('${esc(d.id)}')">
        <div class="drawer-dept-toggle-stripe" style="background:${color}"></div>
        <span class="drawer-dept-toggle-name">${esc(d.name)}</span>
        <div class="drawer-dept-toggle-check ${checked ? 'on' : ''}">
          ${checked ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
        </div>
      </div>`
  }).join('')
}

export function closeWorkerDrawer() {
  document.getElementById('worker-drawer').classList.remove('open')
  document.getElementById('drawer-backdrop').classList.remove('active')
  _drawerWorkerId = null
}

export async function toggleDeptMembership(deptId) {
  if (!_drawerWorkerId) return
  const worker  = _allWorkers.find(w => w.id === _drawerWorkerId)
  if (!worker) return
  const deptIds = worker.departmentIds || []
  const isOn    = deptIds.includes(deptId)

  const toggleEl = document.getElementById(`drawer-toggle-${deptId}`)
  if (toggleEl) { toggleEl.style.opacity = '0.45'; toggleEl.style.pointerEvents = 'none' }

  const res = await apiFetch(
    `/workers/${_drawerWorkerId}/departments${isOn ? `/${deptId}` : ''}`,
    {
      method:  isOn ? 'DELETE' : 'POST',
      headers: !isOn ? { 'Content-Type': 'application/json' } : undefined,
      body:    !isOn ? JSON.stringify({ departmentId: deptId }) : undefined,
    }
  )

  if (!res?.ok) {
    if (toggleEl) { toggleEl.style.opacity = ''; toggleEl.style.pointerEvents = '' }
    alert('Failed to update department — try again')
    return
  }

  const newDeptIds = isOn
    ? deptIds.filter(id => id !== deptId)
    : [...deptIds, deptId]

  _allWorkers = _allWorkers.map(w =>
    w.id === _drawerWorkerId ? { ...w, departmentIds: newDeptIds } : w
  )

  const deptListEl = document.getElementById('drawer-dept-list')
  if (deptListEl) deptListEl.innerHTML = drawerDeptListHtml(newDeptIds)

  const hintEl = document.querySelector('.drawer-dept-hint')
  if (hintEl) hintEl.innerHTML = newDeptIds.length === 0
    ? 'Currently has access to <strong>all departments</strong>. Assign one to restrict.'
    : 'Toggle departments to add or remove this worker.'

  document.getElementById('dept-list').innerHTML = deptListHtml()
  renderWorkersGrid()
}

// ── Workers grid re-render ────────────────────────────────────────────────────

function renderWorkersGrid() {
  const counts = getShiftCounts()
  const grid   = document.getElementById('workers-grid')
  if (!grid) return
  grid.innerHTML = _allWorkers.map(w => workerCard(w, counts.get(w.id) || 0)).join('')
  applyAvatars(grid)
}

// ── Confirm dialog ────────────────────────────────────────────────────────────

function showConfirmDialog(title, bodyHtml, onConfirm) {
  _confirmCallback = onConfirm
  document.getElementById('confirm-title').textContent = title
  document.getElementById('confirm-body').innerHTML    = bodyHtml
  document.getElementById('confirm-overlay').classList.add('active')
}

export function closeConfirmDialog() {
  document.getElementById('confirm-overlay').classList.remove('active')
  _confirmCallback = null
}

export async function confirmDialogOk() {
  const cb = _confirmCallback
  closeConfirmDialog()
  if (cb) await cb()
}

// ── Filter ────────────────────────────────────────────────────────────────────

export function filterWorkers(query) {
  const q        = query.toLowerCase().trim()
  const filtered = q
    ? _allWorkers.filter(w =>
        (w.name  || '').toLowerCase().includes(q) ||
        (w.email || '').toLowerCase().includes(q))
    : _allWorkers

  const counts = getShiftCounts()
  const grid   = document.getElementById('workers-grid')
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
  document.getElementById('invite-form').classList.remove('hidden')
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

// ── Invitations HTML ──────────────────────────────────────────────────────────

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

// ── Window exports ────────────────────────────────────────────────────────────

window.filterWorkers        = filterWorkers
window.openInviteForm       = openInviteForm
window.closeInviteForm      = closeInviteForm
window.onInviteKey          = onInviteKey
window.submitInvite         = submitInvite
window.resendInvite         = resendInvite
window.cancelInvite         = cancelInvite
window.openCreateDept       = openCreateDept
window.cancelCreateDept     = cancelCreateDept
window.onDeptAddKey         = onDeptAddKey
window.submitCreateDept     = submitCreateDept
window.renameDept           = renameDept
window.submitRenameDept     = submitRenameDept
window.onDeptRenameKey      = onDeptRenameKey
window.deleteDept           = deleteDept
window.openWorkerDrawer     = openWorkerDrawer
window.closeWorkerDrawer    = closeWorkerDrawer
window.toggleDeptMembership = toggleDeptMembership
window.closeConfirmDialog   = closeConfirmDialog
window.confirmDialogOk      = confirmDialogOk
