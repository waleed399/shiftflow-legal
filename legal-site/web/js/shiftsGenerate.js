// Generate Schedule modal — calls /schedule/auto-generate, lets the manager
// pick one of the AI-proposed coverage options, then POSTs to /schedule/confirm.
//
// Public surface (wired to window.* in shifts.js):
//   openGenerateModal, closeGenerateModal, confirmGenerate,
//   selectGenOption, onGenerateOverlayClick

import { state } from './state.js'
import { apiFetch } from './api.js'
import { toYMD, esc, showToast, fmtDate } from './utils.js'
import { t } from './i18n.js'
import { requireWebManage } from './profile.js'
import { loadShifts } from './shifts.js'

let _genData = null
let _genSelected = null

export async function openGenerateModal() {
  if (!requireWebManage()) return
  document.getElementById('generate-modal').classList.remove('hidden')
  const body = document.getElementById('generate-modal-body')
  const applyBtn = document.getElementById('gen-apply-btn')
  body.innerHTML = `<div style="padding:32px;text-align:center"><div class="spinner" style="margin:0 auto 16px;width:32px;height:32px;border-width:3px"></div><p style="color:var(--muted);font-size:0.875rem">${t('shifts.generateLoading')}</p></div>`
  applyBtn.disabled = true
  _genData = null
  _genSelected = null

  const key = toYMD(state.currentWeek)
  try {
    const res = await apiFetch('/schedule/auto-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekOf: key }),
    })
    if (!res) { closeGenerateModal(); return }
    if (res.status === 409 || res.status === 422) {
      const d = await res.json()
      body.innerHTML = `<div class="empty-state"><p style="color:${res.status === 409 ? '#dc2626' : 'inherit'}">${esc(d.error)}</p></div>`
      return
    }
    if (!res.ok) {
      body.innerHTML = `<div class="empty-state"><p>${t('shifts.generateFailed')}</p></div>`
      return
    }
    _genData = await res.json()
    _genSelected = 'optimal'
    renderGenOptions()
  } catch {
    body.innerHTML = `<div class="empty-state"><p>${t('common.networkError')}</p></div>`
  }
}

// A line per understaffed shift is unreadable once a week has a few dozen of
// them, and the manager cannot act on any single line anyway — the response is
// always the same: chase availability. So lead with the totals and keep the
// per-shift list behind a disclosure for whoever wants it.
//
// Built from `preview`, not from the server's `warnings` array: preview is
// structured, so this stays translatable. The warnings strings are assembled
// in English on the server and would have shown as English to a Hebrew manager.
function renderWarnings(selected) {
  const preview = selected?.preview || []
  const short = preview.filter(s => s.understaffed)
  if (short.length === 0) return ''

  const unfilled = short.reduce(
    (n, s) => n + Math.max(0, (s.requiredWorkers || 0) - (s.assignedWorkers?.length || 0)), 0
  )
  // Nobody at all was available, as opposed to a partial fill. Almost always
  // means availability was never submitted for the week, or the workers are
  // not in these departments — worth saying, because the totals alone read
  // like a mild shortfall.
  const noneAtAll = short.every(s => (s.assignedWorkers?.length || 0) === 0)

  const rows = short.map(s => {
    const when = `${esc(s.departmentName || '')} ${esc(s.startTime)}\u2013${esc(s.endTime)}`
    const day  = fmtDate(s.date)
    const got  = `${s.assignedWorkers?.length || 0}/${s.requiredWorkers || 0}`
    return `<li>${when} · ${esc(day)} — ${esc(got)}</li>`
  }).join('')

  return `
    <div class="gen-warnings-box">
      <p>${t('shifts.generateWarningsFor', { label: esc(selected.label) })}</p>
      <p class="gen-warn-summary">${t('shifts.generateUnderstaffedSummary', {
        count: short.length, total: preview.length, slots: unfilled,
      })}</p>
      ${noneAtAll ? `<p class="gen-warn-hint">${t('shifts.generateNoneAvailable')}</p>` : ''}
      <details class="gen-warn-details">
        <summary>${t('shifts.generateShowShifts', { count: short.length })}</summary>
        <ul>${rows}</ul>
      </details>
    </div>`
}

function renderGenOptions() {
  if (!_genData) return
  const { options, invalidAvailability } = _genData

  const cards = options.map(opt => {
    const fullyStaffed = opt.preview.filter(s => !s.understaffed).length
    const total = opt.preview.length
    const warnCount = opt.warnings.length
    const isSelected = _genSelected === opt.id
    const coverageCls = fullyStaffed === total ? 'gen-stat-ok' : 'gen-stat-warn'
    return `
      <div class="gen-option-card${isSelected ? ' gen-option-selected' : ''}" onclick="selectGenOption('${opt.id}')" role="button" tabindex="0" aria-pressed="${isSelected ? 'true' : 'false'}">
        <div class="gen-option-top">
          <span class="gen-option-label">${esc(opt.label)}</span>
          <div class="gen-option-radio${isSelected ? ' gen-radio-on' : ''}"></div>
        </div>
        <div class="gen-option-desc">${esc(opt.description)}</div>
        <div class="gen-option-stats">
          <span class="gen-stat-chip ${coverageCls}">${fullyStaffed}/${total} ${t('shifts.generateFullyStaffed')}</span>
          ${warnCount > 0 ? `<span class="gen-stat-chip gen-stat-warn">${warnCount} ${warnCount === 1 ? t('shifts.generateWarning') : t('shifts.generateWarnings')}</span>` : ''}
        </div>
      </div>`
  }).join('')

  const selected = options.find(o => o.id === _genSelected)
  const warningsHtml = renderWarnings(selected)

  const invalidHtml = invalidAvailability?.length ? `
    <div class="gen-invalid-box">
      ⚠ ${esc(invalidAvailability.map(w => w.name).join(', '))} — ${t('shifts.generateInvalidAvail')}
    </div>` : ''

  document.getElementById('generate-modal-body').innerHTML = `
    <div class="gen-options-grid">${cards}</div>
    ${warningsHtml}${invalidHtml}`
  document.getElementById('gen-apply-btn').disabled = false
}

export function closeGenerateModal() {
  document.getElementById('generate-modal').classList.add('hidden')
}

export async function confirmGenerate() {
  if (!requireWebManage()) return
  if (!_genData || !_genSelected) return
  const selected = _genData.options.find(o => o.id === _genSelected)
  if (!selected) return

  const btn = document.getElementById('gen-apply-btn')
  const prev = btn.textContent
  btn.disabled = true
  btn.textContent = t('shifts.generateApplying')

  try {
    const res = await apiFetch('/schedule/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekOf: _genData.weekOf, preview: selected.preview }),
    })
    if (res?.ok) {
      closeGenerateModal()
      delete state.shiftsCache[toYMD(state.currentWeek)]
      await loadShifts()
      showToast(t('shifts.generateApplied'))
    } else {
      const d = await res?.json().catch(() => ({}))
      showToast(d?.error || t('shifts.generateApplyFailed'))
      btn.disabled = false
      btn.textContent = prev
    }
  } catch {
    showToast(t('common.networkError'))
    btn.disabled = false
    btn.textContent = prev
  }
}

// Inline handlers — wired to window.* by shifts.js.
export function selectGenOption(id) {
  _genSelected = id
  renderGenOptions()
}

export function onGenerateOverlayClick(e) {
  if (e.target.id === 'generate-modal') closeGenerateModal()
}
