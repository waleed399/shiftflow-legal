import { apiFetch } from './api.js'

export const state = {
  currentUser: null,
  currentOrg: null,
  currentWeek: null,
  selectedDay: null,
  shiftsCache: {},
  orgWorkers: null,
  departments: null,
  activeShiftId: null,
  activeShiftData: null,
  pendingRequestCount: 0,
}

export async function ensureOrgWorkers() {
  if (state.orgWorkers) return state.orgWorkers
  const res = await apiFetch('/organization/members')
  if (!res?.ok) return []
  const data = await res.json()
  const all = Array.isArray(data) ? data : (data.members || data.users || [])
  state.orgWorkers = all.filter(w => w.role === 'WORKER').sort((a, b) => a.name.localeCompare(b.name))
  return state.orgWorkers
}
