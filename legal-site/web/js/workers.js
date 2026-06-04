import { state, ensureOrgWorkers } from './state.js'
import { apiFetch } from './api.js'
import { esc, getInitials, applyAvatars, toYMD } from './utils.js'
import { t } from './i18n.js'
import { requireWebManage } from './profile.js'

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
          <span class="dept-panel-title">${t('workers.departments')}</span>
        </div>
        <div class="dept-list" id="dept-list">
          ${deptListHtml()}
        </div>
        <div class="dept-add-form" id="dept-add-form">
          <input class="form-input dept-add-input" id="dept-add-input"
                 placeholder="${t('workers.deptPlaceholder')}" maxlength="60"
                 onkeydown="onDeptAddKey(event)">
          <div class="dept-add-row">
            <button class="btn btn-success btn-sm" id="dept-add-btn" onclick="submitCreateDept()">${t('workers.addDept')}</button>
            <button class="btn btn-ghost btn-sm" onclick="cancelCreateDept()">${t('common.cancel')}</button>
          </div>
          <div class="dept-add-error" id="dept-add-error"></div>
        </div>
        <button class="dept-add-trigger" onclick="openCreateDept()">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          ${t('workers.newDept')}
        </button>
      </div>

      <div class="workers-panel">
        <div class="workers-toolbar">
          <span class="workers-count">${_allWorkers.length === 1 ? t('workers.workerCountOne', { n: 1 }) : t('workers.workerCountMany', { n: _allWorkers.length })}</span>
          <input class="workers-search" id="workers-search" placeholder="${t('workers.searchPlaceholder')}" oninput="filterWorkers(this.value)">
          <button class="btn btn-success btn-sm" onclick="openInviteForm()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            ${t('workers.inviteWorker')}
          </button>
        </div>

        <div class="invite-form hidden" id="invite-form">
          <input class="form-input" type="email" id="invite-email" placeholder="${t('workers.invitePlaceholder')}" onkeydown="onInviteKey(event)">
          <button class="btn btn-success btn-sm" id="invite-submit-btn" onclick="submitInvite()">${t('workers.sendInvite')}</button>
          <button class="btn btn-ghost btn-sm" onclick="closeInviteForm()">${t('common.cancel')}</button>
          <span class="invite-error" id="invite-error"></span>
        </div>

        <div class="workers-panel-scroll">
          ${_allWorkers.length === 0 ? `
            <div class="empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              <p>${t('workers.noWorkersTitle')}</p>
              <p style="font-size:0.8rem;margin-top:6px;max-width:260px;margin-left:auto;margin-right:auto">${t('workers.noWorkersHint')}</p>
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
    return `<div class="dept-empty">${t('workers.noDepts')}</div>`
  }
  return _allDepts.map(d => {
    const color      = deptColor(d.id)
    const memberCount = _allWorkers.filter(w => {
      const ids = w.departmentIds || []
      return ids.length === 0 || ids.includes(d.id)
    }).length
    return `
      <div class="dept-item" id="dept-item-${esc(d.id)}">
        <div class="dept-item-stripe" style="background:${color}"></div>
        <div class="dept-item-body">
          <div class="dept-item-name" id="dept-name-${esc(d.id)}">${esc(d.name)}</div>
          <div class="dept-item-count">${memberCount === 1 ? t('workers.workerCountOne', { n: 1 }) : t('workers.workerCountMany', { n: memberCount })}</div>
        </div>
        <div class="dept-item-actions">
          <button class="dept-action-btn" title="${t('workers.rename')}" onclick="renameDept('${esc(d.id)}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="dept-action-btn dept-action-delete" title="${t('common.delete')}" onclick="deleteDept('${esc(d.id)}')">
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
    ? `<span class="worker-card-shifts-badge">${shiftCount === 1 ? t('workers.shiftsThisWeekOne', { n: 1 }) : t('workers.shiftsThisWeekMany', { n: shiftCount })}</span>`
    : `<span class="worker-card-shifts-badge worker-card-shifts-none">${t('workers.noShiftsThisWeek')}</span>`

  const deptIds = w.departmentIds || []
  let deptBadges
  if (deptIds.length === 0) {
    deptBadges = `<span class="worker-dept-badge worker-dept-any">${t('workers.allDepartments')}</span>`
  } else {
    deptBadges = deptIds.map(id => {
      const dept  = _allDepts.find(d => d.id === id)
      if (!dept) return ''
      const color = deptColor(id)
      return `<span class="worker-dept-badge" style="border-color:${color};color:${color};background:${color}18">${esc(dept.name)}</span>`
    }).join('')
  }

  return `
    <div class="worker-card worker-card-clickable" onclick="openWorkerDrawer('${esc(w.id)}')" role="button" tabindex="0">
      <div class="worker-card-avatar" data-avatar="${esc(w.avatarUrl || '')}">${initials}</div>
      <div class="worker-card-info">
        <div class="worker-card-name">${esc(w.name || t('common.dash'))}</div>
        <div class="worker-card-email">${esc(w.email || '')}</div>
        <div class="worker-card-dept-badges">${deptBadges}</div>
        ${shiftLabel}
      </div>
      <svg class="worker-card-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </div>`
}

// ── Dept CRUD ─────────────────────────────────────────────────────────────────

export function openCreateDept() {
  if (!requireWebManage()) return
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
  if (!requireWebManage()) return
  const input = document.getElementById('dept-add-input')
  const errEl = document.getElementById('dept-add-error')
  const btn   = document.getElementById('dept-add-btn')
  const name  = input.value.trim()
  if (!name) { errEl.textContent = t('workers.deptNeedName'); return }
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
      errEl.textContent = d?.error || t('workers.deptCreateFailed')
      return
    }
    const dept = await res.json()
    _allDepts = [..._allDepts, dept]
    cancelCreateDept()
    document.getElementById('dept-list').innerHTML = deptListHtml()
  } finally {
    btn.disabled = false
    btn.textContent = t('workers.addDept')
  }
}

export function renameDept(id) {
  if (!requireWebManage()) return
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
  if (!requireWebManage()) return
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
    alert(t('workers.deptRenameFailed'))
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

export function deleteDept(id) {
  if (!requireWebManage()) return
  // Look the name up here rather than passing it through the inline onclick
  // attribute: esc() is HTML-context escaping and does not make a value safe
  // inside a JS string literal in an event-handler attribute.
  const dept = _allDepts.find(d => d.id === id)
  const name = dept?.name || ''
  showConfirmDialog(
    t('workers.confirmDeleteTitle', { name }),
    t('workers.confirmDeleteBody', { name: esc(name) }),
    async () => {
      const res = await apiFetch(`/departments/${id}`, { method: 'DELETE' })
      if (!res?.ok) { alert(t('workers.deptDeleteFailed')); return }
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
          <div class="drawer-worker-name">${esc(worker.name || t('common.dash'))}</div>
          <div class="drawer-worker-email">${esc(worker.email || '')}</div>
        </div>
      </div>
      <button class="modal-close" onclick="closeWorkerDrawer()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="drawer-section-label">${t('workers.deptMembership')}</div>
    <div class="drawer-dept-hint">
      ${deptIds.length === 0 ? t('workers.accessAll') : t('workers.toggleHint')}
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
    return `<div class="dept-empty" style="padding:12px 0">${t('workers.noDeptsCreated')}</div>`
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
  if (!requireWebManage()) return
  if (!_drawerWorkerId) return
  const worker  = _allWorkers.find(w => w.id === _drawerWorkerId)
  if (!worker) return
  const deptIds = worker.departmentIds || []
  const isOn    = deptIds.includes(deptId)

  const toggleEl = document.getElementById(`drawer-toggle-${deptId}`)
  if (toggleEl) { toggleEl.style.opacity = '0.45'; toggleEl.style.pointerEvents = 'none' }

  const res = await apiFetch(
    `/users/${_drawerWorkerId}/departments${isOn ? `/${deptId}` : ''}`,
    {
      method:  isOn ? 'DELETE' : 'POST',
      headers: !isOn ? { 'Content-Type': 'application/json' } : undefined,
      body:    !isOn ? JSON.stringify({ departmentId: deptId }) : undefined,
    }
  )

  if (!res?.ok) {
    if (toggleEl) { toggleEl.style.opacity = ''; toggleEl.style.pointerEvents = '' }
    alert(t('workers.deptUpdateFailed'))
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
  if (hintEl) hintEl.innerHTML = newDeptIds.length === 0 ? t('workers.accessAll') : t('workers.toggleHint')

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
    grid.innerHTML = `<p class="workers-empty-filter">${t('workers.noWorkersMatch')}</p>`
    return
  }
  grid.innerHTML = filtered.map(w => workerCard(w, counts.get(w.id) || 0)).join('')
  applyAvatars(grid)
}

// ── Invite form ───────────────────────────────────────────────────────────────

export function openInviteForm() {
  if (!requireWebManage()) return
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
  if (!requireWebManage()) return
  const emailEl = document.getElementById('invite-email')
  const errEl   = document.getElementById('invite-error')
  const btn     = document.getElementById('invite-submit-btn')
  const email   = emailEl.value.trim()

  if (!email) { errEl.textContent = t('workers.inviteNeedEmail'); return }
  errEl.textContent = ''
  btn.disabled = true
  btn.textContent = t('common.sending')

  try {
    const res = await apiFetch('/organization/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (!res?.ok) {
      const d = await res?.json().catch(() => ({}))
      errEl.textContent = d?.error || t('workers.inviteFailed')
      return
    }
    const inv = await res.json()
    _allInvitations = [inv, ..._allInvitations]
    closeInviteForm()
    document.getElementById('invitations-section').innerHTML = invitationsHtml(_allInvitations)
  } finally {
    btn.disabled = false
    btn.textContent = t('workers.sendInvite')
  }
}

// ── Invitation actions ────────────────────────────────────────────────────────

export async function resendInvite(id) {
  if (!requireWebManage()) return
  const row = document.getElementById(`inv-${id}`)
  const btn = row?.querySelector('.btn-ghost')
  if (btn) { btn.disabled = true; btn.textContent = t('common.sending') }
  const res = await apiFetch(`/organization/invitations/${id}/resend`, { method: 'POST', body: '{}' })
  if (!res?.ok) {
    if (btn) { btn.disabled = false; btn.textContent = t('requests.resend') }
    alert(t('workers.inviteResendFailed'))
    return
  }
  if (btn) { btn.disabled = false; btn.textContent = t('requests.resend') }
  const meta = row?.querySelector('.pending-invite-meta')
  if (meta) meta.textContent = t('workers.inviteSentJustNow')
}

export async function cancelInvite(id) {
  if (!requireWebManage()) return
  const row = document.getElementById(`inv-${id}`)
  const btn = row?.querySelector('.btn-danger')
  if (btn) btn.disabled = true
  const res = await apiFetch(`/organization/invitations/${id}`, { method: 'DELETE' })
  if (!res?.ok) {
    if (btn) btn.disabled = false
    alert(t('workers.inviteCancelFailed'))
    return
  }
  _allInvitations = _allInvitations.filter(i => i.id !== id)
  document.getElementById('invitations-section').innerHTML = invitationsHtml(_allInvitations)
}

// ── Invitations HTML ──────────────────────────────────────────────────────────

function invitationsHtml(invitations) {
  if (!invitations.length) return ''
  return `
    <div class="workers-section-divider"><span>${t('workers.pendingInvitations')}</span></div>
    <div class="pending-invites">
      ${invitations.map(inv => `
        <div class="pending-invite-row" id="inv-${esc(inv.id)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          <div class="pending-invite-info">
            <span class="pending-invite-email">${esc(inv.email || inv.phone || t('common.dash'))}</span>
            <span class="pending-invite-meta">${t('workers.sent', { ago: daysAgo(inv.createdAt) })} &middot; ${daysUntil(inv.expiresAt)}</span>
          </div>
          <div class="pending-invite-actions">
            <button class="btn btn-ghost btn-sm" onclick="resendInvite('${esc(inv.id)}')">${t('requests.resend')}</button>
            <button class="btn btn-danger btn-sm" onclick="cancelInvite('${esc(inv.id)}')">${t('common.cancel')}</button>
          </div>
        </div>`).join('')}
    </div>`
}

function daysAgo(iso) {
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 86400000)
  return d === 0 ? t('workers.today') : d === 1 ? t('workers.yesterday') : t('workers.daysAgo', { n: d })
}

function daysUntil(iso) {
  const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
  return d <= 0 ? t('workers.expired') : d === 1 ? t('workers.expiresTomorrow') : t('workers.expiresIn', { n: d })
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
