import { state } from './state.js'
import { apiFetch } from './api.js'
import { esc } from './utils.js'

let billingPeriod = 'monthly'

function getEffectivePlan(org) {
  if (!org) return 'FREE'
  if (org.trialEndsAt && new Date(org.trialEndsAt) > new Date()) return 'PRO'
  return org.plan || 'FREE'
}

function getPlanLabel(org) {
  if (!org) return 'Free'
  const plan = org.plan || 'FREE'
  if (plan === 'PRO') return 'Pro'
  if (plan === 'BUSINESS') return 'Business'
  if (org.trialEndsAt && new Date(org.trialEndsAt) > new Date()) {
    const ms = new Date(org.trialEndsAt) - new Date()
    const days = Math.ceil(ms / (1000 * 60 * 60 * 24))
    return `Pro Trial (${days} day${days === 1 ? '' : 's'} left)`
  }
  return 'Free'
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
  const initials = esc((currentUser.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase())

  const PLANS = {
    PRO: {
      icon: '&#9889;', name: 'Pro', cls: 'pro', popular: true,
      monthly: { price: '$49.99', label: null },
      annual:  { price: '$39.99', label: 'Billed $479.88/yr &mdash; save $120' },
      features: ['Up to 50 workers', 'Unlimited locations', 'Advanced scheduling', 'Analytics &amp; reports', 'Web app access', 'Priority support'],
    },
    BUSINESS: {
      icon: '&#128081;', name: 'Business', cls: 'business', popular: false,
      monthly: { price: '$99.99', label: null },
      annual:  { price: '$79.99', label: 'Billed $959.88/yr &mdash; save $240' },
      features: ['Unlimited workers', 'Unlimited locations', 'Everything in Pro', 'Dedicated support'],
    },
  }

  document.getElementById('profile-content').innerHTML = `
    <div class="profile-grid">
      <div class="profile-card">
        <h3>Your account</h3>
        <div class="profile-avatar">${initials}</div>
        <div class="profile-name">${esc(currentUser.name)}</div>
        <div class="profile-email">${esc(currentUser.email)}</div>
        <div class="profile-role-badge">Manager</div>
      </div>

      <div class="profile-card">
        <h3>Organization</h3>
        <div class="info-row">
          <span class="info-label">Name</span>
          <span class="info-value">${esc(currentOrg.name)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Plan</span>
          <span class="info-value">
            <span class="plan-pill plan-${effectivePlan}">${getPlanLabel(currentOrg)}</span>
          </span>
        </div>
        ${currentOrg.timezone ? `
        <div class="info-row">
          <span class="info-label">Timezone</span>
          <span class="info-value">${esc(currentOrg.timezone)}</span>
        </div>` : ''}
        ${currentOrg.inviteCode ? `
        <div class="info-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
          <span class="info-label">Invite code</span>
          <div>
            <div class="invite-code" onclick="copyInvite('${esc(currentOrg.inviteCode)}')" title="Click to copy">${esc(currentOrg.inviteCode)}</div>
            <div class="copy-hint" id="copy-hint">Click to copy</div>
          </div>
        </div>` : ''}
      </div>
    </div>

    <div class="billing-section">
      <div class="billing-section-header">
        <h3>Plan &amp; Billing</h3>
        ${isPaid ? `<button id="portal-btn" class="btn btn-ghost btn-sm" onclick="openPortal()">&#9881; Manage billing</button>` : ''}
      </div>

      ${isPaid ? `
      <div class="billing-current-plan">
        <div class="billing-current-icon">${currentOrg.plan === 'BUSINESS' ? '&#128081;' : '&#9889;'}</div>
        <div>
          <div class="billing-current-name">${getPlanLabel(currentOrg)} Plan</div>
          <div class="billing-current-desc">Thank you for supporting ShiftRight! Use the Manage billing button to update your subscription, cancel, or download invoices.</div>
        </div>
      </div>
      ` : `
      ${isOnTrial ? `
      <div class="billing-trial-notice">
        <span>&#10024;</span>
        <span>You&apos;re on a free trial &mdash; upgrade now to keep access after your trial ends.</span>
      </div>` : ''}

      <div class="billing-period-toggle">
        <button class="period-btn${billingPeriod === 'monthly' ? ' active' : ''}" onclick="setBillingPeriod('monthly')">Monthly</button>
        <button class="period-btn${billingPeriod === 'annual' ? ' active' : ''}" onclick="setBillingPeriod('annual')">
          Annual <span class="period-save-badge">Save 20%</span>
        </button>
      </div>

      <div class="billing-cards">
        ${Object.entries(PLANS).map(([key, p]) => billingCard(key, p)).join('')}
      </div>
      <p class="billing-footer-note">Cancel anytime &middot; Secured by Lemon Squeezy</p>
      `}
    </div>`
}

function billingCard(planKey, p) {
  const { price, label } = billingPeriod === 'annual' ? p.annual : p.monthly
  return `
    <div class="billing-plan-card billing-card-${p.cls}">
      ${p.popular ? '<div class="billing-card-popular-badge">Most popular</div>' : ''}
      <div class="billing-card-top">
        <div class="billing-card-icon">${p.icon}</div>
        <div class="billing-card-name">${p.name}</div>
      </div>
      <div class="billing-card-price">
        <span class="billing-price-amount">${price}</span>
        <span class="billing-price-per">/mo</span>
      </div>
      ${label ? `<div class="billing-annual-note">${label}</div>` : '<div class="billing-annual-note-placeholder"></div>'}
      <ul class="billing-card-features">
        ${p.features.map(f => `<li>${f}</li>`).join('')}
      </ul>
      <button id="checkout-btn-${planKey}" class="billing-upgrade-btn" onclick="startCheckout('${planKey}')">
        Upgrade to ${p.name}
      </button>
    </div>`
}

export function copyInvite(code) {
  navigator.clipboard.writeText(code).then(() => {
    const hint = document.getElementById('copy-hint')
    if (hint) { hint.textContent = 'Copied!'; setTimeout(() => { hint.textContent = 'Click to copy' }, 2000) }
  }).catch(() => {})
}

export async function startCheckout(planKey) {
  const btn = document.getElementById(`checkout-btn-${planKey}`)
  const originalText = btn?.textContent
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…' }

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
    alert('Failed to start checkout. Please try again.')
  }
}

export async function openPortal() {
  const btn = document.getElementById('portal-btn')
  const originalText = btn?.textContent
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…' }

  try {
    const res = await apiFetch('/billing/portal', { method: 'POST' })
    if (!res) { restoreBtn(btn, originalText); return }
    const data = await res.json()
    if (!data.url) throw new Error('No portal URL')
    window.open(data.url, '_blank')
  } catch {
    alert('Failed to open billing portal. Please try again.')
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
