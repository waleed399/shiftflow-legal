import { apiFetch } from './api.js'
import { isSchedulable } from './roles.js'

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
  // Everyone assignable to a shift — workers plus department managers, who are
  // working supervisors. The owner is excluded (see isSchedulable).
  state.orgWorkers = all.filter(isSchedulable).sort((a, b) => a.name.localeCompare(b.name))
  return state.orgWorkers
}
