import { state } from './state.js'
import { apiFetch } from './api.js'
import { toYMD, fmtDate, esc } from './utils.js'
import { loadShifts } from './shifts.js'
import { t } from './i18n.js'
import { requireWebManage } from './profile.js'

export async function openCreateShiftModal(prefillDeptId) {
  if (!requireWebManage()) return
  document.getElementById('cs-subtitle').textContent = fmtDate(state.selectedDay)
  document.getElementById('cs-start').value = '09:00'
  document.getElementById('cs-end').value = '17:00'
  document.getElementById('cs-required').value = 1
  document.getElementById('cs-notes').value = ''
  document.getElementById('cs-error').textContent = ''

  const dept = document.getElementById('cs-department')
  dept.innerHTML = `<option value="">${t('modals.noDepartmentsLoading')}</option>`
  dept.disabled = true
  document.getElementById('create-shift-modal').classList.remove('hidden')

  await ensureDepartments()
  const depts = state.departments || []
  if (depts.length === 0) {
    dept.innerHTML = `<option value="">${t('modals.noDepartmentsYet')}</option>`
    dept.disabled = true
    return
  }
  dept.innerHTML = depts.map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')
  dept.disabled = false
  if (prefillDeptId && depts.some(d => d.id === prefillDeptId)) dept.value = prefillDeptId
}

export function closeCreateShiftModal() {
  document.getElementById('create-shift-modal').classList.add('hidden')
}

export function onCreateShiftOverlayClick(e) {
  if (e.target === document.getElementById('create-shift-modal')) closeCreateShiftModal()
}

async function ensureDepartments() {
  if (state.departments) return
  const res = await apiFetch('/departments')
  if (!res?.ok) return
  const data = await res.json()
  state.departments = Array.isArray(data) ? data : (data.departments || [])
}

export async function submitCreateShift(e) {
  if (e) e.preventDefault()

  const departmentId = document.getElementById('cs-department').value
  const startTime = document.getElementById('cs-start').value
  const endTime = document.getElementById('cs-end').value
  const requiredWorkers = parseInt(document.getElementById('cs-required').value, 10) || 1
  const notes = document.getElementById('cs-notes').value.trim()

  if (!departmentId) { showError(t('modals.pickDepartment')); return }
  if (!startTime || !endTime) { showError(t('modals.pickStartEnd')); return }
  if (startTime === endTime) { showError(t('modals.startEndMatch')); return }
  if (requiredWorkers < 1) { showError(t('modals.requiredAtLeast')); return }

  const submitBtn = document.getElementById('cs-submit')
  const originalText = submitBtn.textContent
  submitBtn.disabled = true
  submitBtn.textContent = t('common.creating')

  try {
    const body = {
      date: toYMD(state.selectedDay),
      startTime,
      endTime,
      departmentId,
      requiredWorkers,
    }
    if (notes) body.notes = notes

    const res = await apiFetch('/shifts', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}))
      showError(data?.error || t('modals.failedCreate'))
      return
    }
    delete state.shiftsCache[toYMD(state.currentWeek)]
    closeCreateShiftModal()
    await loadShifts()
  } catch {
    showError(t('common.networkError'))
  } finally {
    submitBtn.disabled = false
    submitBtn.textContent = originalText
  }
}

function showError(msg) {
  document.getElementById('cs-error').textContent = msg
}

window.openCreateShiftModal = openCreateShiftModal
window.closeCreateShiftModal = closeCreateShiftModal
window.onCreateShiftOverlayClick = onCreateShiftOverlayClick
window.submitCreateShift = submitCreateShift
