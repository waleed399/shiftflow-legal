// roles.js — who is allowed to see what.
//
// The API keeps the pre-split wire format for backwards compatibility: an
// account owner is reported as role "MANAGER" so older clients keep working.
// The real role arrives in `accessLevel`:
//
//   OWNER   — runs the organisation: billing, org settings, departments
//   MANAGER — department-scoped manager: schedules and approves for their own
//             departments only; the API filters their data server-side
//   WORKER  — no management surface at all
//
// Anything owner-only must branch on isOwner(), never on role === 'MANAGER',
// otherwise department managers are shown controls that the API will refuse.

export function isOwner(user) {
  if (!user) return false
  // Fall back to the old rule for sessions cached before accessLevel existed:
  // back then every MANAGER was the org's sole owner.
  return user.accessLevel ? user.accessLevel === 'OWNER' : user.role === 'MANAGER'
}

// Any management-level user (owner or department manager).
export function isManagement(user) {
  if (!user) return false
  return user.accessLevel ? user.accessLevel !== 'WORKER' : user.role === 'MANAGER'
}

export function isWorker(user) {
  return !!user && !isManagement(user)
}
