import { state } from './state.js'
import { apiFetch } from './api.js'
import { toYMD, esc, applyAvatars } from './utils.js'
import { loadShifts, updateActionBar } from './shifts.js'

// ── Shift detail modal ────────────────────────────────────────────────────────

export function openShiftModal(shiftId) {
  const all = state.shiftsCache[toYMD(state.currentWeek)] || []
  const shift = all.find(s => s.id === shiftId)
  if (!shift) return
  state.activeShiftId = shiftId
  state.activeShiftData = shift
  renderShiftModal(shift)
  document.getElementById('shift-modal').classList.remove('hidden')
}

export function closeShiftModal() {
  document.getElementById('shift-modal').classList.add('hidden')
  state.activeShiftId = null
  state.activeShiftData = null
}

export function onModalOverlayClick(e) {
  if (e.target === document.getElementById('shift-modal')) closeShiftModal()
}

function renderShiftModal(shift) {
  document.getElementById('modal-dept').textContent = shift.department?.name || ''
  document.getElementById('modal-title').textContent = `${shift.startTime} – ${shift.endTime}`
  document.getElementById('modal-subtitle').innerHTML =
    `<span class="status-pill status-${shift.status}" style="font-size:0.7rem">${shift.status.toLowerCase()}</span>`
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
  let html = ''
  if (shift.status === 'DRAFT') {
    html += `<button class="btn btn-success" onclick="publishShift('${shift.id}')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      Publish shift
    </button>`
  }
  if (shift.status === 'PUBLISHED') {
    html += `<button class="btn btn-warning" onclick="publishShift('${shift.id}', true)">Unpublish</button>`
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
  const workers = await fetchOrgWorkers()
  renderPickerList(workers, '')
}

export function closeAssignModal() {
  document.getElementById('assign-modal').classList.add('hidden')
}

export function onAssignOverlayClick(e) {
  if (e.target === document.getElementById('assign-modal')) closeAssignModal()
}

export function filterPicker(query) {
  fetchOrgWorkers().then(workers => renderPickerList(workers, query))
}

async function fetchOrgWorkers() {
  if (state.orgWorkers) return state.orgWorkers
  const res = await apiFetch('/organization/members')
  if (!res?.ok) return []
  const data = await res.json()
  const all = Array.isArray(data) ? data : (data.members || data.users || [])
  state.orgWorkers = all.filter(w => w.role === 'WORKER')
  return state.orgWorkers
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

// Expose to window for HTML inline handlers
window.openShiftModal      = openShiftModal
window.closeShiftModal     = closeShiftModal
window.onModalOverlayClick = onModalOverlayClick
window.publishShift        = publishShift
window.removeWorker        = removeWorker
window.markAttendance      = markAttendance
window.openAssignPicker    = openAssignPicker
window.closeAssignModal    = closeAssignModal
window.onAssignOverlayClick = onAssignOverlayClick
window.filterPicker        = filterPicker
window.assignWorker        = assignWorker
