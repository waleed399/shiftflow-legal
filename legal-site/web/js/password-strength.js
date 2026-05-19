// password-strength.js — Single source of truth for the password strength meter.
//
// Mirrors the backend `strongPassword` validator in Backend/src/schemas/auth.schemas.ts
// — keep them in sync. ES module — imported by signup.js and forgot-password.js.

const RULES = [
  { key: 'len', test: (pw) => pw.length >= 8 },
  { key: 'up',  test: (pw) => /[A-Z]/.test(pw) },
  { key: 'low', test: (pw) => /[a-z]/.test(pw) },
  { key: 'num', test: (pw) => /\d/.test(pw) },
  { key: 'spc', test: (pw) => /[^A-Za-z0-9]/.test(pw) },
]

const STRENGTH_COLORS = ['#e2e8f0', '#ef4444', '#f59e0b', '#f59e0b', '#84cc16', '#22c55e']

// Evaluate a password string. Returns:
//   { passed: number 0–5, rules: { len: boolean, up, low, num, spc }, allOk: boolean }
export function evaluatePassword(pw) {
  const rules = Object.fromEntries(RULES.map((r) => [r.key, r.test(pw)]))
  const passed = Object.values(rules).filter(Boolean).length
  return { passed, rules, allOk: passed === RULES.length }
}

// Update the visual meter for a given password. The host page must contain the
// expected DOM: a wrapping element with id `strength`, segments with ids
// `seg-1`..`seg-5`, and rule rows with ids `rule-len`, `rule-up`, etc.
export function renderStrengthMeter(pw) {
  const { passed, rules } = evaluatePassword(pw)
  const root = document.getElementById('strength')
  if (!root) return { passed, rules, allOk: passed === 5 }

  root.style.display = pw.length > 0 ? 'block' : 'none'

  for (let i = 1; i <= 5; i++) {
    const seg = document.getElementById(`seg-${i}`)
    if (seg) seg.style.background = i <= passed ? STRENGTH_COLORS[passed] : '#e2e8f0'
  }
  Object.entries(rules).forEach(([key, met]) => {
    const row = document.getElementById(`rule-${key}`)
    if (row) row.classList.toggle('met', met)
  })

  return { passed, rules, allOk: passed === 5 }
}

// Wire the eye-toggle on a password field. Mutates the input's `type` between
// "password" and "text"; updates the button label.
export function wirePasswordToggle(inputId, btnId) {
  const input = document.getElementById(inputId)
  const btn   = document.getElementById(btnId)
  if (!input || !btn) return
  btn.addEventListener('click', () => {
    const isPw = input.type === 'password'
    input.type = isPw ? 'text' : 'password'
    btn.textContent = isPw ? 'Hide' : 'Show'
  })
}
