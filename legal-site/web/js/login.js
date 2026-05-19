const API = 'https://shift-right-production.up.railway.app/api'
const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/

function $(id) { return document.getElementById(id) }

function showAlert(msg) {
  const el = $('alert')
  if (!msg) { el.style.display = 'none'; el.textContent = ''; return }
  el.textContent = msg
  el.style.display = 'block'
}

function setBtnLoading(btn, loading) {
  btn.disabled = !!loading
  if (loading) {
    btn.dataset.label = btn.innerHTML
    btn.innerHTML = '<div class="btn-spinner"></div>'
  } else {
    btn.innerHTML = btn.dataset.label || '<span>Sign in</span>'
  }
}

async function handleLogin() {
  const email = $('email').value.trim().toLowerCase()
  const password = $('password').value
  showAlert('')

  if (!EMAIL_RE.test(email)) { showAlert('Please enter a valid email address.'); return }
  if (!password)             { showAlert('Please enter your password.'); return }

  const btn = $('btn-login')
  setBtnLoading(btn, true)

  try {
    const res = await fetch(API + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    let data = {}
    try { data = await res.json() } catch {}

    if (!res.ok) {
      showAlert(data.error || 'Could not sign in. Please check your credentials.')
      setBtnLoading(btn, false)
      return
    }

    localStorage.setItem('shiftflow_token', data.token)
    localStorage.setItem('shiftflow_refresh_token', data.refreshToken)
    localStorage.setItem('shiftflow_user', JSON.stringify(data.user))
    localStorage.setItem('shiftflow_org', JSON.stringify(data.organization))

    window.location.href = '/web/'
  } catch (e) {
    showAlert('Could not connect. Please check your internet connection.')
    setBtnLoading(btn, false)
  }
}

function init() {
  if (localStorage.getItem('shiftflow_token')) {
    window.location.href = '/web/'
    return
  }
  $('btn-login').addEventListener('click', handleLogin)
  $('email').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('password').focus() })
  $('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin() })
  $('toggle-password').addEventListener('click', () => {
    const input = $('password')
    const btn = $('toggle-password')
    const isPw = input.type === 'password'
    input.type = isPw ? 'text' : 'password'
    btn.textContent = isPw ? 'Hide' : 'Show'
  })
}

init()
