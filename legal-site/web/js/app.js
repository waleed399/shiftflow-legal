import { state } from './state.js'
import { getToken, getRefreshToken, clearSession, apiFetch } from './api.js'
import { getWeekStartOf } from './utils.js'
import { renderWeekLabel, renderDayTabs, loadShifts } from './shifts.js'
import { renderProfile, getEffectivePlan } from './profile.js'
import './modals.js' // registers window.openShiftModal and other modal handlers

async function init() {
  if (!getToken()) { window.location.href = '/app/'; return }

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

    document.getElementById('loading').style.display = 'none'
    document.getElementById('app').style.display = 'flex'
  } catch {
    window.location.href = '/app/'
  }
}

function renderSidebar() {
  const { currentUser, currentOrg } = state
  const initials = (currentUser.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  document.getElementById('sb-avatar').textContent = initials
  document.getElementById('sb-name').textContent = currentUser.name
  document.getElementById('sb-org').textContent = currentOrg.name

  const plan = getEffectivePlan(currentOrg)
  const planEl = document.getElementById('sb-plan')
  planEl.textContent = plan
  planEl.className = `plan-badge plan-${plan}`
}

function showView(view) {
  document.getElementById('view-shifts').style.display  = view === 'shifts'  ? 'flex' : 'none'
  document.getElementById('view-profile').style.display = view === 'profile' ? 'flex' : 'none'
  document.getElementById('nav-shifts').classList.toggle('active',  view === 'shifts')
  document.getElementById('nav-profile').classList.toggle('active', view === 'profile')
  if (view === 'profile') renderProfile()
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
