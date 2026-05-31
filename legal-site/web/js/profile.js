import { state } from './state.js'
import { apiFetch } from './api.js'
import { esc, getInitials, showToast } from './utils.js'
import { t } from './i18n.js'

let billingPeriod = 'monthly'

function getEffectivePlan(org) {
  if (!org) return 'FREE'
  if (org.trialEndsAt && new Date(org.trialEndsAt) > new Date()) return 'PRO'
  return org.plan || 'FREE'
}

function canManageWeb(org) {
  const plan = getEffectivePlan(org)
  return plan === 'PRO' || plan === 'BUSINESS'
}

function requireWebManage() {
  if (canManageWeb(state.currentOrg)) return true
  showToast(t('lock.actionBlocked'))
  return false
}

function getPlanLabel(org) {
  if (!org) return t('profile.planFree')
  const plan = org.plan || 'FREE'
  if (plan === 'PRO') return t('profile.planPro')
  if (plan === 'BUSINESS') return t('profile.planBusiness')
  if (org.trialEndsAt && new Date(org.trialEndsAt) > new Date()) {
    const ms = new Date(org.trialEndsAt) - new Date()
    const days = Math.ceil(ms / (1000 * 60 * 60 * 24))
    return days === 1 ? t('profile.proTrialOneDay') : t('profile.proTrialDays', { days })
  }
  return t('profile.planFree')
}

export { getEffectivePlan, canManageWeb, requireWebManage }

export function setBillingPeriod(period) {
  billingPeriod = period
  renderProfile()
}

export function renderProfile() {
  const { currentUser, currentOrg } = state
  const effectivePlan = getEffectivePlan(currentOrg)
  const isPaid = currentOrg.plan === 'PRO' || currentOrg.plan === 'BUSINESS'
  const isOnTrial = !isPaid && effectivePlan === 'PRO'
  const initials = esc(getInitials(currentUser.name))

  const PLANS = {
    PRO: {
      icon: '&#9889;', name: t('profile.planPro'), cls: 'pro', popular: true,
      monthly: { price: '$49.99', label: null },
      annual:  { price: '$39.99', label: t('profile.proAnnualNote') },
      features: t('profile.featuresPro'),
    },
    BUSINESS: {
      icon: '&#128081;', name: t('profile.planBusiness'), cls: 'business', popular: false,
      monthly: { price: '$99.99', label: null },
      annual:  { price: '$79.99', label: t('profile.bizAnnualNote') },
      features: t('profile.featuresBusiness'),
    },
  }

  document.getElementById('profile-content').innerHTML = `
    <div class="profile-grid">
      <div class="profile-card profile-card-identity">
        <div class="profile-avatar-xl" id="profile-avatar">${initials}</div>
        <div class="profile-name-xl">${esc(currentUser.name)}</div>
        <div class="profile-email-xl">${esc(currentUser.email)}</div>
        <div class="profile-id-badges">
          <span class="profile-role-badge">${t('profile.manager')}</span>
          <span class="plan-pill plan-${effectivePlan}">${getPlanLabel(currentOrg)}</span>
        </div>
      </div>

      <div class="profile-card" style="animation-delay:0.06s">
        <h3>${t('profile.organization')}</h3>
        <div class="info-row">
          <span class="info-label">${t('profile.name')}</span>
          <span class="info-value">${esc(currentOrg.name)}</span>
        </div>
        ${currentOrg.timezone ? `
        <div class="info-row">
          <span class="info-label">${t('profile.timezone')}</span>
          <span class="info-value">${esc(currentOrg.timezone)}</span>
        </div>` : ''}
        ${currentOrg.inviteCode ? `
        <div class="info-row" style="flex-direction:column;align-items:flex-start;gap:8px;border-bottom:none">
          <span class="info-label">${t('profile.inviteCode')}</span>
          <div>
            <div class="invite-code" onclick="copyInvite('${esc(currentOrg.inviteCode)}')" title="${t('profile.clickToCopy')}">${esc(currentOrg.inviteCode)}</div>
            <div class="copy-hint" id="copy-hint">${t('profile.clickToCopy')}</div>
          </div>
        </div>` : ''}
      </div>
    </div>

    <div class="billing-section">
      <div class="billing-section-header">
        <h3>${t('profile.planBilling')}</h3>
        ${isPaid ? `<button id="portal-btn" class="btn btn-ghost btn-sm" onclick="openPortal()">${t('profile.manageBilling')}</button>` : ''}
      </div>

      ${isPaid ? `
      <div class="billing-current-plan">
        <div class="billing-current-icon">${currentOrg.plan === 'BUSINESS' ? '&#128081;' : '&#9889;'}</div>
        <div>
          <div class="billing-current-name">${t('profile.currentPlan', { plan: getPlanLabel(currentOrg) })}</div>
          <div class="billing-current-desc">${t('profile.thankYou')}</div>
        </div>
      </div>
      ` : `
      ${isOnTrial ? `
      <div class="billing-trial-notice">
        <span>&#10024;</span>
        <span>${t('profile.trialNotice')}</span>
      </div>` : ''}

      <div class="billing-period-toggle">
        <button class="period-btn${billingPeriod === 'monthly' ? ' active' : ''}" onclick="setBillingPeriod('monthly')">${t('profile.monthly')}</button>
        <button class="period-btn${billingPeriod === 'annual' ? ' active' : ''}" onclick="setBillingPeriod('annual')">
          ${t('profile.annual')} <span class="period-save-badge">${t('profile.save20')}</span>
        </button>
      </div>

      <div class="billing-cards">
        ${Object.entries(PLANS).map(([key, p]) => billingCard(key, p)).join('')}
      </div>
      <p class="billing-footer-note">${t('profile.cancelAnytime')}</p>
      `}
    </div>
    ${currentUser.role === 'MANAGER' ? _profManagerHtml() : ''}`

  if (currentUser.avatarUrl) {
    const slot = document.getElementById('profile-avatar')
    const img = document.createElement('img')
    img.alt = ''
    img.onload = () => { slot.textContent = ''; slot.appendChild(img) }
    img.onerror = () => { /* keep initials */ }
    img.src = currentUser.avatarUrl
  }

  if (currentUser.role === 'MANAGER') {
    _profInitManagerSections()
  }
}

function billingCard(planKey, p) {
  const { price, label } = billingPeriod === 'annual' ? p.annual : p.monthly
  return `
    <div class="billing-plan-card billing-card-${p.cls}">
      ${p.popular ? `<div class="billing-card-popular-badge">${t('profile.mostPopular')}</div>` : ''}
      <div class="billing-card-top">
        <div class="billing-card-icon">${p.icon}</div>
        <div class="billing-card-name">${p.name}</div>
      </div>
      <div class="billing-card-price">
        <span class="billing-price-amount">${price}</span>
        <span class="billing-price-per">${t('profile.perMonth')}</span>
      </div>
      ${label ? `<div class="billing-annual-note">${label}</div>` : '<div class="billing-annual-note-placeholder"></div>'}
      <ul class="billing-card-features">
        ${p.features.map(f => `<li>${f}</li>`).join('')}
      </ul>
      <button id="checkout-btn-${planKey}" class="billing-upgrade-btn" onclick="startCheckout('${planKey}')">
        ${t('profile.upgradeTo', { plan: p.name })}
      </button>
    </div>`
}

export function copyInvite(code) {
  navigator.clipboard.writeText(code).then(() => {
    const hint = document.getElementById('copy-hint')
    if (hint) { hint.textContent = t('profile.copied'); setTimeout(() => { hint.textContent = t('profile.clickToCopy') }, 2000) }
  }).catch(() => {})
}

export async function startCheckout(planKey) {
  const btn = document.getElementById(`checkout-btn-${planKey}`)
  const originalText = btn?.textContent
  if (btn) { btn.disabled = true; btn.textContent = t('common.loadingShort') }

  const successUrl = window.location.origin + window.location.pathname + '?payment=success'

  try {
    const res = await apiFetch('/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: planKey, period: billingPeriod, successUrl }),
    })
    if (!res) { restoreBtn(btn, originalText); return }
    const data = await res.json()
    if (!data.url) throw new Error('No checkout URL')
    window.location.href = data.url
  } catch {
    restoreBtn(btn, originalText)
    alert(t('profile.checkoutFailed'))
  }
}

export async function openPortal() {
  const btn = document.getElementById('portal-btn')
  const originalText = btn?.textContent
  if (btn) { btn.disabled = true; btn.textContent = t('common.loadingShort') }

  try {
    const res = await apiFetch('/billing/portal', { method: 'POST' })
    if (!res) { restoreBtn(btn, originalText); return }
    const data = await res.json()
    if (!data.url) throw new Error('No portal URL')
    window.open(data.url, '_blank')
  } catch {
    alert(t('profile.portalFailed'))
  } finally {
    restoreBtn(btn, originalText)
  }
}

function restoreBtn(btn, text) {
  if (btn) { btn.disabled = false; btn.textContent = text }
}

window.copyInvite = copyInvite
window.startCheckout = startCheckout
window.openPortal = openPortal
window.setBillingPeriod = setBillingPeriod

// ── Manager profile sections: Monthly Hours · Team Members · Shift Types · Departments ──

const _TMPL_COLORS = ['#ef4444','#f97316','#f59e0b','#84cc16','#22c55e','#14b8a6','#06b6d4','#3b82f6','#8b5cf6','#ec4899']

let _profHoursMonth = _profNowMonth()
let _profHoursData  = null
let _profTemplates  = null
let _profDepts      = null
let _profNewTmpl    = false
let _profEditTmplId = null
let _profTmplOpen   = false

function _profNowMonth() {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
}

function _profFmtMonth(m) {
  const [y, mo] = m.split('-').map(Number)
  return new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function _profFmtHrs(h) {
  const hrs = Math.floor(h)
  const mins = Math.round((h - hrs) * 60)
  return mins === 0 ? `${hrs}h` : `${hrs}h ${mins}m`
}

// ── Skeleton HTML injected into renderProfile ──

function _profManagerHtml() {
  const isNow = _profHoursMonth === _profNowMonth()
  return `
    <div class="prof-section" style="animation-delay:0.08s">
      <div class="prof-section-head">
        <div class="prof-section-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          <span>${t('profile.monthlyHours')}</span>
        </div>
        <div class="prof-month-nav">
          <button class="prof-month-btn" onclick="profilePrevMonth()" aria-label="Previous month">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span id="prof-month-label">${_profFmtMonth(_profHoursMonth)}</span>
          <button class="prof-month-btn" id="prof-month-next" onclick="profileNextMonth()" ${isNow ? 'disabled' : ''} aria-label="Next month">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </div>
      <div id="prof-hours-body"><div class="loader-inline"><div class="spinner"></div></div></div>
    </div>

    <div class="prof-nav-row" onclick="showView('workers')" role="button" tabindex="0" onkeydown="if(event.key==='Enter')showView('workers')">
      <div class="prof-nav-icon prof-nav-icon-team">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      </div>
      <div class="prof-nav-text">
        <span class="prof-nav-label">${t('profile.teamMembers')}</span>
        <span class="prof-nav-sub">${t('profile.teamMembersSubtitle')}</span>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--muted);flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>
    </div>

    <div class="prof-section prof-section-collapsible" style="animation-delay:0.1s" id="prof-tmpl-section">
      <button class="prof-section-toggle-btn" onclick="profileToggleShiftTypes()">
        <div class="prof-section-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>
          <span>${t('profile.shiftTypes')}</span>
        </div>
        <div class="prof-toggle-right">
          <span class="prof-tmpl-badge" id="prof-tmpl-badge"></span>
          <svg class="prof-section-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </button>
      <div id="prof-templates-body"></div>
    </div>

    <div class="prof-section" style="animation-delay:0.12s">
      <div class="prof-section-head">
        <div class="prof-section-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          <span>${t('profile.departments')}</span>
        </div>
      </div>
      <div id="prof-depts-body"><div class="loader-inline"><div class="spinner"></div></div></div>
      <div class="prof-dept-add-row">
        <input type="text" class="prof-tmpl-input" id="prof-new-dept" placeholder="${t('profile.departmentPlaceholder')}" onkeydown="if(event.key==='Enter')profileAddDept()">
        <button class="prof-dept-add-btn" onclick="profileAddDept()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>
    </div>`
}

// ── API loaders ──

async function _profLoadHours() {
  const res = await apiFetch(`/reports/monthly-hours?month=${_profHoursMonth}`)
  if (!res?.ok) return []
  return res.json()
}

async function _profLoadTemplates() {
  const res = await apiFetch('/shift-templates')
  if (!res?.ok) return []
  return res.json()
}

async function _profLoadDepts() {
  const res = await apiFetch('/departments')
  if (!res?.ok) return []
  return res.json()
}

// ── Render section bodies ──

function _profRenderHours() {
  const el = document.getElementById('prof-hours-body')
  if (!el) return
  const nextBtn = document.getElementById('prof-month-next')
  if (nextBtn) nextBtn.disabled = _profHoursMonth === _profNowMonth()

  const data = _profHoursData
  if (!data || data.length === 0) {
    el.innerHTML = `<p class="prof-empty">${t('profile.monthlyHoursEmpty')}</p>`
    return
  }

  const totalHours  = data.reduce((s, w) => s + w.totalHours, 0)
  const totalShifts = data.reduce((s, w) => s + w.shiftCount, 0)

  el.innerHTML = `
    <div class="prof-hours-summary">
      <div class="prof-hours-stat prof-hours-stat-blue">
        <div class="prof-hours-stat-val">${_profFmtHrs(totalHours)}</div>
        <div class="prof-hours-stat-label">${t('profile.monthlyHoursTotalLabel')}</div>
      </div>
      <div class="prof-hours-stat">
        <div class="prof-hours-stat-val">${data.length}</div>
        <div class="prof-hours-stat-label">${t('profile.monthlyHoursWorkers')}</div>
      </div>
      <div class="prof-hours-stat">
        <div class="prof-hours-stat-val">${totalShifts}</div>
        <div class="prof-hours-stat-label">${t('profile.monthlyHoursShifts')}</div>
      </div>
    </div>
    <div class="prof-hours-list">
      ${data.map((w, i) => `
        <div class="prof-hours-row">
          <span class="prof-hours-rank">${i + 1}</span>
          <div class="prof-hours-avatar">${esc(w.worker.name.charAt(0).toUpperCase())}</div>
          <div class="prof-hours-info">
            <span class="prof-hours-name">${esc(w.worker.name)}</span>
            <span class="prof-hours-shifts">${w.shiftCount} shift${w.shiftCount !== 1 ? 's' : ''}</span>
          </div>
          <div class="prof-hours-val">
            <span class="prof-hours-total">${_profFmtHrs(w.totalHours)}</span>
            ${w.completedHours < w.totalHours ? `<span class="prof-hours-done">${_profFmtHrs(w.completedHours)} done</span>` : ''}
          </div>
        </div>`).join('')}
    </div>
    <button class="prof-hours-export-btn" onclick="profileExportHoursCSV()">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      ${t('profile.monthlyHoursExport')}
    </button>`
}

function _profRenderTemplates() {
  const el = document.getElementById('prof-templates-body')
  if (!el) return
  const tmpls = _profTemplates

  // Update badge count
  const badge = document.getElementById('prof-tmpl-badge')
  if (badge && tmpls) badge.textContent = tmpls.length > 0 ? tmpls.length : ''

  // Update chevron rotation
  const chevron = document.querySelector('#prof-tmpl-section .prof-section-chevron')
  if (chevron) chevron.classList.toggle('open', _profTmplOpen)

  if (!_profTmplOpen) { el.innerHTML = ''; return }
  if (!tmpls) { el.innerHTML = '<div class="loader-inline"><div class="spinner"></div></div>'; return }

  const addForm = _profNewTmpl ? _profNewTmplFormHtml() : ''

  let body = ''
  if (tmpls.length === 0 && !_profNewTmpl) {
    body = `<p class="prof-empty">${t('profile.noShiftTypes')}</p>`
  } else {
    // Group by department
    const byDept = {}
    for (const tmpl of tmpls) {
      const key = tmpl.department?.name ?? ''
      if (!byDept[key]) byDept[key] = []
      byDept[key].push(tmpl)
    }
    for (const [deptName, deptTmpls] of Object.entries(byDept)) {
      body += `<div class="prof-tmpl-dept-group">
        ${deptName ? `<div class="prof-tmpl-dept-header">${esc(deptName)}</div>` : ''}
        ${deptTmpls.map(tmpl => _profEditTmplId === tmpl.id ? _profEditTmplFormHtml(tmpl) : _profTmplRowHtml(tmpl)).join('')}
      </div>`
    }
  }

  el.innerHTML = `${addForm}${body}
    <div class="prof-tmpl-add-area">
      <button class="btn btn-ghost btn-sm" onclick="profileToggleNewTemplate()">+ ${t('profile.addShiftType')}</button>
    </div>`
}

function _profTmplRowHtml(tmpl) {
  return `
    <div class="prof-tmpl-row">
      <span class="prof-tmpl-dot" style="background:${esc(tmpl.color)}"></span>
      <div class="prof-tmpl-info">
        <span class="prof-tmpl-name">${esc(tmpl.name)}</span>
        <span class="prof-tmpl-meta">${esc(tmpl.startTime)} – ${esc(tmpl.endTime)} · ${esc(tmpl.department?.name ?? '')} · ${tmpl.requiredWorkers} worker${tmpl.requiredWorkers !== 1 ? 's' : ''}</span>
      </div>
      <button class="prof-tmpl-action" onclick="profileEditTemplate('${esc(tmpl.id)}')" title="Edit">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="prof-tmpl-action prof-tmpl-delete" onclick="profileDeleteTemplate('${esc(tmpl.id)}')" title="Delete">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      </button>
    </div>`
}

function _profNewTmplFormHtml() {
  const depts = _profDepts || []
  return `
    <div class="prof-tmpl-form">
      <div class="prof-color-picker" id="prof-new-color-picker">
        ${_TMPL_COLORS.map((c, i) => `<button type="button" class="prof-color-swatch${i === 0 ? ' active' : ''}" style="background:${c}" data-color="${c}" onclick="profilePickNewColor('${c}',this)"></button>`).join('')}
      </div>
      <input type="text" class="prof-tmpl-input" id="prof-new-name" placeholder="Shift name (e.g. Morning, Evening)" maxlength="60">
      <div class="prof-tmpl-times">
        <div><label class="prof-tmpl-label">Start</label><input type="time" class="prof-tmpl-input" id="prof-new-start" value="09:00"></div>
        <div><label class="prof-tmpl-label">End</label><input type="time" class="prof-tmpl-input" id="prof-new-end" value="17:00"></div>
      </div>
      <div>
        <label class="prof-tmpl-label">Department</label>
        <select class="prof-tmpl-input" id="prof-new-dept-sel">
          <option value="">— pick a department —</option>
          ${depts.map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}
        </select>
      </div>
      <div class="prof-tmpl-workers-row">
        <label class="prof-tmpl-label">Required workers</label>
        <div class="prof-tmpl-stepper">
          <button type="button" onclick="profileStepWorkers('prof-new-workers',-1)">−</button>
          <span id="prof-new-workers">1</span>
          <button type="button" onclick="profileStepWorkers('prof-new-workers',1)">+</button>
        </div>
      </div>
      <div class="prof-tmpl-form-actions">
        <button class="btn btn-ghost btn-sm" onclick="profileCancelNewTemplate()">${t('common.cancel')}</button>
        <button class="btn btn-sm prof-tmpl-save-btn" onclick="profileSaveNewTemplate()" id="prof-new-save-btn">${t('common.save')}</button>
      </div>
    </div>`
}

function _profEditTmplFormHtml(tmpl) {
  const safeId = esc(tmpl.id)
  return `
    <div class="prof-tmpl-form prof-tmpl-form-edit">
      <div class="prof-color-picker" id="prof-edit-color-${safeId}">
        ${_TMPL_COLORS.map(c => `<button type="button" class="prof-color-swatch${c === tmpl.color ? ' active' : ''}" style="background:${c}" data-color="${c}" onclick="profilePickEditColor('${c}',this,'${safeId}')"></button>`).join('')}
      </div>
      <input type="text" class="prof-tmpl-input" id="prof-edit-name-${safeId}" value="${esc(tmpl.name)}" maxlength="60">
      <div class="prof-tmpl-times">
        <div><label class="prof-tmpl-label">Start</label><input type="time" class="prof-tmpl-input" id="prof-edit-start-${safeId}" value="${esc(tmpl.startTime)}"></div>
        <div><label class="prof-tmpl-label">End</label><input type="time" class="prof-tmpl-input" id="prof-edit-end-${safeId}" value="${esc(tmpl.endTime)}"></div>
      </div>
      <div class="prof-tmpl-dept-fixed">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        ${esc(tmpl.department?.name ?? '')}
      </div>
      <div class="prof-tmpl-workers-row">
        <label class="prof-tmpl-label">Required workers</label>
        <div class="prof-tmpl-stepper">
          <button type="button" onclick="profileStepWorkers('prof-edit-workers-${safeId}',-1)">−</button>
          <span id="prof-edit-workers-${safeId}">${tmpl.requiredWorkers}</span>
          <button type="button" onclick="profileStepWorkers('prof-edit-workers-${safeId}',1)">+</button>
        </div>
      </div>
      <div class="prof-tmpl-form-actions">
        <button class="btn btn-ghost btn-sm" onclick="profileCancelEditTemplate()">${t('common.cancel')}</button>
        <button class="btn btn-sm prof-tmpl-save-btn" onclick="profileSaveEditTemplate('${safeId}')" id="prof-edit-save-${safeId}">${t('common.save')}</button>
      </div>
    </div>`
}

function _profRenderDepts() {
  const el = document.getElementById('prof-depts-body')
  if (!el) return
  const depts = _profDepts
  if (!depts) { el.innerHTML = '<div class="loader-inline"><div class="spinner"></div></div>'; return }

  el.innerHTML = depts.length === 0
    ? `<p class="prof-empty">${t('profile.noDepartments')}</p>`
    : `<div class="prof-dept-chips">${depts.map(d => `
        <div class="prof-dept-chip">
          <span>${esc(d.name)}</span>
          <button class="prof-dept-chip-del" onclick="profileDeleteDept('${esc(d.id)}','${esc(d.name)}')" title="Delete">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>`).join('')}
      </div>`
}

// ── Bootstrap ──

async function _profInitManagerSections() {
  _profNewTmpl = false
  _profEditTmplId = null
  _profTmplOpen = false
  const [hours, templates, depts] = await Promise.all([_profLoadHours(), _profLoadTemplates(), _profLoadDepts()])
  _profHoursData = hours
  _profTemplates = templates
  _profDepts = depts
  _profRenderHours()
  _profRenderTemplates()
  _profRenderDepts()
}

// ── Month navigation ──

window.profilePrevMonth = async function() {
  const [y, mo] = _profHoursMonth.split('-').map(Number)
  const d = new Date(y, mo - 2, 1)
  _profHoursMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const label = document.getElementById('prof-month-label')
  if (label) label.textContent = _profFmtMonth(_profHoursMonth)
  const body = document.getElementById('prof-hours-body')
  if (body) body.innerHTML = '<div class="loader-inline"><div class="spinner"></div></div>'
  _profHoursData = await _profLoadHours()
  _profRenderHours()
}

window.profileNextMonth = async function() {
  if (_profHoursMonth === _profNowMonth()) return
  const [y, mo] = _profHoursMonth.split('-').map(Number)
  const d = new Date(y, mo, 1)
  _profHoursMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const label = document.getElementById('prof-month-label')
  if (label) label.textContent = _profFmtMonth(_profHoursMonth)
  const body = document.getElementById('prof-hours-body')
  if (body) body.innerHTML = '<div class="loader-inline"><div class="spinner"></div></div>'
  _profHoursData = await _profLoadHours()
  _profRenderHours()
}

// ── CSV export ──

window.profileExportHoursCSV = function() {
  const data = _profHoursData
  if (!data || data.length === 0) return
  const rows = [['Name', 'Email', 'Total Hours', 'Completed Hours', 'Shifts']]
  data.forEach(w => rows.push([w.worker.name, w.worker.email, _profFmtHrs(w.totalHours), _profFmtHrs(w.completedHours), w.shiftCount]))
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `hours-${_profHoursMonth}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Template actions ──

window.profileToggleShiftTypes = function() {
  _profTmplOpen = !_profTmplOpen
  _profNewTmpl = false
  _profEditTmplId = null
  _profRenderTemplates()
}

window.profileToggleNewTemplate = function() {
  if (!_profTmplOpen) { _profTmplOpen = true }
  _profNewTmpl = !_profNewTmpl
  _profEditTmplId = null
  _profRenderTemplates()
}

window.profileCancelNewTemplate = function() {
  _profNewTmpl = false
  _profRenderTemplates()
}

window.profilePickNewColor = function(color, btn) {
  document.querySelectorAll('#prof-new-color-picker .prof-color-swatch').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
}

window.profilePickEditColor = function(color, btn, safeId) {
  document.querySelectorAll(`#prof-edit-color-${safeId} .prof-color-swatch`).forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
}

window.profileStepWorkers = function(elId, delta) {
  const el = document.getElementById(elId)
  if (!el) return
  el.textContent = Math.max(1, (parseInt(el.textContent, 10) || 1) + delta)
}

window.profileSaveNewTemplate = async function() {
  const name    = document.getElementById('prof-new-name')?.value.trim()
  const start   = document.getElementById('prof-new-start')?.value
  const end     = document.getElementById('prof-new-end')?.value
  const deptId  = document.getElementById('prof-new-dept-sel')?.value
  const workers = parseInt(document.getElementById('prof-new-workers')?.textContent || '1', 10)
  const color   = document.querySelector('#prof-new-color-picker .prof-color-swatch.active')?.dataset.color || _TMPL_COLORS[0]

  if (!name)   { showToast('Enter a shift name', 'error'); return }
  if (!deptId) { showToast('Select a department', 'error'); return }

  const btn = document.getElementById('prof-new-save-btn')
  if (btn) { btn.disabled = true; btn.textContent = t('common.saving') }

  try {
    const res = await apiFetch('/shift-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, startTime: start, endTime: end, departmentId: deptId, requiredWorkers: workers, color }),
    })
    if (!res?.ok) throw new Error()
    const created = await res.json()
    _profTemplates = [...(_profTemplates || []), created]
    _profNewTmpl = false
    _profRenderTemplates()
  } catch {
    showToast(t('profile.shiftTypeSaveFailed'), 'error')
    if (btn) { btn.disabled = false; btn.textContent = t('common.save') }
  }
}

window.profileEditTemplate = function(id) {
  _profEditTmplId = id
  _profNewTmpl = false
  _profRenderTemplates()
}

window.profileCancelEditTemplate = function() {
  _profEditTmplId = null
  _profRenderTemplates()
}

window.profileSaveEditTemplate = async function(id) {
  const tmpl = _profTemplates?.find(tmpl => tmpl.id === id)
  if (!tmpl) return
  const name    = document.getElementById(`prof-edit-name-${id}`)?.value.trim()
  const start   = document.getElementById(`prof-edit-start-${id}`)?.value
  const end     = document.getElementById(`prof-edit-end-${id}`)?.value
  const workers = parseInt(document.getElementById(`prof-edit-workers-${id}`)?.textContent || '1', 10)
  const color   = document.querySelector(`#prof-edit-color-${id} .prof-color-swatch.active`)?.dataset.color || tmpl.color

  if (!name) { showToast('Enter a shift name', 'error'); return }

  const btn = document.getElementById(`prof-edit-save-${id}`)
  if (btn) { btn.disabled = true; btn.textContent = t('common.saving') }

  try {
    const res = await apiFetch(`/shift-templates/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, startTime: start, endTime: end, requiredWorkers: workers, color }),
    })
    if (!res?.ok) throw new Error()
    const updated = await res.json()
    _profTemplates = _profTemplates.map(tmpl => tmpl.id === id ? updated : tmpl)
    _profEditTmplId = null
    _profRenderTemplates()
  } catch {
    showToast(t('profile.shiftTypeSaveFailed'), 'error')
    if (btn) { btn.disabled = false; btn.textContent = t('common.save') }
  }
}

window.profileDeleteTemplate = async function(id) {
  if (!confirm('Delete this shift type?')) return
  try {
    const res = await apiFetch(`/shift-templates/${id}`, { method: 'DELETE' })
    if (!res?.ok) throw new Error()
    _profTemplates = _profTemplates.filter(tmpl => tmpl.id !== id)
    if (_profEditTmplId === id) _profEditTmplId = null
    _profRenderTemplates()
  } catch {
    showToast(t('profile.shiftTypeDeleteFailed'), 'error')
  }
}

// ── Department actions ──

window.profileAddDept = async function() {
  const input = document.getElementById('prof-new-dept')
  const name  = input?.value.trim()
  if (!name) return
  const btn = document.querySelector('.prof-dept-add-btn')
  if (btn) btn.disabled = true
  try {
    const res = await apiFetch('/departments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res?.ok) throw new Error()
    const dept = await res.json()
    _profDepts = [...(_profDepts || []), dept]
    if (input) input.value = ''
    _profRenderDepts()
  } catch {
    showToast(t('profile.departmentAddFailed'), 'error')
  } finally {
    if (btn) btn.disabled = false
  }
}

window.profileDeleteDept = async function(id, name) {
  if (!confirm(`Delete department "${name}"?\nWorkers will be unassigned from it.`)) return
  try {
    const res = await apiFetch(`/departments/${id}`, { method: 'DELETE' })
    if (!res?.ok) throw new Error()
    _profDepts = _profDepts.filter(d => d.id !== id)
    _profRenderDepts()
  } catch {
    showToast(t('profile.departmentDeleteFailed'), 'error')
  }
}
