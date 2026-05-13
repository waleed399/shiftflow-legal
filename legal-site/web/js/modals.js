import { state, ensureOrgWorkers } from './state.js'
import { apiFetch } from './api.js'
import { toYMD, esc, applyAvatars } from './utils.js'
import { loadShifts, updateActionBar } from './shifts.js'

// ── Shift detail modal ────────────────────────────────────────────────────────

let _editing = false

const WORKERS_SECTION_HTML = `
  <div>
    <div class="modal-section-label">Workers</div>
    <div id="modal-workers-list"></div>
    <button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="openAssignPicker()">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Assign worker
    </button>
  </div>`

export function openShiftModal(shiftId) {
  const all = state.shiftsCache[toYMD(state.currentWeek)] || []
  const shift = all.find(s => s.id === shiftId)
  if (!shift) return
  _editing = false
  state.activeShiftId = shiftId
  state.activeShiftData = shift
  renderShiftModal(shift)
  document.getElementById('shift-modal').classList.remove('hidden')
}

export function closeShiftModal() {
  document.getElementById('shift-modal').classList.add('hidden')
  _editing = false
  state.activeShiftId = null
  state.activeShiftData = null
}

export function onModalOverlayClick(e) {
  if (e.target === document.getElementById('shift-modal')) closeShiftModal()
}

function restoreModalBody() {
  if (!_editing) return
  _editing = false
  document.getElementById('shift-modal-body').innerHTML = WORKERS_SECTION_HTML
}

function renderShiftModal(shift) {
  document.getElementById('modal-dept').textContent = shift.department?.name || ''
  document.getElementById('modal-title').textContent = `${shift.startTime} – ${shift.endTime}`
  document.getElementById('modal-subtitle').innerHTML =
    `<span class="status-pill status-${shift.status}" style="font-size:0.7rem">${shift.status.toLowerCase()}</span>`
  restoreModalBody()
  renderModalWorkers(shift)
  renderModalFooter(shift)
}

function renderModalWorkers(shift) {
  const assigned = shift.assignments || []
  const isActive = shift.status === 'ACTIVE'
  const el = document.getElementById('modal-workers-list')

  if (assigned.length === 0) {
    el.innerHTML = '<div class="workers-empty-msg">No workers assigned yet</div>'
    return
  }

  el.innerHTML = assigned.map(a => {
    const name = a.worker?.name || 'Unknown'
    const initials = esc(name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase())
    const att = a.attendance || 'PENDING'

    const attBtns = isActive ? `
      <div class="attendance-btns">
        <button class="att-btn ${att === 'PRESENT' ? 'sel-PRESENT' : ''}" onclick="markAttendance('${shift.id}','${a.worker.id}','PRESENT')">✓</button>
        <button class="att-btn ${att === 'LATE'    ? 'sel-LATE'    : ''}" onclick="markAttendance('${shift.id}','${a.worker.id}','LATE')">Late</button>
        <button class="att-btn ${att === 'ABSENT'  ? 'sel-ABSENT'  : ''}" onclick="markAttendance('${shift.id}','${a.worker.id}','ABSENT')">✗</button>
      </div>` : ''

    const removable = shift.status !== 'COMPLETED' && shift.status !== 'CANCELLED'
    const removeBtn = removable ? `
      <button class="remove-btn" title="Remove" onclick="removeWorker('${shift.id}','${a.worker.id}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>` : ''

    return `
      <div class="worker-row">
        <div class="worker-row-avatar" data-avatar="${esc(a.worker?.avatarUrl || '')}">${initials}</div>
        <span class="worker-row-name">${esc(name)}</span>
        ${attBtns}
        ${removeBtn}
      </div>`
  }).join('')
  applyAvatars(el)
}

function renderModalFooter(shift) {
  const canModify = shift.status === 'DRAFT' || shift.status === 'PUBLISHED'
  let html = ''

  if (canModify) {
    html += `<button class="btn btn-ghost btn-sm" onclick="openEditMode()">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      Edit
    </button>`
  }
  if (shift.status === 'DRAFT') {
    html += `<button class="btn btn-success" onclick="publishShift('${shift.id}')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      Publish shift
    </button>`
  }
  if (shift.status === 'PUBLISHED') {
    html += `<button class="btn btn-warning" onclick="publishShift('${shift.id}', true)">Unpublish</button>`
  }
  if (canModify) {
    html += `<button class="btn btn-danger" style="margin-left:auto" onclick="confirmCancelShift('${shift.id}')">Cancel shift</button>`
  }
  html += `<button class="btn btn-ghost" onclick="closeShiftModal()">Close</button>`
  document.getElementById('modal-footer').innerHTML = html
}

export async function publishShift(shiftId, unpublish = false) {
  const key = toYMD(state.currentWeek)
  if (unpublish) {
    const shift = (state.shiftsCache[key] || []).find(s => s.id === shiftId)
    if (!shift) return
    await apiFetch('/shifts/unpublish-day', { method: 'POST', body: JSON.stringify({ date: shift.date.substring(0, 10) }) })
  } else {
    await apiFetch(`/shifts/${shiftId}/publish`, { method: 'POST' })
  }
  delete state.shiftsCache[key]
  await loadShifts()
  const updated = (state.shiftsCache[key] || []).find(s => s.id === shiftId)
  if (updated) { state.activeShiftData = updated; renderShiftModal(updated) }
  updateActionBar()
}

export async function removeWorker(shiftId, workerId) {
  const res = await apiFetch(`/shifts/${shiftId}/assign/${workerId}`, { method: 'DELETE' })
  if (!res?.ok) return
  const key = toYMD(state.currentWeek)
  delete state.shiftsCache[key]
  await loadShifts()
  const updated = (state.shiftsCache[key] || []).find(s => s.id === shiftId)
  if (updated) { state.activeShiftData = updated; renderShiftModal(updated) }
}

export async function markAttendance(shiftId, workerId, status) {
  const res = await apiFetch(`/shifts/${shiftId}/attendance`, {
    method: 'PATCH',
    body: JSON.stringify({ workerId, attendance: status }),
  })
  if (!res?.ok) return
  const shift = (state.shiftsCache[toYMD(state.currentWeek)] || []).find(s => s.id === shiftId)
  if (shift) {
    const a = (shift.assignments || []).find(a => a.worker?.id === workerId)
    if (a) a.attendance = status
    state.activeShiftData = shift
    renderModalWorkers(shift)
  }
}

// ── Assign worker picker ──────────────────────────────────────────────────────

export async function openAssignPicker() {
  document.getElementById('assign-modal').classList.remove('hidden')
  document.getElementById('picker-search').value = ''
  document.getElementById('picker-list').innerHTML = '<div style="padding:12px;color:var(--muted);font-size:0.85rem">Loading…</div>'
  const workers = await ensureOrgWorkers()
  renderPickerList(workers, '')
}

export function closeAssignModal() {
  document.getElementById('assign-modal').classList.add('hidden')
}

export function onAssignOverlayClick(e) {
  if (e.target === document.getElementById('assign-modal')) closeAssignModal()
}

export function filterPicker(query) {
  ensureOrgWorkers().then(workers => renderPickerList(workers, query))
}

function renderPickerList(workers, query) {
  const q = query.toLowerCase()
  const assignedIds = new Set((state.activeShiftData?.assignments || []).map(a => a.worker?.id))
  const filtered = workers.filter(w => !q || (w.name || '').toLowerCase().includes(q) || (w.email || '').toLowerCase().includes(q))

  if (filtered.length === 0) {
    document.getElementById('picker-list').innerHTML = '<div style="padding:12px;color:var(--muted);font-size:0.85rem">No workers found</div>'
    return
  }

  const list = document.getElementById('picker-list')
  list.innerHTML = filtered.map(w => {
    const initials = esc((w.name || '?').split(' ').map(c => c[0]).join('').slice(0, 2).toUpperCase())
    const already = assignedIds.has(w.id)
    return `
      <div class="pick-row ${already ? 'already-assigned' : ''}" onclick="${already ? '' : `assignWorker('${w.id}')`}">
        <div class="worker-row-avatar" style="width:28px;height:28px;font-size:0.65rem" data-avatar="${esc(w.avatarUrl || '')}">${initials}</div>
        <div>
          <div class="pick-row-name">${esc(w.name || '—')}</div>
          ${already ? '<div class="pick-row-dept">Already assigned</div>' : ''}
        </div>
      </div>`
  }).join('')
  applyAvatars(list)
}

export async function assignWorker(workerId) {
  closeAssignModal()
  const res = await apiFetch(`/shifts/${state.activeShiftId}/assign`, {
    method: 'POST',
    body: JSON.stringify({ workerId }),
  })
  if (!res?.ok) return
  const key = toYMD(state.currentWeek)
  delete state.shiftsCache[key]
  await loadShifts()
  const updated = (state.shiftsCache[key] || []).find(s => s.id === state.activeShiftId)
  if (updated) { state.activeShiftData = updated; renderShiftModal(updated) }
}

// ── Edit shift ────────────────────────────────────────────────────────────────

export function openEditMode() {
  const shift = state.activeShiftData
  if (!shift) return
  _editing = true
  const start = shift.startTime.substring(0, 5)
  const end   = shift.endTime.substring(0, 5)
  document.getElementById('shift-modal-body').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="form-grid-2">
        <div class="form-row">
          <label class="form-label" for="es-start">Start time</label>
          <input class="form-input" type="time" id="es-start" value="${start}">
        </div>
        <div class="form-row">
          <label class="form-label" for="es-end">End time</label>
          <input class="form-input" type="time" id="es-end" value="${end}">
        </div>
      </div>
      <div class="form-row">
        <label class="form-label" for="es-required">Required workers</label>
        <input class="form-input" type="number" id="es-required" min="1" max="99" value="${shift.requiredWorkers}">
      </div>
      <div class="form-row">
        <label class="form-label" for="es-notes">Notes <span class="form-optional">(optional)</span></label>
        <textarea class="form-input" id="es-notes" rows="2" maxlength="500">${esc(shift.notes || '')}</textarea>
      </div>
      <div id="es-error" class="form-error"></div>
    </div>`
  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-success" id="es-save-btn" onclick="saveEditShift()">Save changes</button>
    <button class="btn btn-ghost" onclick="closeEditMode()">Discard</button>`
}

export function closeEditMode() {
  _editing = false
  document.getElementById('shift-modal-body').innerHTML = WORKERS_SECTION_HTML
  renderModalWorkers(state.activeShiftData)
  renderModalFooter(state.activeShiftData)
}

export async function saveEditShift() {
  const startTime      = document.getElementById('es-start')?.value
  const endTime        = document.getElementById('es-end')?.value
  const requiredWorkers = parseInt(document.getElementById('es-required')?.value, 10)
  const notes          = document.getElementById('es-notes')?.value.trim()
  const errEl          = document.getElementById('es-error')

  if (!startTime || !endTime) { errEl.textContent = 'Pick a start and end time'; return }
  if (startTime === endTime)  { errEl.textContent = "Start and end time can't match"; return }
  if (requiredWorkers < 1)    { errEl.textContent = 'Required workers must be at least 1'; return }
  errEl.textContent = ''

  const btn = document.getElementById('es-save-btn')
  btn.disabled = true
  btn.textContent = 'Saving…'

  try {
    const body = { startTime, endTime, requiredWorkers }
    if (notes) body.notes = notes
    const res = await apiFetch(`/shifts/${state.activeShiftId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res?.ok) {
      const d = await res?.json().catch(() => ({}))
      errEl.textContent = d?.error || 'Failed to save changes'
      btn.disabled = false
      btn.textContent = 'Save changes'
      return
    }
    const key = toYMD(state.currentWeek)
    delete state.shiftsCache[key]
    await loadShifts()
    const updated = (state.shiftsCache[key] || []).find(s => s.id === state.activeShiftId)
    if (updated) {
      _editing = false
      state.activeShiftData = updated
      document.getElementById('shift-modal-body').innerHTML = WORKERS_SECTION_HTML
      renderShiftModal(updated)
    } else {
      closeShiftModal()
    }
  } catch {
    errEl.textContent = 'Network error — try again'
    btn.disabled = false
    btn.textContent = 'Save changes'
  }
}

// ── Cancel (delete) shift ─────────────────────────────────────────────────────

export function confirmCancelShift(shiftId) {
  document.getElementById('modal-footer').innerHTML = `
    <span style="font-size:0.82rem;color:var(--muted);align-self:center;flex:1">Cancel this shift?</span>
    <button class="btn btn-danger" id="confirm-cancel-btn" onclick="doDeleteShift('${shiftId}')">Yes, cancel it</button>
    <button class="btn btn-ghost" onclick="renderModalFooterFromState()">Keep it</button>`
}

export function renderModalFooterFromState() {
  renderModalFooter(state.activeShiftData)
}

export async function doDeleteShift(shiftId) {
  const btn = document.getElementById('confirm-cancel-btn')
  if (btn) { btn.disabled = true; btn.textContent = 'Cancelling…' }
  try {
    const res = await apiFetch(`/shifts/${shiftId}`, { method: 'DELETE' })
    if (!res?.ok) {
      const d = await res?.json().catch(() => ({}))
      alert(d?.error || 'Failed to cancel shift')
      renderModalFooter(state.activeShiftData)
      return
    }
    closeShiftModal()
    const key = toYMD(state.currentWeek)
    delete state.shiftsCache[key]
    await loadShifts()
    updateActionBar()
  } catch {
    alert('Network error — try again')
    renderModalFooter(state.activeShiftData)
  }
}

// Expose to window for HTML inline handlers
window.openShiftModal           = openShiftModal
window.closeShiftModal          = closeShiftModal
window.onModalOverlayClick      = onModalOverlayClick
window.publishShift             = publishShift
window.removeWorker             = removeWorker
window.markAttendance           = markAttendance
window.openAssignPicker         = openAssignPicker
window.closeAssignModal         = closeAssignModal
window.onAssignOverlayClick     = onAssignOverlayClick
window.filterPicker             = filterPicker
window.assignWorker             = assignWorker
window.openEditMode             = openEditMode
window.closeEditMode            = closeEditMode
window.saveEditShift            = saveEditShift
window.confirmCancelShift       = confirmCancelShift
window.renderModalFooterFromState = renderModalFooterFromState
window.doDeleteShift            = doDeleteShift
