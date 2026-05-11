import { state } from './state.js'

function getEffectivePlan(org) {
  if (!org) return 'FREE'
  if (org.trialEndsAt && new Date(org.trialEndsAt) > new Date()) return 'PRO'
  return org.plan || 'FREE'
}

export { getEffectivePlan }

export function renderProfile() {
  const { currentUser, currentOrg } = state
  const plan = getEffectivePlan(currentOrg)
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
          <span class="info-value">${planLabels[plan] || plan}</span>
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
    </div>`
}

export function copyInvite(code) {
  navigator.clipboard.writeText(code).then(() => {
    const hint = document.getElementById('copy-hint')
    if (hint) { hint.textContent = 'Copied!'; setTimeout(() => { hint.textContent = 'Click to copy' }, 2000) }
  }).catch(() => {})
}

window.copyInvite = copyInvite
