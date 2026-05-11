import { state } from './state.js'
import { apiFetch } from './api.js'

function getEffectivePlan(org) {
  if (!org) return 'FREE'
  if (org.trialEndsAt && new Date(org.trialEndsAt) > new Date()) return 'PRO'
  return org.plan || 'FREE'
}

export { getEffectivePlan }

export function renderProfile() {
  const { currentUser, currentOrg } = state
  const effectivePlan = getEffectivePlan(currentOrg)
  const isPaid = currentOrg.plan !== 'FREE'
  const isOnTrial = !isPaid && effectivePlan === 'PRO'
  const planLabels = { FREE: 'Free', PRO: 'Pro', BUSINESS: 'Business' }
  const initials = (currentUser.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  document.getElementById('profile-content').innerHTML = `
    <div class="profile-grid">
      <div class="profile-card">
        <h3>Your account</h3>
        <div class="profile-avatar">${initials}</div>
        <div class="profile-name">${currentUser.name}</div>
        <div class="profile-email">${currentUser.email}</div>
        <div class="profile-role-badge">Manager</div>
      </div>

      <div class="profile-card">
        <h3>Organization</h3>
        <div class="info-row">
          <span class="info-label">Name</span>
          <span class="info-value">${currentOrg.name}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Plan</span>
          <span class="info-value">
            <span class="plan-pill plan-${currentOrg.plan}">${planLabels[currentOrg.plan] || currentOrg.plan}</span>
            ${isOnTrial ? '<span class="trial-badge">Trial active</span>' : ''}
          </span>
        </div>
        ${currentOrg.timezone ? `
        <div class="info-row">
          <span class="info-label">Timezone</span>
          <span class="info-value">${currentOrg.timezone}</span>
        </div>` : ''}
        ${currentOrg.inviteCode ? `
        <div class="info-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
          <span class="info-label">Invite code</span>
          <div>
            <div class="invite-code" onclick="copyInvite('${currentOrg.inviteCode}')" title="Click to copy">${currentOrg.inviteCode}</div>
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
          <div class="billing-current-name">${planLabels[currentOrg.plan]} Plan</div>
          <div class="billing-current-desc">Thank you for supporting ShiftRight! Use the Manage billing button to update your subscription, cancel, or download invoices.</div>
        </div>
      </div>
      ` : `
      ${isOnTrial ? `
      <div class="billing-trial-notice">
        <span>&#10024;</span>
        <span>You&apos;re on a free trial &mdash; upgrade now to keep access after your trial ends.</span>
      </div>` : ''}
      <div class="billing-cards">
        ${billingCard('PRO', '&#9889;', 'Pro', 'pro', '$49.99', [
          'Up to 50 workers',
          'Unlimited locations',
          'Advanced scheduling',
          'Analytics &amp; reports',
          'Web app access',
          'Priority support',
        ], true)}
        ${billingCard('BUSINESS', '&#128081;', 'Business', 'business', '$99.99', [
          'Unlimited workers',
          'Unlimited locations',
          'Everything in Pro',
          'Dedicated support',
        ], false)}
      </div>
      <p class="billing-footer-note">Annual plans available — save up to 20% &middot; Cancel anytime &middot; Secured by Lemon Squeezy</p>
      `}
    </div>`
}

function billingCard(planKey, icon, name, cls, price, features, popular) {
  return `
    <div class="billing-plan-card billing-card-${cls}">
      ${popular ? '<div class="billing-card-popular-badge">Most popular</div>' : ''}
      <div class="billing-card-top">
        <div class="billing-card-icon">${icon}</div>
        <div class="billing-card-name">${name}</div>
      </div>
      <div class="billing-card-price">
        <span class="billing-price-amount">${price}</span>
        <span class="billing-price-per">/month</span>
      </div>
      <ul class="billing-card-features">
        ${features.map(f => `<li>${f}</li>`).join('')}
      </ul>
      <button id="checkout-btn-${planKey}" class="billing-upgrade-btn" onclick="startCheckout('${planKey}')">
        Upgrade to ${name}
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

  try {
    const res = await apiFetch('/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: planKey, period: 'monthly' }),
    })
    if (!res) { restoreBtn(btn, originalText); return }
    const data = await res.json()
    if (!data.url) throw new Error('No checkout URL')
    window.open(data.url, '_blank')
    watchForPlanChange()
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

function watchForPlanChange() {
  const check = async () => {
    if (document.hidden) return
    document.removeEventListener('visibilitychange', check)

    try {
      const res = await apiFetch('/billing/plan')
      if (!res) return
      const info = await res.json()
      if (info.plan && info.plan !== state.currentOrg?.plan) {
        state.currentOrg = { ...state.currentOrg, plan: info.plan }
        localStorage.setItem('shiftflow_org', JSON.stringify(state.currentOrg))
        const planEl = document.getElementById('sb-plan')
        if (planEl) { planEl.textContent = info.plan; planEl.className = `plan-badge plan-${info.plan}` }
        const profileView = document.getElementById('view-profile')
        if (profileView && profileView.style.display !== 'none') renderProfile()
      }
    } catch {}
  }
  document.addEventListener('visibilitychange', check)
}

window.copyInvite = copyInvite
window.startCheckout = startCheckout
window.openPortal = openPortal
