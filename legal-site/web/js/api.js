import { API } from './config.js'

export function getToken()        { return localStorage.getItem('shiftflow_token') }
export function getRefreshToken() { return localStorage.getItem('shiftflow_refresh_token') }

export function saveTokens(token, refresh) {
  localStorage.setItem('shiftflow_token', token)
  localStorage.setItem('shiftflow_refresh_token', refresh)
}

export function clearSession() {
  ['shiftflow_token', 'shiftflow_refresh_token', 'shiftflow_user', 'shiftflow_org'].forEach(k => localStorage.removeItem(k))
}

// Single in-flight refresh shared by every concurrent 401 — same pattern as
// the mobile app's services/api.ts refreshPromise. Without this, requests that
// 401 while a refresh is already running would fail instead of waiting for it.
let _refreshPromise = null

function refreshSession() {
  if (!_refreshPromise) {
    _refreshPromise = (async () => {
      const refresh = getRefreshToken()
      if (!refresh) return false
      const res = await fetch(API + '/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refresh }),
      })
      if (!res.ok) return false
      const { token, refreshToken } = await res.json()
      saveTokens(token, refreshToken)
      return true
    })()
      .catch(() => false)
      .finally(() => { _refreshPromise = null })
  }
  return _refreshPromise
}

export async function apiFetch(path, opts = {}, _isRetry = false) {
  const token = getToken()
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...(opts.headers || {}) },
  })

  if (res.status === 401 && !_isRetry) {
    const refreshed = await refreshSession()
    if (refreshed) return apiFetch(path, opts, true)
    clearSession()
    window.location.href = '/app/'
    return null
  }

  return res
}
