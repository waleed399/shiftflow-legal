const API = 'https://shift-right-production.up.railway.app/api'

let _token = null
let _period = 'monthly'

const PRICES = {
  monthly: { PRO: '$49.99', BIZ: '$99.99', PRO_SUB: '/ month', BIZ_SUB: '/ month' },
  annual:  { PRO: '$39.99', BIZ: '$79.99', PRO_SUB: '/ month (billed $479.88/yr)', BIZ_SUB: '/ month (billed $959.88/yr)' },
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
  document.getElementById('pro-price').innerHTML = `<strong>${p.PRO}</strong> ${p.PRO_SUB}`
  document.getElementById('biz-price').innerHTML = `<strong>${p.BIZ}</strong> ${p.BIZ_SUB}`
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
    btn.textContent = plan === 'PRO' ? 'Upgrade to Pro' : 'Upgrade to Business'
    alert('Could not start checkout. Please try again.')
  }
}

async function init() {
  const params = new URLSearchParams(window.location.search)
  const token = params.get('token')

  if (!token) {
    document.getElementById('error-msg').textContent =
      'No login token found. Please open the ShiftRight app and tap "Open Pricing Page" again.'
    show('state-error')
    return
  }

  try {
    const res = await fetch(`${API}/auth/magic-link/consume/${encodeURIComponent(token)}`)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      document.getElementById('error-msg').textContent =
        data.error || 'This link has expired. Please open the ShiftRight app and try again.'
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
    document.getElementById('user-org').textContent =
      `${data.organization.name} · ${data.organization.plan === 'FREE' ? 'Free plan' : data.organization.plan + ' plan'}`

    // Remove token from URL without reloading (security hygiene)
    history.replaceState({}, '', window.location.pathname)

    show('state-ready')
  } catch {
    document.getElementById('error-msg').textContent =
      'Could not connect to ShiftRight. Please check your connection and try again.'
    show('state-error')
  }
}

// Expose for onclick handlers
window.setPeriod = setPeriod
window.upgrade   = upgrade

init()
