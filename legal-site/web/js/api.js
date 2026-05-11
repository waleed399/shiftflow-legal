const API = 'https://shift-right-production.up.railway.app/api'

export function getToken()        { return localStorage.getItem('shiftflow_token') }
export function getRefreshToken() { return localStorage.getItem('shiftflow_refresh_token') }

export function saveTokens(token, refresh) {
  localStorage.setItem('shiftflow_token', token)
  localStorage.setItem('shiftflow_refresh_token', refresh)
}

export function clearSession() {
  ['shiftflow_token', 'shiftflow_refresh_token', 'shiftflow_user', 'shiftflow_org'].forEach(k => localStorage.removeItem(k))
}

let _retrying = false

export async function apiFetch(path, opts = {}) {
  const token = getToken()
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...(opts.headers || {}) },
  })

  if (res.status === 401 && !_retrying) {
    _retrying = true
    const refresh = getRefreshToken()
    if (refresh) {
      const rRes = await fetch(API + '/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refresh }),
      })
      if (rRes.ok) {
        const { token: t, refreshToken: r } = await rRes.json()
        saveTokens(t, r)
        _retrying = false
        return apiFetch(path, opts)
      }
    }
    _retrying = false
    clearSession()
    window.location.href = '/app/'
    return null
  }

  _retrying = false
  return res
}
