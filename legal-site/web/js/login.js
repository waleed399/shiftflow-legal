import {
  $, postJson, showAlert, setBtnLoading,
  EMAIL_RE, ERROR_MAP, classifyLoginError,
  getToken, saveSession,
} from './auth-common.js'
import { wirePasswordToggle } from './password-strength.js'

async function handleLogin() {
  const alertEl = $('alert')
  const email = $('email').value.trim().toLowerCase()
  const password = $('password').value
  showAlert(alertEl, '')

  if (!EMAIL_RE.test(email)) { showAlert(alertEl, ERROR_MAP.invalid_email);    return }
  if (!password)             { showAlert(alertEl, ERROR_MAP.missing_password); return }

  const btn = $('btn-login')
  setBtnLoading(btn, true)
  try {
    const data = await postJson('/auth/login', { email, password }, {
      errorClassifier: (status) => classifyLoginError(status),
    })
    saveSession(data)
    window.location.href = '/web/'
  } catch (e) {
    showAlert(alertEl, e.friendly || ERROR_MAP.generic)
    setBtnLoading(btn, false)
  }
}

function init() {
  if (getToken()) { window.location.href = '/web/'; return }

  $('btn-login').addEventListener('click', handleLogin)
  $('email').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('password').focus() })
  $('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin() })
  wirePasswordToggle('password', 'toggle-password')
}

init()
