import { initI18n, t } from './i18n.js'
import { API } from './config.js'

let _token = null
let _period = 'monthly'

const PRICES = {
  monthly: { PRO: '$49.99', BIZ: '$99.99', PRO_SUB: () => t('upgrade.perMonth'), BIZ_SUB: () => t('upgrade.perMonth') },
  annual:  { PRO: '$39.99', BIZ: '$79.99', PRO_SUB: () => t('upgrade.perMonthAnnual', { total: '$479.88' }), BIZ_SUB: () => t('upgrade.perMonthAnnual', { total: '$959.88' }) },
}

function show(id) {
  ['state-loading', 'state-error', 'state-ready'].forEach(s => {
    document.getElementById(s).classList.toggle('visible', s === id)
  })
}

function getInitials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function setPeriod(period) {
  _period = period
  document.getElementById('btn-monthly').classList.toggle('active', period === 'monthly')
  document.getElementById('btn-annual').classList.toggle('active', period === 'annual')
  const p = PRICES[period]
  document.getElementById('pro-price').innerHTML = `<strong>${p.PRO}</strong> ${p.PRO_SUB()}`
  document.getElementById('biz-price').innerHTML = `<strong>${p.BIZ}</strong> ${p.BIZ_SUB()}`
}

async function upgrade(plan) {
  const btnId = plan === 'PRO' ? 'btn-pro' : 'btn-biz'
  const btn = document.getElementById(btnId)
  btn.disabled = true
  btn.innerHTML = '<div class="btn-spinner"></div>'

  try {
    const res = await fetch(`${API}/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_token}` },
      body: JSON.stringify({ plan, period: _period }),
    })
    if (!res.ok) throw new Error('checkout_failed')
    const { url } = await res.json()
    window.location.href = url
  } catch {
    btn.disabled = false
    btn.textContent = plan === 'PRO' ? t('upgrade.upgradePro') : t('upgrade.upgradeBusiness')
    alert(t('upgrade.checkoutFailed'))
  }
}

async function init() {
  initI18n()

  const params = new URLSearchParams(window.location.search)
  const token = params.get('token')

  if (!token) {
    document.getElementById('error-msg').textContent = t('upgrade.noToken')
    show('state-error')
    return
  }

  try {
    const res = await fetch(`${API}/auth/magic-link/consume/${encodeURIComponent(token)}`)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      document.getElementById('error-msg').textContent = data.error || t('upgrade.linkExpired')
      show('state-error')
      return
    }

    const data = await res.json()
    _token = data.token

    // Store in localStorage so the main web app works if they navigate there too
    localStorage.setItem('shiftflow_token', data.token)
    localStorage.setItem('shiftflow_refresh_token', data.refreshToken)
    localStorage.setItem('shiftflow_user', JSON.stringify(data.user))
    localStorage.setItem('shiftflow_org', JSON.stringify(data.organization))

    // Populate header
    document.getElementById('user-avatar').textContent = getInitials(data.user.name)
    document.getElementById('user-name').textContent = data.user.name
    document.getElementById('user-org').textContent = data.organization.plan === 'FREE'
      ? t('upgrade.orgFree', { name: data.organization.name })
      : t('upgrade.orgPlan', { name: data.organization.name, plan: data.organization.plan })

    // Remove token from URL without reloading (security hygiene)
    history.replaceState({}, '', window.location.pathname)

    show('state-ready')
  } catch {
    document.getElementById('error-msg').textContent = t('upgrade.cannotConnect')
    show('state-error')
  }
}

// Expose for onclick handlers
window.setPeriod = setPeriod
window.upgrade   = upgrade

init()
