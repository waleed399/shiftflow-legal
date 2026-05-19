const API = 'https://shift-right-production.up.railway.app/api'

const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/

let _email = ''
let _verifiedToken = ''
let _resendCooldown = 0
let _resendTimer = null

// ── Helpers ───────────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id) }

function showStep(name) {
  ;['step-email', 'step-otp', 'step-details', 'step-success'].forEach(s => {
    $(s).classList.toggle('visible', s === `step-${name}`)
  })
  const map = { email: 1, otp: 2, details: 3, success: 3 }
  for (let i = 1; i <= 3; i++) {
    const pip = $(`pip-${i}`)
    pip.classList.remove('active', 'done')
    if (i < map[name]) pip.classList.add('done')
    if (i === map[name]) pip.classList.add('active')
  }
}

function showAlert(stepNum, message) {
  const el = $(`alert-${stepNum}`)
  if (!message) { el.style.display = 'none'; el.textContent = ''; return }
  el.textContent = message
  el.style.display = 'block'
}

function setBtnLoading(btn, loading, labelHtml) {
  btn.disabled = !!loading
  if (loading) {
    btn.dataset.label = btn.innerHTML
    btn.innerHTML = '<div class="btn-spinner"></div>'
  } else {
    btn.innerHTML = labelHtml || btn.dataset.label || btn.innerHTML
  }
}

async function postJson(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  let data = {}
  try { data = await res.json() } catch { /* no-op */ }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

// ── Step 1: Send OTP ──────────────────────────────────────────────────────────
async function handleSendOtp() {
  const email = $('email').value.trim().toLowerCase()
  const confirm = $('email-confirm').value.trim().toLowerCase()
  showAlert(1, '')

  if (!EMAIL_RE.test(email)) { showAlert(1, 'Please enter a valid email address.'); return }
  if (email !== confirm)     { showAlert(1, 'The two email addresses do not match.'); return }

  const btn = $('btn-send-otp')
  setBtnLoading(btn, true)
  try {
    await postJson('/auth/send-otp', { email })
    _email = email
    $('otp-target-email').textContent = email
    showStep('otp')
    startResendCooldown(60)
    $('otp-code').focus()
  } catch (e) {
    showAlert(1, e.message || 'Could not send code. Please try again.')
  } finally {
    setBtnLoading(btn, false, '<span>Send verification code</span>')
  }
}

function startResendCooldown(seconds) {
  _resendCooldown = seconds
  updateResendBtn()
  if (_resendTimer) clearInterval(_resendTimer)
  _resendTimer = setInterval(() => {
    _resendCooldown--
    if (_resendCooldown <= 0) { clearInterval(_resendTimer); _resendTimer = null }
    updateResendBtn()
  }, 1000)
}

function updateResendBtn() {
  const btn = $('btn-resend')
  if (_resendCooldown > 0) {
    btn.disabled = true
    btn.textContent = `Resend code in ${_resendCooldown}s`
  } else {
    btn.disabled = false
    btn.textContent = 'Resend code'
  }
}

async function handleResend() {
  if (_resendCooldown > 0) return
  showAlert(2, '')
  const btn = $('btn-resend')
  btn.disabled = true
  btn.textContent = 'Sending…'
  try {
    await postJson('/auth/send-otp', { email: _email })
    $('otp-code').value = ''
    startResendCooldown(60)
  } catch (e) {
    showAlert(2, e.message || 'Could not resend code.')
    btn.disabled = false
    btn.textContent = 'Resend code'
  }
}

// ── Step 2: Verify OTP ────────────────────────────────────────────────────────
async function handleVerifyOtp() {
  const code = $('otp-code').value.trim()
  showAlert(2, '')
  if (code.length !== 6 || !/^\d{6}$/.test(code)) {
    showAlert(2, 'Please enter the 6-digit code.')
    return
  }
  const btn = $('btn-verify-otp')
  setBtnLoading(btn, true)
  try {
    const data = await postJson('/auth/verify-otp', { email: _email, code })
    _verifiedToken = data.verifiedToken
    showStep('details')
    $('org-name').focus()
  } catch (e) {
    showAlert(2, e.message || 'Invalid code. Please try again.')
  } finally {
    setBtnLoading(btn, false, '<span>Verify code</span>')
  }
}

// ── Step 3: Password strength ─────────────────────────────────────────────────
function evaluatePassword() {
  const pw = $('password').value
  const rules = {
    len: pw.length >= 8,
    up:  /[A-Z]/.test(pw),
    low: /[a-z]/.test(pw),
    num: /\d/.test(pw),
    spc: /[^A-Za-z0-9]/.test(pw),
  }
  const passed = Object.values(rules).filter(Boolean).length
  const colors = ['#e2e8f0', '#ef4444', '#f59e0b', '#f59e0b', '#84cc16', '#22c55e']
  for (let i = 1; i <= 5; i++) {
    const seg = $(`seg-${i}`)
    seg.style.background = i <= passed ? colors[passed] : '#e2e8f0'
  }
  Object.entries(rules).forEach(([key, met]) => {
    $(`rule-${key}`).classList.toggle('met', met)
  })

  $('strength').style.display = pw.length > 0 ? 'block' : 'none'
  return passed === 5
}

function updateConfirmState() {
  const pw = $('password').value
  const cf = $('password-confirm').value
  const mismatch = cf.length > 0 && pw !== cf
  $('pwd-mismatch').style.display = mismatch ? 'block' : 'none'
  $('password-confirm').classList.toggle('error', mismatch)
}

function evaluateForm() {
  const orgName = $('org-name').value.trim()
  const fullName = $('full-name').value.trim()
  const pw = $('password').value
  const cf = $('password-confirm').value
  const strong = evaluatePassword()
  const match = pw.length > 0 && pw === cf
  const ok = orgName.length >= 2 && fullName.length >= 2 && strong && match
  $('btn-create').disabled = !ok
  return ok
}

// ── Step 3: Create org ────────────────────────────────────────────────────────
async function handleCreateOrg() {
  if (!evaluateForm()) return
  showAlert(3, '')
  const btn = $('btn-create')
  setBtnLoading(btn, true)

  const payload = {
    name: $('full-name').value.trim(),
    email: _email,
    password: $('password').value,
    organizationName: $('org-name').value.trim(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    verifiedToken: _verifiedToken,
  }

  try {
    const data = await postJson('/auth/register-manager', payload)
    localStorage.setItem('shiftflow_token', data.token)
    localStorage.setItem('shiftflow_refresh_token', data.refreshToken)
    localStorage.setItem('shiftflow_user', JSON.stringify(data.user))
    localStorage.setItem('shiftflow_org', JSON.stringify(data.organization))

    showStep('success')
    setTimeout(() => { window.location.href = '/web/' }, 1200)
  } catch (e) {
    showAlert(3, e.message || 'Could not create your organization. Please try again.')
    setBtnLoading(btn, false, '<span>Create organization</span>')
  }
}

// ── Wiring ────────────────────────────────────────────────────────────────────
function wireEvents() {
  $('btn-send-otp').addEventListener('click', handleSendOtp)
  $('email').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('email-confirm').focus() })
  $('email-confirm').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSendOtp() })

  $('btn-verify-otp').addEventListener('click', handleVerifyOtp)
  $('otp-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleVerifyOtp() })
  $('otp-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6)
    if (e.target.value.length === 6) handleVerifyOtp()
  })
  $('btn-resend').addEventListener('click', handleResend)
  $('btn-change-email').addEventListener('click', () => {
    $('otp-code').value = ''
    showAlert(2, '')
    showStep('email')
    $('email').focus()
  })

  ;['org-name', 'full-name', 'password', 'password-confirm'].forEach(id => {
    $(id).addEventListener('input', evaluateForm)
  })
  $('password').addEventListener('input', updateConfirmState)
  $('password-confirm').addEventListener('input', updateConfirmState)
  $('btn-create').addEventListener('click', handleCreateOrg)
  $('password-confirm').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleCreateOrg() })

  function togglePw(inputId, btnId) {
    const input = $(inputId)
    const btn   = $(btnId)
    btn.addEventListener('click', () => {
      const isPw = input.type === 'password'
      input.type = isPw ? 'text' : 'password'
      btn.textContent = isPw ? 'Hide' : 'Show'
    })
  }
  togglePw('password', 'toggle-password')
  togglePw('password-confirm', 'toggle-password-confirm')
}

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  // If user is already logged in, send them to the web app
  if (localStorage.getItem('shiftflow_token')) {
    window.location.href = '/web/'
    return
  }
  wireEvents()
  showStep('email')
}

init()
