const API = 'https://shift-right-production.up.railway.app/api'

let pollInterval = null
let countdownInterval = null
let expiresAt = null
let currentToken = null

async function init() {
  try {
    const res = await fetch(`${API}/auth/qr/generate`, { method: 'POST' })
    if (!res.ok) throw new Error('Failed to generate QR')
    const data = await res.json()
    currentToken = data.token
    expiresAt = new Date(data.expiresAt)
    renderQR(data.token)
    startCountdown()
    startPolling(data.token)
  } catch (e) {
    showError('Could not connect to ShiftRight. Please refresh the page.')
  }
}

function renderQR(token) {
  document.getElementById('qrcode').innerHTML = ''
  new QRCode(document.getElementById('qrcode'), {
    text: token,
    width: 200,
    height: 200,
    colorDark: '#1a2d4f',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M,
  })
}

function startCountdown() {
  if (countdownInterval) clearInterval(countdownInterval)
  countdownInterval = setInterval(() => {
    const remaining = Math.max(0, expiresAt - Date.now())
    const minutes = Math.floor(remaining / 60000)
    const seconds = Math.floor((remaining % 60000) / 1000)
    document.getElementById('countdown').textContent =
      `${minutes}:${seconds.toString().padStart(2, '0')}`

    if (remaining <= 0) {
      clearInterval(countdownInterval)
      clearInterval(pollInterval)
      init()
    }
  }, 1000)
}

function startPolling(token) {
  if (pollInterval) clearInterval(pollInterval)
  pollInterval = setInterval(async () => {
    try {
      const res = await fetch(`${API}/auth/qr/poll/${token}`)
      if (res.status === 404) {
        clearInterval(pollInterval)
        clearInterval(countdownInterval)
        init()
        return
      }
      if (!res.ok) return
      const data = await res.json()
      if (data.status === 'upgrade_required') {
        clearInterval(pollInterval)
        clearInterval(countdownInterval)
        document.getElementById('qr-state').style.display = 'none'
        document.getElementById('upgrade-state').style.display = 'block'
        return
      }
      if (data.status === 'scanned') {
        clearInterval(pollInterval)
        clearInterval(countdownInterval)
        onScanned(data)
      }
    } catch {
      // Network error — keep polling
    }
  }, 2000)
}

function isPaidPlan(org) {
  if (org?.trialEndsAt && new Date(org.trialEndsAt) > new Date()) return true
  return org?.plan === 'PRO' || org?.plan === 'BUSINESS'
}

function onScanned(data) {
  clearInterval(pollInterval)
  clearInterval(countdownInterval)

  if (!isPaidPlan(data.organization)) {
    document.getElementById('qr-state').style.display = 'none'
    document.getElementById('upgrade-state').style.display = 'block'
    return
  }

  localStorage.setItem('shiftflow_token', data.token)
  localStorage.setItem('shiftflow_refresh_token', data.refreshToken)
  localStorage.setItem('shiftflow_user', JSON.stringify(data.user))
  localStorage.setItem('shiftflow_org', JSON.stringify(data.organization))

  document.getElementById('qr-state').style.display = 'none'
  document.getElementById('success-state').style.display = 'block'
  setTimeout(() => { window.location.href = '/web/' }, 1200)
}

function showError(msg) {
  const el = document.getElementById('error-msg')
  el.textContent = msg
  el.style.display = 'block'
}

init()
