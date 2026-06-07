// Coverage view — managers define the hours each department must be staffed
// ("coverage blocks"), and the app shows how well the published shifts cover
// those windows (live gap detection). Mirrors the phone app's Coverage Builder,
// but laid out for the big screen: a week strip + per-day block cards.
//
// Backend: GET/POST/PATCH/DELETE /api/coverage-blocks. Create/edit/delete are
// PRO/BUSINESS-gated server-side, so every mutation is guarded with
// requireWebManage() to fail fast with a friendly toast on locked workspaces.

import { state } from './state.js'
import { apiFetch } from './api.js'
import { esc, toYMD, addDays, isSameDay, getWeekStartOf, MONTHS, DAYS } from './utils.js'
import { t } from './i18n.js'
import { requireWebManage } from './profile.js'

// ── Module state ──────────────────────────────────────────────────────────────

let _covWeek   = null   // Date — Monday/Sunday of the visible week
let _covDay    = null   // Date — currently selected day
let _blocks    = []     // coverage blocks for the selected day (gaps computed)
let _depts     = []     // [{ id, name }]
let _deptMap   = {}     // id → name (blocks don't always include the department)
let _editingId = null   // id of the block being edited, or null when creating

// ── Time helpers (ported from the phone's coverage.service) ────────────────────

function pm(time) {
  const [h, m] = String(time || '').substring(0, 5).split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function fm(min) {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function durationLabel(open, close) {
  const mins = pm(close) - pm(open)
  if (mins <= 0) return ''
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

// Uncovered windows between open/close, after merging the shifts that overlap it.
function computeGaps(block) {
  const open  = pm(block.openTime)
  const close = pm(block.closeTime)
  if (close <= open) return []

  const covered = (block.shifts || [])
    .map(s => [pm(s.startTime), pm(s.endTime)])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0])

  const merged = []
  for (const [s, e] of covered) {
    const cs = Math.max(s, open)
    const ce = Math.min(e, close)
    if (ce <= cs) continue
    if (merged.length && cs <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], ce)
    } else {
      merged.push([cs, ce])
    }
  }

  const gaps = []
  let cursor = open
  for (const [s, e] of merged) {
    if (s > cursor) gaps.push({ startTime: fm(cursor), endTime: fm(s) })
    cursor = Math.max(cursor, e)
  }
  if (cursor < close) gaps.push({ startTime: fm(cursor), endTime: fm(close) })
  return gaps
}

function coveragePct(block) {
  const total = pm(block.closeTime) - pm(block.openTime)
  if (total <= 0) return 0
  const gap = (block.gaps || []).reduce((s, g) => s + (pm(g.endTime) - pm(g.startTime)), 0)
  return Math.round(((total - gap) / total) * 100)
}

function pctColor(pct) {
  return pct >= 100 ? '#059669' : pct > 0 ? '#d97706' : '#94a3b8'
}

function deptName(block) {
  return block.department?.name || _deptMap[block.departmentId] || t('common.dash')
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function renderCoverage() {
  if (!_covWeek) {
    _covWeek = getWeekStartOf(state.currentWeek || new Date(), state.currentOrg?.weekStartsOn)
    const today = new Date()
    const end = addDays(_covWeek, 6)
    _covDay = (today >= _covWeek && today <= end) ? today : new Date(_covWeek)
  }
  renderWeekLabel()
  renderDayTabs()
  await ensureDepts()
  await loadBlocks()
}

export function changeCoverageWeek(dir) {
  _covWeek = getWeekStartOf(addDays(_covWeek, dir * 7), state.currentOrg?.weekStartsOn)
  const today = new Date()
  const end = addDays(_covWeek, 6)
  _covDay = (today >= _covWeek && today <= end) ? today : new Date(_covWeek)
  renderWeekLabel()
  renderDayTabs()
  loadBlocks()
}

function renderWeekLabel() {
  const end = addDays(_covWeek, 6)
  const el  = document.getElementById('coverage-week-label')
  if (el) el.textContent = `${_covWeek.getDate()} ${MONTHS[_covWeek.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`
}

function renderDayTabs() {
  const today = new Date()
  const c = document.getElementById('coverage-day-tabs')
  if (!c) return
  c.innerHTML = ''
  for (let i = 0; i < 7; i++) {
    const day = addDays(_covWeek, i)
    const isToday  = isSameDay(day, today)
    const isActive = isSameDay(day, _covDay)
    const tab = document.createElement('div')
    tab.className = `day-tab${isActive ? ' active' : ''}${isToday ? ' today' : ''}`
    tab.setAttribute('role', 'button')
    tab.tabIndex = 0
    tab.innerHTML = `<span>${DAYS[day.getDay()]}</span><span class="day-num">${day.getDate()}</span>`
    tab.onclick = () => { _covDay = day; renderDayTabs(); loadBlocks() }
    c.appendChild(tab)
  }
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function ensureDepts() {
  const res = await apiFetch('/departments')
  if (!res?.ok) return
  _depts = await res.json()
  _deptMap = Object.fromEntries(_depts.map(d => [d.id, d.name]))
}

async function loadBlocks() {
  const el = document.getElementById('coverage-content')
  if (!el) return
  el.innerHTML = '<div class="loader-inline"><div class="spinner"></div></div>'
  const res = await apiFetch(`/coverage-blocks?date=${toYMD(_covDay)}`)
  if (!res?.ok) {
    el.innerHTML = `<div class="empty-state"><p>${t('coverage.failedLoad')}</p></div>`
    return
  }
  const json = await res.json()
  // The endpoint has returned both a bare array and a {data} envelope across
  // versions — normalise either way.
  const arr = Array.isArray(json) ? json : (json.data || [])
  _blocks = arr
    .map(b => ({ ...b, gaps: computeGaps(b) }))
    .sort((a, b) => a.openTime.localeCompare(b.openTime))
  renderBlocks()
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderBlocks() {
  const el = document.getElementById('coverage-content')
  if (!el) return

  if (_blocks.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <p>${t('coverage.empty')}</p>
        <p class="cov-empty-hint">${t('coverage.emptyHint')}</p>
      </div>`
    return
  }

  el.innerHTML = `<div class="cov-grid">${_blocks.map(blockCard).join('')}</div>`
}

function blockCard(block) {
  const pct      = coveragePct(block)
  const color    = pctColor(pct)
  const shiftN   = block.shifts?.length || 0
  const gapN     = block.gaps?.length || 0
  const safeId   = esc(block.id)

  const gapsHtml = gapN > 0
    ? `<div class="cov-gaps">${block.gaps.map(g =>
        `<span class="cov-gap-chip">${t('coverage.gapLabel', { start: esc(g.startTime), end: esc(g.endTime) })}</span>`
      ).join('')}</div>`
    : `<div class="cov-fully">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        ${t('coverage.fullyCovered')}
      </div>`

  const shiftLabel = shiftN === 1 ? t('coverage.shiftCountOne') : t('coverage.shiftCount', { n: shiftN })
  const gapLabel   = gapN === 1 ? t('coverage.gapCountOne') : t('coverage.gapCount', { n: gapN })

  return `
    <div class="cov-card" style="border-inline-start-color:${color}">
      <div class="cov-card-top">
        <div class="cov-dept">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          <span>${esc(deptName(block))}</span>
        </div>
        <span class="cov-pct" style="color:${color};background:${color}1a">${t('coverage.covered', { pct })}</span>
      </div>

      <div class="cov-time">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span class="cov-time-range">${esc(block.openTime)} – ${esc(block.closeTime)}</span>
        <span class="cov-duration">${durationLabel(block.openTime, block.closeTime)}</span>
      </div>

      ${block.notes ? `<div class="cov-notes">${esc(block.notes)}</div>` : ''}

      ${gapsHtml}

      <div class="cov-card-foot">
        <span class="cov-meta">${shiftLabel} · ${gapLabel}</span>
        <div class="cov-actions">
          <button class="cov-action" onclick="editCoverageBlock('${safeId}')" title="${t('coverage.editBlock')}" aria-label="${t('coverage.editBlock')}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="cov-action cov-action-del" onclick="deleteCoverageBlock('${safeId}')" title="${t('common.delete')}" aria-label="${t('common.delete')}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>
    </div>`
}

// ── Modal (create / edit) ──────────────────────────────────────────────────────

function fmtModalDate(d) {
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export function openCoverageModal() {
  if (!requireWebManage()) return
  if (_depts.length === 0) { window.showToast(t('coverage.noDepartmentsYet')); return }
  _editingId = null
  fillModal(null)
  document.getElementById('cov-modal-title').textContent = t('coverage.createBlock')
  showModal()
}

export function editCoverageBlock(id) {
  if (!requireWebManage()) return
  const block = _blocks.find(b => b.id === id)
  if (!block) return
  _editingId = id
  fillModal(block)
  document.getElementById('cov-modal-title').textContent = t('coverage.editBlock')
  showModal()
}

function fillModal(block) {
  const sub = document.getElementById('cov-modal-subtitle')
  if (sub) sub.textContent = fmtModalDate(_covDay)

  const sel = document.getElementById('cov-department')
  sel.innerHTML =
    `<option value="" disabled ${block ? '' : 'selected'}>${t('coverage.pickDepartment')}</option>` +
    _depts.map(d => `<option value="${esc(d.id)}" ${block?.departmentId === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')

  document.getElementById('cov-open').value  = block ? String(block.openTime).substring(0, 5) : '09:00'
  document.getElementById('cov-close').value = block ? String(block.closeTime).substring(0, 5) : '17:00'
  document.getElementById('cov-notes').value = block?.notes || ''
  document.getElementById('cov-error').textContent = ''

  const btn = document.getElementById('cov-submit')
  btn.disabled = false
  btn.textContent = block ? t('common.save') : t('coverage.newBlock')
}

function showModal() {
  document.getElementById('coverage-modal').classList.remove('hidden')
}

export function closeCoverageModal() {
  document.getElementById('coverage-modal').classList.add('hidden')
  _editingId = null
}

export function onCoverageOverlayClick(e) {
  if (e.target === e.currentTarget) closeCoverageModal()
}

export async function submitCoverageBlock() {
  if (!requireWebManage()) return
  const departmentId = document.getElementById('cov-department').value
  const openTime     = document.getElementById('cov-open').value
  const closeTime    = document.getElementById('cov-close').value
  const notes        = document.getElementById('cov-notes').value.trim()
  const errEl        = document.getElementById('cov-error')

  if (!departmentId) { errEl.textContent = t('coverage.validationDepartment'); return }
  if (!openTime || !closeTime) { errEl.textContent = t('coverage.validationTime'); return }
  if (pm(closeTime) <= pm(openTime)) { errEl.textContent = t('coverage.validationOrder'); return }

  const btn = document.getElementById('cov-submit')
  btn.disabled = true
  btn.textContent = t('common.saving')

  const payload = { date: toYMD(_covDay), departmentId, openTime, closeTime, ...(notes ? { notes } : {}) }
  const path    = _editingId ? `/coverage-blocks/${_editingId}` : '/coverage-blocks'
  const method  = _editingId ? 'PATCH' : 'POST'

  try {
    const res = await apiFetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res?.ok) throw new Error()
    closeCoverageModal()
    await loadBlocks()
  } catch {
    errEl.textContent = t('coverage.saveFailed')
  } finally {
    btn.disabled = false
    btn.textContent = _editingId ? t('common.save') : t('coverage.newBlock')
  }
}

export async function deleteCoverageBlock(id) {
  if (!requireWebManage()) return
  if (!confirm(t('coverage.deleteConfirm'))) return
  try {
    const res = await apiFetch(`/coverage-blocks/${id}`, { method: 'DELETE' })
    if (!res?.ok) throw new Error()
    _blocks = _blocks.filter(b => b.id !== id)
    renderBlocks()
  } catch {
    window.showToast(t('coverage.deleteFailed'))
  }
}

// ── Window bindings ────────────────────────────────────────────────────────────

window.changeCoverageWeek   = changeCoverageWeek
window.openCoverageModal    = openCoverageModal
window.closeCoverageModal   = closeCoverageModal
window.onCoverageOverlayClick = onCoverageOverlayClick
window.submitCoverageBlock  = submitCoverageBlock
window.editCoverageBlock    = editCoverageBlock
window.deleteCoverageBlock  = deleteCoverageBlock
