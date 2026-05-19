// auth-common.js — Shared helpers for unauthenticated pages
// (signup, login, forgot-password) and the onboarding wizard.
//
// Keeps these pages thin: each one imports what it needs, no duplication.
// ES module — load via <script type="module" src="...">.

export const API = 'https://shift-right-production.up.railway.app/api'

export const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/

// ── Friendly error mapping ───────────────────────────────────────────────────
// Backend `error` strings are NEVER shown to the user verbatim — they may leak
// internal details. Each page imports this map and translates by status / known
// substrings.

export const ERROR_MAP = {
  invalid_email:    'Please enter a valid email address.',
  email_mismatch:   'The two email addresses do not match.',
  email_in_use:     'An account with this email already exists. Try signing in instead.',
  missing_password: 'Please enter your password.',
  bad_credentials:  'That email or password didn\'t match. Please try again.',
  invalid_otp:      'That code is incorrect. Please try again.',
  expired_otp:      'This code has expired. Please request a new one.',
  weak_password:    'Your password doesn\'t meet our strength requirements.',
  rate_limited:     'Too many attempts. Please wait a few minutes and try again.',
  network:          'Could not connect. Please check your internet and try again.',
  generic:          'Something went wrong. Please try again.',
}

// Classify a backend response into a user-safe message. Login flows should
// prefer `classifyLoginError` (which returns generic for 400/401 to prevent
// email enumeration); flows where the user already proved ownership of an email
// (signup, forgot-password) can surface more specific messages.

export function classifyError(status, message) {
  const m = (message || '').toLowerCase()
  if (!status)                                       return ERROR_MAP.network
  if (status === 429)                                return ERROR_MAP.rate_limited
  if (m.includes('already') || m.includes('exists')) return ERROR_MAP.email_in_use
  if (m.includes('invalid code'))                    return ERROR_MAP.invalid_otp
  if (m.includes('expired'))                         return ERROR_MAP.expired_otp
  if (m.includes('password must'))                   return ERROR_MAP.weak_password
  if (m.includes('email'))                           return ERROR_MAP.invalid_email
  return ERROR_MAP.generic
}

// Login intentionally collapses 400/401 → generic "bad credentials" so an
// attacker can't probe to learn which emails are registered.
export function classifyLoginError(status) {
  if (!status)                                         return ERROR_MAP.network
  if (status === 429)                                  return ERROR_MAP.rate_limited
  if (status === 400 || status === 401)                return ERROR_MAP.bad_credentials
  return ERROR_MAP.generic
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

export function $(id) { return document.getElementById(id) }

export function showAlert(el, message) {
  if (!el) return
  if (!message) { el.style.display = 'none'; el.textContent = ''; return }
  el.textContent = message
  el.style.display = 'block'
}

export function setBtnLoading(btn, loading, labelHtml) {
  btn.disabled = !!loading
  if (loading) {
    btn.dataset.label = btn.innerHTML
    btn.innerHTML = '<div class="btn-spinner"></div>'
  } else {
    btn.innerHTML = labelHtml || btn.dataset.label || btn.innerHTML
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

// ── Network ──────────────────────────────────────────────────────────────────

// POST JSON to a relative API path. Throws an object shaped { friendly, status }
// on failure — callers should read `.friendly` to display, never `.message` or
// any backend-provided string.

export async function postJson(path, body, { errorClassifier = classifyError } = {}) {
  let res
  try {
    res = await fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw { friendly: ERROR_MAP.network }
  }
  let data = {}
  try { data = await res.json() } catch { /* tolerate empty bodies */ }
  if (!res.ok) {
    throw { friendly: errorClassifier(res.status, data.error), status: res.status }
  }
  return data
}

// Authenticated fetch. Adds Bearer token. On 401 clears session and redirects
// to /web/login.html. Used by onboarding (other authenticated pages live under
// /web/ and use the existing api.js module).

export async function apiFetch(path, opts = {}) {
  const token = getToken()
  if (!token) { window.location.href = '/web/login.html'; return null }
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  })
  if (res.status === 401) {
    clearSession()
    window.location.href = '/web/login.html'
    return null
  }
  return res
}

// ── Session / token storage ──────────────────────────────────────────────────
// Single point of truth for localStorage keys. If we ever migrate to httpOnly
// cookies, this is the only module that changes.

const TOKEN_KEY   = 'shiftflow_token'
const REFRESH_KEY = 'shiftflow_refresh_token'
const USER_KEY    = 'shiftflow_user'
const ORG_KEY     = 'shiftflow_org'

export function getToken()        { return localStorage.getItem(TOKEN_KEY) }
export function getRefreshToken() { return localStorage.getItem(REFRESH_KEY) }
export function getUser()         { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null') } catch { return null } }
export function getOrg()          { try { return JSON.parse(localStorage.getItem(ORG_KEY) || 'null') } catch { return null } }

export function saveSession({ token, refreshToken, user, organization }) {
  if (token)        localStorage.setItem(TOKEN_KEY,   token)
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken)
  if (user)         localStorage.setItem(USER_KEY,    JSON.stringify(user))
  if (organization) localStorage.setItem(ORG_KEY,     JSON.stringify(organization))
}

export function updateOrg(patch) {
  const current = getOrg() || {}
  const next = { ...current, ...patch }
  localStorage.setItem(ORG_KEY, JSON.stringify(next))
  return next
}

export function clearSession() {
  [TOKEN_KEY, REFRESH_KEY, USER_KEY, ORG_KEY].forEach((k) => localStorage.removeItem(k))
}

// ── Resend-code countdown ────────────────────────────────────────────────────
// Manages a "Resend in Ns" cooldown for OTP-based pages. Caller supplies the
// button element and a label callback that renders the current state.

export function createResendCooldown(btn, { seconds = 60, idleLabel = 'Resend code', activeLabel = (s) => `Resend code in ${s}s` } = {}) {
  let remaining = 0
  let interval = null

  function render() {
    if (remaining > 0) { btn.disabled = true;  btn.textContent = activeLabel(remaining) }
    else               { btn.disabled = false; btn.textContent = idleLabel }
  }

  return {
    start(s = seconds) {
      remaining = s
      render()
      if (interval) clearInterval(interval)
      interval = setInterval(() => {
        remaining--
        if (remaining <= 0) { clearInterval(interval); interval = null }
        render()
      }, 1000)
    },
    stop() { if (interval) { clearInterval(interval); interval = null } remaining = 0; render() },
    get remaining() { return remaining },
  }
}
