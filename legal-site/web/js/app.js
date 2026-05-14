import { state } from './state.js'
import { getToken, getRefreshToken, clearSession, apiFetch } from './api.js'
import { getWeekStartOf, getInitials } from './utils.js'
import { renderWeekLabel, renderDayTabs, loadShifts } from './shifts.js'
import { renderProfile, getEffectivePlan } from './profile.js'
import './modals.js' // registers window.openShiftModal and other modal handlers
import './createShift.js' // registers window.openCreateShiftModal and submit handlers
import { renderRequests, loadPendingCount } from './requests.js'
import { renderWorkers } from './workers.js'

async function init() {
  if (!getToken()) { window.location.href = '/app/'; return }

  // Detect return from Lemon Squeezy checkout
  const params = new URLSearchParams(window.location.search)
  const returningFromPayment = params.get('payment') === 'success'
  if (returningFromPayment) {
    history.replaceState({}, '', window.location.pathname)
  }

  try {
    const res = await apiFetch('/auth/me')
    if (!res) return
    const me = await res.json()

    state.currentUser = me
    state.currentOrg  = me.organization

    localStorage.setItem('shiftflow_user', JSON.stringify(state.currentUser))
    localStorage.setItem('shiftflow_org',  JSON.stringify(state.currentOrg))

    renderSidebar()

    const today = new Date()
    state.currentWeek = getWeekStartOf(today, state.currentOrg?.weekStartsOn)
    state.selectedDay = today

    renderDayTabs()
    renderWeekLabel()
    await loadShifts()

    const loadingEl = document.getElementById('loading')
    document.getElementById('app').style.display = 'flex'
    loadingEl.classList.add('loading-exit')
    setTimeout(() => { loadingEl.style.display = 'none' }, 400)

    loadPendingCount() // non-blocking badge update

    if (returningFromPayment) {
      showView('profile')
      showToast('🎉 Payment successful! Your plan has been upgraded.')
      // Webhook is usually processed before LS redirects, but poll a few times
      // in case of slight delay so the sidebar badge and profile update reliably.
      pollPlanUpdate(4, 2000)
    }
  } catch {
    window.location.href = '/app/'
  }
}

async function pollPlanUpdate(attemptsLeft, delayMs) {
  if (attemptsLeft <= 0) return
  await new Promise(r => setTimeout(r, delayMs))
  try {
    const res = await apiFetch('/billing/plan')
    if (!res) return
    const info = await res.json()
    if (info.plan && info.plan !== state.currentOrg?.plan) {
      state.currentOrg = { ...state.currentOrg, plan: info.plan }
      localStorage.setItem('shiftflow_org', JSON.stringify(state.currentOrg))
      renderSidebar()
      const profileView = document.getElementById('view-profile')
      if (profileView && profileView.style.display !== 'none') renderProfile()
      return
    }
  } catch {}
  pollPlanUpdate(attemptsLeft - 1, delayMs * 1.5)
}

function showToast(msg) {
  const toast = document.createElement('div')
  toast.className = 'app-toast'
  toast.textContent = msg
  document.body.appendChild(toast)
  requestAnimationFrame(() => toast.classList.add('app-toast-visible'))
  setTimeout(() => {
    toast.classList.remove('app-toast-visible')
    setTimeout(() => toast.remove(), 400)
  }, 4000)
}

function renderSidebar() {
  const { currentUser, currentOrg } = state
  const initials = getInitials(currentUser.name)
  const sbAvatar = document.getElementById('sb-avatar')
  sbAvatar.textContent = initials
  if (currentUser.avatarUrl) {
    const img = document.createElement('img')
    img.alt = ''
    img.onload = () => { sbAvatar.textContent = ''; sbAvatar.appendChild(img) }
    img.onerror = () => { /* keep initials */ }
    img.src = currentUser.avatarUrl
  }
  document.getElementById('sb-name').textContent = currentUser.name
  document.getElementById('sb-org').textContent = currentOrg.name

  const plan = getEffectivePlan(currentOrg)
  const planEl = document.getElementById('sb-plan')
  planEl.textContent = plan
  planEl.className = `plan-badge plan-${plan}`
}

const ON_ENTER = { profile: renderProfile, requests: renderRequests, workers: renderWorkers }

function showView(view) {
  for (const v of ['shifts', 'profile', 'requests', 'workers']) {
    document.getElementById(`view-${v}`).style.display = v === view ? 'flex' : 'none'
    document.getElementById(`nav-${v}`).classList.toggle('active', v === view)
  }
  const el = document.getElementById(`view-${view}`)
  el.classList.remove('view-enter')
  void el.offsetWidth
  el.classList.add('view-enter')
  ON_ENTER[view]?.()
}

function signOut() {
  const refresh = getRefreshToken()
  if (refresh) {
    fetch('https://shift-right-production.up.railway.app/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    }).catch(() => {})
  }
  clearSession()
  window.location.href = '/app/'
}

window.showView = showView
window.signOut  = signOut

init()
