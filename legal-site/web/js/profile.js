import { state } from './state.js'
import { apiFetch } from './api.js'
import { esc, getInitials } from './utils.js'
import { t } from './i18n.js'

let billingPeriod = 'monthly'

function getEffectivePlan(org) {
  if (!org) return 'FREE'
  if (org.trialEndsAt && new Date(org.trialEndsAt) > new Date()) return 'PRO'
  return org.plan || 'FREE'
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

export { getEffectivePlan }

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
    </div>`

  if (currentUser.avatarUrl) {
    const slot = document.getElementById('profile-avatar')
    const img = document.createElement('img')
    img.alt = ''
    img.onload = () => { slot.textContent = ''; slot.appendChild(img) }
    img.onerror = () => { /* keep initials */ }
    img.src = currentUser.avatarUrl
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
