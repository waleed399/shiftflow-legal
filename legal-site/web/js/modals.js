import { state, ensureOrgWorkers } from './state.js'
import { apiFetch } from './api.js'
import { toYMD, esc, getInitials, applyAvatars, showToast, DAY_FULL, AVAIL_ICONS } from './utils.js'
import { loadShifts, updateActionBar, toMins, normEnd, availPref, getAvailRosterCache } from './shifts.js'
import { buildDayLoad, buildDayPrefs, prefKeyOf, evaluateAssignment, isBlocked } from './shiftEligibility.js'
import { t } from './i18n.js'
import { requireWebManage } from './profile.js'

// ── Shift detail modal ────────────────────────────────────────────────────────

let _editing = false
let _editingAssignment = null  // workerId whose hours are being edited inline, or null
let _ehMode = 'full'           // 'full' | 'part' for the inline hours editor

const workersSectionHtml = () => `
  <div>
    <div id="modal-coverage"></div>
    <div class="modal-section-label">${t('modals.workersLabel')}</div>
    <div id="modal-workers-list"></div>
    <button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="openAssignPicker()">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      ${t('modals.assignWorker')}
    </button>
  </div>`

// ── Split-shift coverage helpers ───────────────────────────────────────────────
// A shift can be covered by several workers, each over a sub-range (blockStart →
// blockEnd). An assignment with no block times covers the whole shift. We compute
// the covered/uncovered timeline so the manager can see — and fill — the holes.

function hm(time) { return String(time || '').substring(0, 5) }

function fmtMin(m) {
  const v = ((m % 1440) + 1440) % 1440
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`
}

function durLabel(mins) {
  if (mins <= 0) return ''
  const h = Math.floor(mins / 60), m = mins % 60
  return m === 0 ? `${h}h` : (h === 0 ? `${m}m` : `${h}h ${m}m`)
}

// Returns { s, e, total, segments:[{covered,start,end}], gaps:[[start,end]], coveredMins }
// All values are minutes on a timeline anchored at the shift's start (overnight-aware).
function shiftCoverage(shift) {
  const s = toMins(shift.startTime)
  const e = normEnd(s, toMins(shift.endTime))
  const total = e - s
  const norm = m => (m < s ? m + 1440 : m)

  const covered = (shift.assignments || []).map(a => {
    if (a.blockStart && a.blockEnd) {
      const bs = norm(toMins(a.blockStart))
      let be = toMins(a.blockEnd); be = normEnd(bs, be < s ? be + 1440 : be)
      return [Math.max(bs, s), Math.min(be, e)]
    }
    return [s, e] // whole-shift assignment
  }).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])

  const merged = []
  for (const [a, b] of covered) {
    if (merged.length && a <= merged[merged.length - 1][1]) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], b)
    else merged.push([a, b])
  }

  const segments = []
  const gaps = []
  let cur = s
  for (const [a, b] of merged) {
    if (a > cur) { segments.push({ covered: false, start: cur, end: a }); gaps.push([cur, a]) }
    segments.push({ covered: true, start: a, end: b })
    cur = b
  }
  if (cur < e) { segments.push({ covered: false, start: cur, end: e }); gaps.push([cur, e]) }

  const coveredMins = total - gaps.reduce((n, [a, b]) => n + (b - a), 0)
  return { s, e, total, segments, gaps, coveredMins }
}

export function openShiftModal(shiftId) {
  const all = state.shiftsCache[toYMD(state.currentWeek)] || []
  const shift = all.find(s => s.id === shiftId)
  if (!shift) return
  _editing = false
  _editingAssignment = null
  state.activeShiftId = shiftId
  state.activeShiftData = shift
  renderShiftModal(shift)
  document.getElementById('shift-modal').classList.remove('hidden')
}

export function closeShiftModal() {
  document.getElementById('shift-modal').classList.add('hidden')
  _editing = false
  _editingAssignment = null
  state.activeShiftId = null
  state.activeShiftData = null
}

export function onModalOverlayClick(e) {
  if (e.target === document.getElementById('shift-modal')) closeShiftModal()
}

function restoreModalBody() {
  _editing = false
  document.getElementById('shift-modal-body').innerHTML = workersSectionHtml()
}

function renderShiftModal(shift) {
  document.getElementById('modal-dept').textContent = shift.department?.name || ''
  document.getElementById('modal-title').textContent = `${shift.startTime} – ${shift.endTime}`
  document.getElementById('modal-subtitle').innerHTML =
    `<span class="status-pill status-${shift.status}" style="font-size:0.7rem">${t(`shifts.status.${shift.status}`)}</span>`
  restoreModalBody()
  renderModalCoverage(shift)
  renderModalWorkers(shift)
  renderModalFooter(shift)
}

// Horizontal covered/uncovered bar + gap chips, shown once anyone is assigned.
function renderModalCoverage(shift) {
  const el = document.getElementById('modal-coverage')
  if (!el) return
  const assigned = shift.assignments || []
  if (assigned.length === 0) { el.innerHTML = ''; return }

  const { total, segments, gaps, coveredMins } = shiftCoverage(shift)
  if (total <= 0) { el.innerHTML = ''; return }

  const bar = segments.map(g =>
    `<div class="cov-bar-seg ${g.covered ? 'cov-bar-covered' : 'cov-bar-gap'}" style="width:${((g.end - g.start) / total * 100).toFixed(3)}%" title="${fmtMin(g.start)}–${fmtMin(g.end)}"></div>`
  ).join('')

  const chips = gaps.length
    ? gaps.map(([a, b]) => `<span class="cov-gap-chip">${t('modals.gapLabel', { start: fmtMin(a), end: fmtMin(b) })}</span>`).join('')
    : `<span class="cov-fully"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>${t('modals.fullyCovered')}</span>`

  el.innerHTML = `
    <div class="cov-block">
      <div class="cov-block-head">
        <span class="modal-section-label" style="margin:0">${t('modals.coverageLabel')}</span>
        <span class="cov-block-sum">${t('modals.coveredOf', { covered: durLabel(coveredMins), total: durLabel(total) })}</span>
      </div>
      <div class="cov-bar">${bar}</div>
      <div class="cov-chips">${chips}</div>
    </div>`
}

function renderModalWorkers(shift) {
  const assigned = shift.assignments || []
  const isActive = shift.status === 'ACTIVE'
  const el = document.getElementById('modal-workers-list')

  if (assigned.length === 0) {
    el.innerHTML = `<div class="workers-empty-msg">${t('modals.noWorkersAssigned')}</div>`
    return
  }

  const removable = shift.status !== 'COMPLETED' && shift.status !== 'CANCELLED'

  el.innerHTML = assigned.map(a => {
    if (removable && _editingAssignment === a.worker?.id) return workerEditHoursHtml(a, shift)

    const name = a.worker?.name || t('common.unknown')
    const initials = esc(getInitials(name))
    const att = a.attendance || 'PENDING'

    const hasBlock = a.blockStart && a.blockEnd
    const blockMins = hasBlock ? (normEnd(toMins(a.blockStart), toMins(a.blockEnd)) - toMins(a.blockStart)) : 0
    const blockLabel = hasBlock
      ? `<span class="worker-row-block">${hm(a.blockStart)}–${hm(a.blockEnd)} · ${durLabel(blockMins)}</span>`
      : `<span class="worker-row-block worker-row-block-full">${t('modals.wholeShiftLabel')}</span>`

    const attBtns = isActive ? `
      <div class="attendance-btns">
        <button class="att-btn ${att === 'PRESENT' ? 'sel-PRESENT' : ''}" onclick="markAttendance('${shift.id}','${a.worker.id}','PRESENT')">✓</button>
        <button class="att-btn ${att === 'LATE'    ? 'sel-LATE'    : ''}" onclick="markAttendance('${shift.id}','${a.worker.id}','LATE')">${t('modals.late')}</button>
        <button class="att-btn ${att === 'ABSENT'  ? 'sel-ABSENT'  : ''}" onclick="markAttendance('${shift.id}','${a.worker.id}','ABSENT')">✗</button>
      </div>` : ''

    const editBtn = removable ? `
      <button class="remove-btn eh-edit-btn" title="${t('modals.editHours')}" onclick="editWorkerHours('${a.worker.id}')" aria-label="${t('modals.editHours')}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>` : ''
    const removeBtn = removable ? `
      <button class="remove-btn" title="${t('common.delete')}" onclick="removeWorker('${shift.id}','${a.worker.id}',this)" aria-label="${t('common.delete')}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>` : ''

    return `
      <div class="worker-row">
        <div class="worker-row-avatar" data-avatar="${esc(a.worker?.avatarUrl || '')}">${initials}</div>
        <div class="worker-row-info">
          <span class="worker-row-name">${esc(name)}</span>
          ${blockLabel}
        </div>
        ${attBtns}
        ${editBtn}
        ${removeBtn}
      </div>`
  }).join('')
  applyAvatars(el)
}

// Inline editor that swaps in for a worker row when its pencil is clicked.
function workerEditHoursHtml(a, shift) {
  const name = esc(a.worker?.name || t('common.unknown'))
  const initials = esc(getInitials(a.worker?.name || ''))
  const start = a.blockStart ? hm(a.blockStart) : hm(shift.startTime)
  const end   = a.blockEnd   ? hm(a.blockEnd)   : hm(shift.endTime)
  return `
    <div class="worker-row worker-row-editing">
      <div class="worker-row-avatar" data-avatar="${esc(a.worker?.avatarUrl || '')}">${initials}</div>
      <div class="eh-editor">
        <span class="worker-row-name">${name}</span>
        <div class="assign-range-tabs">
          <button class="assign-range-tab ${_ehMode === 'full' ? 'active' : ''}" onclick="setEditHoursMode('full')">${t('modals.wholeShift')}</button>
          <button class="assign-range-tab ${_ehMode === 'part' ? 'active' : ''}" onclick="setEditHoursMode('part')">${t('modals.partOfShift')}</button>
        </div>
        <div class="assign-range-times ${_ehMode === 'part' ? '' : 'hidden'}" id="eh-times">
          <input class="form-input" type="time" id="eh-start" value="${start}" aria-label="${t('modals.blockStart')}">
          <span class="assign-range-sep">–</span>
          <input class="form-input" type="time" id="eh-end" value="${end}" aria-label="${t('modals.blockEnd')}">
        </div>
        <div class="form-error" id="eh-error"></div>
        <div class="eh-actions">
          <button class="btn btn-ghost btn-sm" onclick="cancelEditHours()">${t('common.cancel')}</button>
          <button class="btn btn-success btn-sm" id="eh-save-btn" onclick="saveEditHours('${a.worker.id}')">${t('common.save')}</button>
        </div>
      </div>
    </div>`
}

function renderModalFooter(shift) {
  const canModify = shift.status === 'DRAFT' || shift.status === 'PUBLISHED'
  let html = ''

  if (canModify) {
    html += `<button class="btn btn-ghost btn-sm" onclick="openEditMode()">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      ${t('modals.edit')}
    </button>`
  }
  if (shift.status === 'DRAFT') {
    html += `<button class="btn btn-success" onclick="publishShift('${shift.id}')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      ${t('modals.publishShift')}
    </button>`
  }
  if (shift.status === 'PUBLISHED') {
    html += `<button class="btn btn-warning" onclick="publishShift('${shift.id}', true)">${t('modals.unpublish')}</button>`
  }
  if (canModify) {
    html += `<button class="btn btn-danger" style="margin-left:auto" onclick="confirmCancelShift('${shift.id}')">${t('modals.cancelShift')}</button>`
  }
  html += `<button class="btn btn-ghost" onclick="closeShiftModal()">${t('common.close')}</button>`
  document.getElementById('modal-footer').innerHTML = html
}

export async function publishShift(shiftId, unpublish = false) {
  if (!requireWebManage()) return
  const btn = document.querySelector(`#modal-footer ${unpublish ? '.btn-warning' : '.btn-success'}`)
  if (btn) btn.disabled = true
  const key = toYMD(state.currentWeek)
  try {
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
  } catch {
    if (btn) btn.disabled = false
  }
}

export async function removeWorker(shiftId, workerId, btn) {
  if (!requireWebManage()) return
  if (btn) btn.disabled = true
  const res = await apiFetch(`/shifts/${shiftId}/assign/${workerId}`, { method: 'DELETE' })
  if (!res?.ok) {
    if (btn) btn.disabled = false
    showToast(t('modals.failedRemove'))
    return
  }
  const key = toYMD(state.currentWeek)
  delete state.shiftsCache[key]
  await loadShifts()
  const updated = (state.shiftsCache[key] || []).find(s => s.id === shiftId)
  if (updated) { state.activeShiftData = updated; renderShiftModal(updated) }
}

export async function markAttendance(shiftId, workerId, status) {
  if (!requireWebManage()) return
  const res = await apiFetch(`/shifts/${shiftId}/attendance`, {
    method: 'PATCH',
    body: JSON.stringify({ workerId, attendance: status }),
  })
  if (!res?.ok) { showToast(t('modals.failedAttendance')); return }
  const shift = (state.shiftsCache[toYMD(state.currentWeek)] || []).find(s => s.id === shiftId)
  if (shift) {
    const a = (shift.assignments || []).find(a => a.worker?.id === workerId)
    if (a) a.attendance = status
    state.activeShiftData = shift
    renderModalWorkers(shift)
  }
}

// ── Edit an assigned worker's hours in place ────────────────────────────────────
// Re-uses the assign endpoint, which upserts: posting the same worker with new
// block times updates their block; posting with none resets them to whole shift.

export function editWorkerHours(workerId) {
  if (!requireWebManage()) return
  const a = (state.activeShiftData?.assignments || []).find(a => a.worker?.id === workerId)
  _editingAssignment = workerId
  _ehMode = (a?.blockStart && a?.blockEnd) ? 'part' : 'full'
  renderModalWorkers(state.activeShiftData)
}

export function setEditHoursMode(mode) {
  _ehMode = mode
  document.querySelectorAll('.worker-row-editing .assign-range-tab').forEach((b, i) => {
    b.classList.toggle('active', (i === 0) === (mode === 'full'))
  })
  document.getElementById('eh-times')?.classList.toggle('hidden', mode !== 'part')
}

export function cancelEditHours() {
  _editingAssignment = null
  renderModalWorkers(state.activeShiftData)
}

export async function saveEditHours(workerId) {
  if (!requireWebManage()) return
  const body = { workerId }
  if (_ehMode === 'part') {
    const blockStart = document.getElementById('eh-start')?.value
    const blockEnd   = document.getElementById('eh-end')?.value
    const errEl      = document.getElementById('eh-error')
    if (!blockStart || !blockEnd || blockStart === blockEnd) {
      if (errEl) errEl.textContent = t('modals.blockInvalid')
      return
    }
    body.blockStart = blockStart
    body.blockEnd = blockEnd
  }

  const btn = document.getElementById('eh-save-btn')
  if (btn) { btn.disabled = true; btn.textContent = t('common.saving') }

  const res = await apiFetch(`/shifts/${state.activeShiftId}/assign`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!res?.ok) {
    const d = await res?.json().catch(() => ({}))
    const errEl = document.getElementById('eh-error')
    if (errEl) errEl.textContent = d?.error || t('shifts.failedAssign')
    if (btn) { btn.disabled = false; btn.textContent = t('common.save') }
    return
  }

  _editingAssignment = null
  const key = toYMD(state.currentWeek)
  delete state.shiftsCache[key]
  await loadShifts()
  const updated = (state.shiftsCache[key] || []).find(s => s.id === state.activeShiftId)
  if (updated) { state.activeShiftData = updated; renderShiftModal(updated) }
}

// ── Assign worker picker ──────────────────────────────────────────────────────

let _assignMode = 'full' // 'full' = whole shift, 'part' = custom block range

export async function openAssignPicker() {
  if (!requireWebManage()) return
  document.getElementById('assign-modal').classList.remove('hidden')
  document.getElementById('picker-search').value = ''
  document.getElementById('picker-list').innerHTML = `<div style="padding:12px;color:var(--muted);font-size:0.85rem">${t('modals.pickerLoading')}</div>`
  // Forget any manual edits from a previous open so defaults re-prefill.
  const startEl = document.getElementById('assign-block-start')
  if (startEl) delete startEl.dataset.touched
  document.getElementById('assign-block-error').textContent = ''
  setAssignMode('full')
  const [workers] = await Promise.all([ensureOrgWorkers(), ensureAvailRoster()])
  renderPickerList(workers, '')
}

/**
 * The week's stated availability, which the day roster loads for the same
 * reason: a name alone does not tell a manager who SHOULD take the shift.
 * Best-effort — the picker still works without it, just less helpfully.
 */
async function ensureAvailRoster() {
  const key = toYMD(state.currentWeek)
  const cache = getAvailRosterCache()
  if (cache[key]) return
  try {
    const res = await apiFetch(`/availability/week-roster/${key}`)
    if (res?.ok) cache[key] = await res.json()
  } catch {
    // Offline or refused. renderPickerList degrades to names only.
  }
}

// Toggle between assigning the whole shift and a sub-range. Switching to "part"
// pre-fills the first uncovered gap so filling holes is one click + Assign.
export function setAssignMode(mode) {
  _assignMode = mode
  document.getElementById('assign-mode-full')?.classList.toggle('active', mode === 'full')
  document.getElementById('assign-mode-part')?.classList.toggle('active', mode === 'part')
  const times = document.getElementById('assign-range-times')
  if (times) times.classList.toggle('hidden', mode !== 'part')
  if (mode === 'part') {
    const shift = state.activeShiftData
    const startEl = document.getElementById('assign-block-start')
    const endEl   = document.getElementById('assign-block-end')
    if (shift && startEl && endEl && !startEl.dataset.touched) {
      const { gaps } = shiftCoverage(shift)
      if (gaps.length) { startEl.value = fmtMin(gaps[0][0]); endEl.value = fmtMin(gaps[0][1]) }
      else { startEl.value = hm(shift.startTime); endEl.value = hm(shift.endTime) }
    }
  }
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

// Reasons a worker cannot take the shift, in the wording the day roster's cells
// already use — the manager meets the same four words in both places.
const BLOCK_LABEL = {
  wrongDept: () => t('modals.pickerBlockedDept'),
  limit:     () => t('modals.pickerBlockedLimit'),
  conflict:  () => t('modals.pickerBlockedBusy'),
}

function renderPickerList(workers, query) {
  const q = query.toLowerCase()
  const shift = state.activeShiftData
  const filtered = workers.filter(w => !q || (w.name || '').toLowerCase().includes(q) || (w.email || '').toLowerCase().includes(q))

  if (filtered.length === 0) {
    document.getElementById('picker-list').innerHTML = `<div style="padding:12px;color:var(--muted);font-size:0.85rem">${t('modals.pickerNoWorkers')}</div>`
    return
  }

  // The shift's own day, not the week: the twelve-hour cap and the overlap
  // check are both about one day, and the picker can be opened from the week
  // rota on a shift that is not the day the roster happens to have selected.
  const weekKey   = toYMD(state.currentWeek)
  const shiftYMD  = (shift?.date || '').substring(0, 10)
  const dayShifts = (state.shiftsCache[weekKey] || [])
    .filter(s => s.date.substring(0, 10) === shiftYMD && s.status !== 'CANCELLED')
  const load  = buildDayLoad(dayShifts)
  const prefs = shiftYMD
    ? buildDayPrefs(getAvailRosterCache()[weekKey], DAY_FULL[new Date(shiftYMD).getUTCDay()])
    : new Map()

  // Whoever can actually be assigned comes first. Sorting on the verdict is the
  // point of showing it: without it the manager reads the whole list to find
  // the two names that are not struck through.
  const rank = { open: 0, full: 1, conflict: 2, limit: 2, wrongDept: 3, assigned: 4 }
  const rows = filtered
    .map(w => ({ w, code: shift ? evaluateAssignment(w, shift, load).code : 'open' }))
    .sort((a, b) => (rank[a.code] ?? 9) - (rank[b.code] ?? 9) || a.w.name.localeCompare(b.w.name))

  const list = document.getElementById('picker-list')
  list.innerHTML = rows.map(({ w, code }) => {
    const already = code === 'assigned'
    const blocked = isBlocked(code)
    const prefKey = prefKeyOf(prefs.get(w.id))
    const cfg     = prefKey ? availPref(prefKey) : null
    const badge   = cfg
      ? `<span class="pick-avail" style="background:${cfg.color}1c;border-color:${cfg.color};color:${cfg.color}"
               title="${esc(cfg.label)}">${AVAIL_ICONS[prefKey] || ''}<span>${esc(
          prefKey === 'custom' && prefs.get(w.id)?.startTime
            ? `${prefs.get(w.id).startTime}–${prefs.get(w.id).endTime}`
            : cfg.label)}</span></span>`
      : ''
    const note = already ? t('modals.alreadyAssigned')
      : blocked ? BLOCK_LABEL[code]()
      : code === 'full' ? t('modals.pickerShiftFull')
      : ''
    const inert = already || blocked
    return `
      <div class="pick-row ${already ? 'already-assigned' : ''}${blocked ? ' pick-row-blocked' : ''}"
           onclick="${inert ? '' : `assignWorker('${w.id}')`}" ${inert ? '' : 'role="button" tabindex="0"'}>
        <div class="worker-row-avatar" style="width:28px;height:28px;font-size:0.65rem" data-avatar="${esc(w.avatarUrl || '')}">${esc(getInitials(w.name))}</div>
        <div class="pick-row-main">
          <div class="pick-row-name">${esc(w.name || t('common.dash'))}</div>
          ${note ? `<div class="pick-row-dept">${esc(note)}</div>` : ''}
        </div>
        ${badge}
      </div>`
  }).join('')
  applyAvatars(list)
}

export async function assignWorker(workerId) {
  if (!requireWebManage()) return

  const body = { workerId }
  if (_assignMode === 'part') {
    const blockStart = document.getElementById('assign-block-start')?.value
    const blockEnd   = document.getElementById('assign-block-end')?.value
    const errEl      = document.getElementById('assign-block-error')
    if (!blockStart || !blockEnd || blockStart === blockEnd) {
      if (errEl) errEl.textContent = t('modals.blockInvalid')
      return
    }
    body.blockStart = blockStart
    body.blockEnd = blockEnd
  }

  closeAssignModal()
  const res = await apiFetch(`/shifts/${state.activeShiftId}/assign`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!res?.ok) {
    const d = await res?.json().catch(() => ({}))
    showToast(d?.error || t('shifts.failedAssign'))
    return
  }
  const key = toYMD(state.currentWeek)
  delete state.shiftsCache[key]
  await loadShifts()
  const updated = (state.shiftsCache[key] || []).find(s => s.id === state.activeShiftId)
  if (updated) { state.activeShiftData = updated; renderShiftModal(updated) }
}

// ── Edit shift ────────────────────────────────────────────────────────────────

export function openEditMode() {
  if (!requireWebManage()) return
  const shift = state.activeShiftData
  if (!shift) return
  _editing = true
  const start = shift.startTime.substring(0, 5)
  const end   = shift.endTime.substring(0, 5)
  document.getElementById('shift-modal-body').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="form-grid-2">
        <div class="form-row">
          <label class="form-label" for="es-start">${t('modals.startTime')}</label>
          <input class="form-input" type="time" id="es-start" value="${start}">
        </div>
        <div class="form-row">
          <label class="form-label" for="es-end">${t('modals.endTime')}</label>
          <input class="form-input" type="time" id="es-end" value="${end}">
        </div>
      </div>
      <div class="form-row">
        <label class="form-label" for="es-required">${t('modals.requiredWorkers')}</label>
        <input class="form-input" type="number" id="es-required" min="1" max="99" value="${shift.requiredWorkers}">
      </div>
      <div class="form-row">
        <label class="form-label" for="es-notes">${t('modals.notes')} <span class="form-optional">${t('common.optional')}</span></label>
        <textarea class="form-input" id="es-notes" rows="2" maxlength="500">${esc(shift.notes || '')}</textarea>
      </div>
      <div id="es-error" class="form-error"></div>
    </div>`
  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-success" id="es-save-btn" onclick="saveEditShift()">${t('modals.saveChanges')}</button>
    <button class="btn btn-ghost" onclick="closeEditMode()">${t('common.discard')}</button>`
}

export function closeEditMode() {
  _editing = false
  document.getElementById('shift-modal-body').innerHTML = workersSectionHtml()
  renderModalCoverage(state.activeShiftData)
  renderModalWorkers(state.activeShiftData)
  renderModalFooter(state.activeShiftData)
}

export async function saveEditShift() {
  if (!requireWebManage()) return
  const startTime      = document.getElementById('es-start')?.value
  const endTime        = document.getElementById('es-end')?.value
  const requiredWorkers = parseInt(document.getElementById('es-required')?.value, 10)
  const notes          = document.getElementById('es-notes')?.value.trim()
  const errEl          = document.getElementById('es-error')

  if (!startTime || !endTime) { errEl.textContent = t('modals.pickStartEnd'); return }
  if (startTime === endTime)  { errEl.textContent = t('modals.startEndMatch'); return }
  if (requiredWorkers < 1)    { errEl.textContent = t('modals.requiredAtLeast'); return }
  errEl.textContent = ''

  const btn = document.getElementById('es-save-btn')
  btn.disabled = true
  btn.textContent = t('common.saving')

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
      errEl.textContent = d?.error || t('modals.failedSave')
      btn.disabled = false
      btn.textContent = t('modals.saveChanges')
      return
    }
    const key = toYMD(state.currentWeek)
    delete state.shiftsCache[key]
    await loadShifts()
    const updated = (state.shiftsCache[key] || []).find(s => s.id === state.activeShiftId)
    if (updated) {
      _editing = false
      state.activeShiftData = updated
      document.getElementById('shift-modal-body').innerHTML = workersSectionHtml()
      renderShiftModal(updated)
    } else {
      closeShiftModal()
    }
  } catch {
    errEl.textContent = t('common.networkError')
    btn.disabled = false
    btn.textContent = t('modals.saveChanges')
  }
}

// ── Cancel (delete) shift ─────────────────────────────────────────────────────

export function confirmCancelShift(shiftId) {
  if (!requireWebManage()) return
  document.getElementById('modal-footer').innerHTML = `
    <span style="font-size:0.82rem;color:var(--muted);align-self:center;flex:1">${t('modals.confirmCancel')}</span>
    <button class="btn btn-danger" id="confirm-cancel-btn" onclick="doDeleteShift('${shiftId}')">${t('modals.yesCancel')}</button>
    <button class="btn btn-ghost" onclick="renderModalFooterFromState()">${t('modals.keep')}</button>`
}

export function renderModalFooterFromState() {
  renderModalFooter(state.activeShiftData)
}

export async function doDeleteShift(shiftId) {
  if (!requireWebManage()) return
  const btn = document.getElementById('confirm-cancel-btn')
  if (btn) { btn.disabled = true; btn.textContent = t('common.cancelling') }
  try {
    const res = await apiFetch(`/shifts/${shiftId}`, { method: 'DELETE' })
    if (!res?.ok) {
      const d = await res?.json().catch(() => ({}))
      alert(d?.error || t('modals.failedCancelShift'))
      renderModalFooter(state.activeShiftData)
      return
    }
    closeShiftModal()
    const key = toYMD(state.currentWeek)
    delete state.shiftsCache[key]
    await loadShifts()
    updateActionBar()
  } catch {
    alert(t('common.networkError'))
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
window.editWorkerHours          = editWorkerHours
window.setEditHoursMode         = setEditHoursMode
window.cancelEditHours          = cancelEditHours
window.saveEditHours            = saveEditHours
window.openAssignPicker         = openAssignPicker
window.setAssignMode            = setAssignMode
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
