import {
  $, apiFetch, showAlert, setBtnLoading, escapeHtml,
  ERROR_MAP,
  getToken, getUser, getOrg, updateOrg,
} from './auth-common.js'
import { initI18n, t } from './i18n.js'

// ── Constants ────────────────────────────────────────────────────────────────

const DAY_LABELS = new Proxy({}, { get: (_, code) => typeof code === 'string' ? t(`days.twoLetter.${code}`) : undefined })
const DAYS_FROM_MONDAY = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
const DAYS_FROM_SUNDAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

const PRESETS = [
  { id: 0, days: ['MON', 'TUE', 'WED', 'THU', 'FRI'],               weekStart: 'MONDAY' },
  { id: 1, days: ['SUN', 'MON', 'TUE', 'WED', 'THU'],               weekStart: 'SUNDAY' },
  { id: 2, days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], weekStart: 'MONDAY' },
  { id: 3, days: [],                                                weekStart: 'MONDAY' }, // custom
]

const TEMPLATE_COLORS = ['#1e40af', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#ec4899']

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  step: 1,
  activeDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
  weekStart: 'MONDAY',
  selectedPreset: 0,
  departments: [],
  templates: [],
  saving: false,
}

function uid() { return Math.random().toString(36).slice(2) }

function makeTemplate(defaultLocs = []) {
  return {
    key: uid(),
    name: '',
    startTime: '08:00',
    endTime: '16:00',
    locations: defaultLocs,
    workerCounts: Object.fromEntries(defaultLocs.map((l) => [l, 1])),
    color: TEMPLATE_COLORS[0],
  }
}

// ── Step navigation ──────────────────────────────────────────────────────────

function showStep(n) {
  state.step = n
  ;[
    ['step-week',        n === 1],
    ['step-departments', n === 2],
    ['step-success',     n === 3],
  ].forEach(([id, visible]) => $(id).classList.toggle('visible', visible))

  for (let i = 1; i <= 3; i++) {
    const el = $(`num-${i}`)
    el.classList.remove('active', 'done')
    if (i < n)   el.classList.add('done')
    if (i === n) el.classList.add('active')
  }
  for (let i = 1; i <= 2; i++) {
    $(`line-${i}`).classList.toggle('done', n > i)
  }
  window.scrollTo(0, 0)
}

// ── Step 1: Work Week ────────────────────────────────────────────────────────

function renderPresets() {
  document.querySelectorAll('#preset-row .chip').forEach((el) => {
    el.classList.toggle('active', state.selectedPreset === Number(el.dataset.preset))
  })
}

function renderDays() {
  const ordered = state.weekStart === 'SUNDAY' ? DAYS_FROM_SUNDAY : DAYS_FROM_MONDAY
  const row = $('day-row')
  row.innerHTML = ''
  ordered.forEach((day) => {
    const active = state.activeDays.includes(day)
    const el = document.createElement('div')
    el.className = 'day-item' + (active ? ' active' : '')
    el.innerHTML = `<span class="day-label">${DAY_LABELS[day]}</span><span class="day-circle"></span>`
    el.addEventListener('click', () => toggleDay(day))
    row.appendChild(el)
  })
}

function renderWeekStart() {
  document.querySelectorAll('.two-col .opt').forEach((el) => {
    el.classList.toggle('active', el.dataset.week === state.weekStart)
  })
}

function applyPreset(i) {
  const p = PRESETS[i]
  state.selectedPreset = i
  if (i !== 3) {
    state.activeDays = [...p.days]
    state.weekStart = p.weekStart
  }
  renderPresets(); renderDays(); renderWeekStart()
}

function toggleDay(day) {
  state.selectedPreset = 3 // custom
  state.activeDays = state.activeDays.includes(day)
    ? state.activeDays.filter((d) => d !== day)
    : [...state.activeDays, day]
  renderPresets(); renderDays()
}

function setWeekStart(start) {
  state.weekStart = start
  renderWeekStart(); renderDays()
}

function handleStep1Next() {
  if (state.activeDays.length === 0) {
    alert(t('onboarding.pickOneDay'))
    return
  }
  showStep(2)
}

// ── Step 2: Departments + Templates ──────────────────────────────────────────

function renderDepartments() {
  const row = $('dept-chips')
  row.innerHTML = ''
  row.style.display = state.departments.length === 0 ? 'none' : 'flex'

  state.departments.forEach((dept) => {
    const chip = document.createElement('div')
    chip.className = 'dept-chip'
    chip.innerHTML = `<span class="dept-chip-dot"></span><span>${escapeHtml(dept)}</span><button type="button">×</button>`
    chip.querySelector('button').addEventListener('click', () => removeDepartment(dept))
    row.appendChild(chip)
  })

  $('templates-section').style.display = state.departments.length > 0 ? 'block' : 'none'
}

function addDepartment(name) {
  const trimmed = (name || '').trim()
  if (!trimmed || state.departments.includes(trimmed)) return

  state.departments.push(trimmed)
  // Assign new department to any templates that have no location yet.
  state.templates.forEach((tpl) => {
    if (tpl.locations.length === 0) {
      tpl.locations = [trimmed]
      tpl.workerCounts = { ...tpl.workerCounts, [trimmed]: 1 }
    }
  })
  if (state.templates.length === 0) state.templates.push(makeTemplate([trimmed]))

  renderDepartments(); renderTemplates()
}

function removeDepartment(name) {
  state.departments = state.departments.filter((d) => d !== name)
  state.templates = state.templates.map((tpl) => {
    const wc = { ...tpl.workerCounts }
    delete wc[name]
    return { ...tpl, locations: tpl.locations.filter((l) => l !== name), workerCounts: wc }
  })
  renderDepartments(); renderTemplates()
}

function renderTemplates() {
  const list = $('templates-list')
  list.innerHTML = ''
  state.templates.forEach((tpl, idx) => list.appendChild(buildTemplateCard(tpl, idx)))
}

function buildTemplateCard(tpl, idx) {
  const wrap = document.createElement('div')
  wrap.className = 'tmpl'

  const colorRow = TEMPLATE_COLORS.map((c) => `
    <div class="color-dot${c === tpl.color ? ' active' : ''}" data-color="${c}" style="background:${c}"></div>
  `).join('')

  const locPills = state.departments.map((loc) => {
    const active = tpl.locations.includes(loc)
    return `<div class="loc-pill${active ? ' active' : ''}" data-loc="${escapeHtml(loc)}">${escapeHtml(loc)}</div>`
  }).join('')

  const workerRows = tpl.locations.map((loc) => `
    <div class="worker-row">
      <span class="loc-name">${escapeHtml(loc)}</span>
      <div class="counter">
        <button type="button" data-loc="${escapeHtml(loc)}" data-delta="-1">−</button>
        <span class="count">${tpl.workerCounts[loc] ?? 1}</span>
        <button type="button" data-loc="${escapeHtml(loc)}" data-delta="1">+</button>
      </div>
    </div>
  `).join('')

  wrap.innerHTML = `
    <div class="tmpl-header">
      <div class="color-row">${colorRow}</div>
      ${state.templates.length > 1 ? `<button type="button" class="remove-btn" title="${t('onboarding.removeTooltip')}">🗑</button>` : ''}
    </div>
    <input type="text" placeholder="${t('onboarding.shiftNamePlaceholder')}" value="${escapeHtml(tpl.name)}" data-field="name">
    <div class="time-row">
      <div><div class="time-label">${t('modals.startTime')}</div><input type="time" value="${tpl.startTime}" data-field="startTime"></div>
      <div><div class="time-label">${t('modals.endTime')}</div>  <input type="time" value="${tpl.endTime}"   data-field="endTime"></div>
    </div>
    ${state.departments.length > 0 ? `<div class="tmpl-locs">${locPills}</div>` : ''}
    ${tpl.locations.length > 0 ? `
      <div class="workers-section">
        <div class="lbl">${t('onboarding.workersPerDept')}</div>
        ${workerRows}
      </div>
    ` : ''}
  `

  wrap.querySelectorAll('.color-dot').forEach((el) => {
    el.addEventListener('click', () => { tpl.color = el.dataset.color; renderTemplates() })
  })
  wrap.querySelectorAll('input[data-field]').forEach((el) => {
    el.addEventListener('input', (e) => { tpl[e.target.dataset.field] = e.target.value })
  })
  wrap.querySelectorAll('.loc-pill').forEach((el) => {
    el.addEventListener('click', () => toggleTemplateLocation(tpl, el.dataset.loc))
  })
  wrap.querySelectorAll('.worker-row button').forEach((el) => {
    el.addEventListener('click', () => {
      const loc = el.dataset.loc
      const delta = Number(el.dataset.delta)
      tpl.workerCounts[loc] = Math.max(1, (tpl.workerCounts[loc] ?? 1) + delta)
      renderTemplates()
    })
  })
  const removeBtn = wrap.querySelector('.remove-btn')
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      state.templates.splice(idx, 1)
      renderTemplates()
    })
  }

  return wrap
}

function toggleTemplateLocation(tpl, loc) {
  const has = tpl.locations.includes(loc)
  tpl.locations = has ? tpl.locations.filter((l) => l !== loc) : [...tpl.locations, loc]
  const wc = { ...tpl.workerCounts }
  if (has) delete wc[loc]; else wc[loc] = 1
  tpl.workerCounts = wc
  renderTemplates()
}

function addTemplate() {
  const defaultLoc = state.departments.length === 1 ? [state.departments[0]] : []
  state.templates.push(makeTemplate(defaultLoc))
  renderTemplates()
}

// ── Save / Finish ────────────────────────────────────────────────────────────

async function saveOrgSettings() {
  const res = await apiFetch('/organization', {
    method: 'PATCH',
    body: JSON.stringify({
      workDays: state.activeDays,
      weekStartsOn: state.weekStart,
      onboardingComplete: true,
    }),
  })
  if (!res || !res.ok) throw new Error(t('onboarding.saveOrgFailed'))
  const data = await res.json().catch(() => null)
  updateOrg({
    workDays: state.activeDays,
    weekStartsOn: state.weekStart,
    onboardingComplete: true,
    ...(data || {}),
  })
}

function validateStep2() {
  if (state.departments.length === 0) return t('onboarding.addOneDept')
  for (const tpl of state.templates) {
    if (!tpl.name.trim())             return t('onboarding.shiftNeedName')
    if (!TIME_RE.test(tpl.startTime)) return t('onboarding.shiftNeedStart', { name: tpl.name })
    if (!TIME_RE.test(tpl.endTime))   return t('onboarding.shiftNeedEnd',   { name: tpl.name })
    if (tpl.locations.length === 0)   return t('onboarding.shiftNeedDept',  { name: tpl.name })
  }
  return null
}

async function createDepartmentApi(name) {
  const res = await apiFetch('/departments', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
  if (!res || !res.ok) throw new Error(t('onboarding.createDeptFailed', { name }))
  return res.json()
}

async function handleSkip() {
  if (state.saving) return
  state.saving = true
  showAlert($('alert-2'), '')
  try {
    await saveOrgSettings()
    if (state.departments.length > 0) {
      await Promise.all(state.departments.map(createDepartmentApi))
    }
    showStep(3)
    populateSuccess()
  } catch (e) {
    showAlert($('alert-2'), e.message || ERROR_MAP.generic)
  } finally {
    state.saving = false
  }
}

async function handleFinish() {
  if (state.saving) return
  const err = validateStep2()
  if (err) { showAlert($('alert-2'), err); return }
  showAlert($('alert-2'), '')

  const btn = $('btn-finish')
  setBtnLoading(btn, true)
  state.saving = true

  try {
    await saveOrgSettings()
    const createdDepts = await Promise.all(state.departments.map(createDepartmentApi))
    const idByName = new Map(createdDepts.filter(Boolean).map((d) => [d.name, d.id]))

    // Each template gets one shift-template per location it covers.
    const creations = state.templates.flatMap((tpl) =>
      tpl.locations.map((loc) => {
        const departmentId = idByName.get(loc)
        if (!departmentId) return Promise.resolve(null)
        return apiFetch('/shift-templates', {
          method: 'POST',
          body: JSON.stringify({
            name: tpl.name.trim(),
            startTime: tpl.startTime,
            endTime: tpl.endTime,
            departmentId,
            requiredWorkers: tpl.workerCounts[loc] ?? 1,
            color: tpl.color,
          }),
        })
      })
    )
    await Promise.all(creations)

    showStep(3)
    populateSuccess()
  } catch (e) {
    showAlert($('alert-2'), e.message || ERROR_MAP.generic)
  } finally {
    setBtnLoading(btn, false, `<span>${t('onboarding.finishSetup')}</span>`)
    state.saving = false
  }
}

// ── Step 3: Success ──────────────────────────────────────────────────────────

function populateSuccess() {
  const org = getOrg() || {}
  $('invite-code').textContent = org.inviteCode || '——'
}

async function copyInviteCode() {
  const code = $('invite-code').textContent.trim()
  if (!code || code === '——') return
  try {
    await navigator.clipboard.writeText(code)
    const btn = $('copy-btn')
    btn.classList.add('copied')
    $('copy-label').textContent = t('onboarding.copied')
    setTimeout(() => {
      btn.classList.remove('copied')
      $('copy-label').textContent = t('onboarding.copyInviteCode')
    }, 1800)
  } catch {
    // Selection fallback for browsers that block clipboard without permission.
    const range = document.createRange()
    range.selectNodeContents($('invite-code'))
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

function loadOrgIntoNav() {
  const org = getOrg()
  if (org && org.name) $('nav-org').innerHTML = `<strong>${escapeHtml(org.name)}</strong>`
}

function wireEvents() {
  document.querySelectorAll('#preset-row .chip').forEach((el) => {
    el.addEventListener('click', () => applyPreset(Number(el.dataset.preset)))
  })
  document.querySelectorAll('.two-col .opt').forEach((el) => {
    el.addEventListener('click', () => setWeekStart(el.dataset.week))
  })
  $('btn-next-1').addEventListener('click', handleStep1Next)

  $('add-dept-btn').addEventListener('click', () => {
    addDepartment($('dept-input').value)
    $('dept-input').value = ''
    $('dept-input').focus()
  })
  $('dept-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('add-dept-btn').click() }
  })
  $('add-tmpl-btn').addEventListener('click', addTemplate)
  $('btn-back-2').addEventListener('click', () => showStep(1))
  $('btn-finish').addEventListener('click', handleFinish)
  $('skip-link').addEventListener('click', handleSkip)

  $('copy-btn').addEventListener('click', copyInviteCode)
  $('go-dashboard').addEventListener('click', () => { window.location.href = '/web/' })
}

function init() {
  if (!getToken()) { window.location.href = '/web/login.html'; return }

  // Workers don't onboard the org — bounce them to the dashboard.
  const user = getUser()
  if (user && user.role && user.role !== 'MANAGER') {
    window.location.href = '/web/'
    return
  }

  initI18n()
  document.addEventListener('languagechange', () => { renderDays(); renderTemplates() })

  loadOrgIntoNav()
  wireEvents()
  renderPresets()
  renderDays()
  renderWeekStart()
  renderDepartments()
}

init()
