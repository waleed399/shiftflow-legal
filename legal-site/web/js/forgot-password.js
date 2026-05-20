import {
  $, postJson, showAlert, setBtnLoading,
  EMAIL_RE, ERROR_MAP,
  createResendCooldown,
} from './auth-common.js'
import { renderStrengthMeter, wirePasswordToggle } from './password-strength.js'
import { initI18n, mountLanguageSwitcher } from './i18n.js'

let _email = ''
let _verifiedToken = ''
let _resend = null

function showStep(name) {
  ;['step-email', 'step-otp', 'step-password', 'step-success'].forEach((s) => {
    $(s).classList.toggle('visible', s === `step-${name}`)
  })
  const map = { email: 1, otp: 2, password: 3, success: 3 }
  for (let i = 1; i <= 3; i++) {
    const pip = $(`pip-${i}`)
    pip.classList.remove('active', 'done')
    if (i < map[name])   pip.classList.add('done')
    if (i === map[name]) pip.classList.add('active')
  }
}

// ── Step 1: Send OTP ─────────────────────────────────────────────────────────
async function handleSendOtp() {
  const email = $('email').value.trim().toLowerCase()
  const alertEl = $('alert-1')
  showAlert(alertEl, '')

  if (!EMAIL_RE.test(email)) { showAlert(alertEl, ERROR_MAP.invalid_email); return }

  const btn = $('btn-send-otp')
  setBtnLoading(btn, true)
  try {
    await postJson('/auth/send-otp', { email })
    _email = email
    $('otp-target-email').textContent = email
    showStep('otp')
    _resend.start()
    $('otp-code').focus()
  } catch (e) {
    showAlert(alertEl, e.friendly || ERROR_MAP.generic)
  } finally {
    setBtnLoading(btn, false, '<span>Send verification code</span>')
  }
}

async function handleResend() {
  if (_resend.remaining > 0) return
  const alertEl = $('alert-2')
  const btn = $('btn-resend')
  showAlert(alertEl, '')
  btn.disabled = true
  btn.textContent = 'Sending…'
  try {
    await postJson('/auth/send-otp', { email: _email })
    $('otp-code').value = ''
    _resend.start()
  } catch (e) {
    showAlert(alertEl, e.friendly || ERROR_MAP.generic)
    _resend.stop()
  }
}

// ── Step 2: Verify OTP ───────────────────────────────────────────────────────
async function handleVerifyOtp() {
  const code = $('otp-code').value.trim()
  const alertEl = $('alert-2')
  showAlert(alertEl, '')
  if (!/^\d{6}$/.test(code)) { showAlert(alertEl, ERROR_MAP.invalid_otp); return }

  const btn = $('btn-verify-otp')
  setBtnLoading(btn, true)
  try {
    const data = await postJson('/auth/verify-otp', { email: _email, code })
    _verifiedToken = data.verifiedToken
    showStep('password')
    $('password').focus()
  } catch (e) {
    showAlert(alertEl, e.friendly || ERROR_MAP.generic)
  } finally {
    setBtnLoading(btn, false, '<span>Verify code</span>')
  }
}

// ── Step 3: Form state ───────────────────────────────────────────────────────
function evaluateForm() {
  const pw = $('password').value
  const cf = $('password-confirm').value
  const { allOk: strong } = renderStrengthMeter(pw)
  const match = pw.length > 0 && pw === cf
  $('btn-reset').disabled = !(strong && match)
}

function updateConfirmState() {
  const pw = $('password').value
  const cf = $('password-confirm').value
  const mismatch = cf.length > 0 && pw !== cf
  $('pwd-mismatch').style.display = mismatch ? 'block' : 'none'
}

async function handleReset() {
  const alertEl = $('alert-3')
  showAlert(alertEl, '')
  const btn = $('btn-reset')
  setBtnLoading(btn, true)
  try {
    await postJson('/auth/reset-password', {
      email: _email,
      verifiedToken: _verifiedToken,
      newPassword: $('password').value,
    })
    showStep('success')
  } catch (e) {
    showAlert(alertEl, e.friendly || ERROR_MAP.generic)
    setBtnLoading(btn, false, '<span>Reset password</span>')
  }
}

// ── Wiring ───────────────────────────────────────────────────────────────────
function wireEvents() {
  $('btn-send-otp').addEventListener('click', handleSendOtp)
  $('email').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSendOtp() })

  $('btn-verify-otp').addEventListener('click', handleVerifyOtp)
  $('otp-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleVerifyOtp() })
  $('otp-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6)
    if (e.target.value.length === 6) handleVerifyOtp()
  })
  $('btn-resend').addEventListener('click', handleResend)
  $('btn-change-email').addEventListener('click', () => {
    $('otp-code').value = ''
    showAlert($('alert-2'), '')
    showStep('email')
    $('email').focus()
  })

  $('password').addEventListener('input', () => { evaluateForm(); updateConfirmState() })
  $('password-confirm').addEventListener('input', () => { evaluateForm(); updateConfirmState() })
  $('btn-reset').addEventListener('click', handleReset)
  $('password-confirm').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !$('btn-reset').disabled) handleReset()
  })

  wirePasswordToggle('password', 'toggle-password')
  wirePasswordToggle('password-confirm', 'toggle-password-confirm')

  $('btn-go-login').addEventListener('click', () => { window.location.href = '/web/login.html' })
}

function init() {
  initI18n()
  mountLanguageSwitcher(document.getElementById('auth-lang-switcher'), { variant: 'auth' })
  _resend = createResendCooldown($('btn-resend'))
  wireEvents()
  showStep('email')
}

init()
