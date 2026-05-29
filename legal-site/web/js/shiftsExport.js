// Print / CSV / PDF export of the current day's or week's shifts.
//
// Public surface:
//   exportDay, exportWeek                — open browser print preview
//   downloadDayCSV, downloadWeekCSV      — direct CSV download
//   downloadDayPDF, downloadWeekPDF      — direct PDF download (via html2pdf)
//   toggleExportMenu                     — open/close the Export dropdown
//
// Localization:
//   All column headers, day/month names, status labels, and the print HTML's
//   <html dir="…"> follow the active app language (see getLanguage() / dir).

import { state } from './state.js'
import { toYMD, esc, showToast } from './utils.js'
import { t, getLanguage } from './i18n.js'
import { getDeptColor, getWeekViewDays } from './shifts.js'

// Map our internal language codes to BCP-47 tags used by Intl.DateTimeFormat.
// Add new entries here when adding a new app language.
const PRINT_LOCALES = { en: 'en-GB', he: 'he-IL' }

const STATUS_KEYS = {
  DRAFT:     'shifts.statusDraft',
  PUBLISHED: 'shifts.statusPublished',
  ACTIVE:    'shifts.statusActive',
  COMPLETED: 'shifts.statusCompleted',
  CANCELLED: 'shifts.statusCancelled',
}

// ── Export dropdown menu ──────────────────────────────────────────────────────

export function toggleExportMenu() {
  const dd = document.getElementById('export-dropdown')
  const btn = document.getElementById('btn-export')
  const isOpen = dd.classList.contains('open')
  dd.classList.toggle('open', !isOpen)
  btn.classList.toggle('active', !isOpen)
  if (!isOpen) {
    const close = (e) => {
      if (!document.getElementById('export-wrap')?.contains(e.target)) {
        dd.classList.remove('open')
        btn.classList.remove('active')
        document.removeEventListener('click', close)
      }
    }
    setTimeout(() => document.addEventListener('click', close), 0)
  }
}

function closeExportMenu() {
  document.getElementById('export-dropdown')?.classList.remove('open')
  document.getElementById('btn-export')?.classList.remove('active')
}

// ── Print (opens a new window with the print preview) ────────────────────────

export function exportDay() {
  closeExportMenu()
  const days = getDayExportData()
  if (!days.length) { showToast(t('shifts.exportNoShifts'), 'info'); return }
  openPrintWindow(days)
}

export function exportWeek() {
  closeExportMenu()
  const days = getWeekExportData()
  if (!days.length) { showToast(t('shifts.exportNoShifts'), 'info'); return }
  openPrintWindow(days)
}

function openPrintWindow(days) {
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(buildPrintHTML(days))
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 350)
}

// ── HTML builder (shared by print + PDF) ──────────────────────────────────────

function buildPrintHTML(days) {
  const orgName = esc(state.currentOrg?.name || 'ShiftRight')
  const isMulti = days.length > 1
  const lang    = getLanguage()
  const isRTL   = document.documentElement.dir === 'rtl'
  const dir     = isRTL ? 'rtl' : 'ltr'
  const locale  = PRINT_LOCALES[lang] || 'en-GB'

  // Intl gives the right "Wednesday, 28 May 2026" / "יום רביעי, 28 במאי 2026"
  // for whichever language is active, no hardcoded month/day arrays needed.
  const dateFmt = new Intl.DateTimeFormat(locale, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const fmtPrintDate = (d) => dateFmt.format(d)

  const daysHtml = days.map(({ date, shifts }) => {
    const deptMap = new Map()
    shifts.forEach((s) => {
      const id = s.department?.id || '_'
      if (!deptMap.has(id)) deptMap.set(id, { name: s.department?.name || '—', color: getDeptColor(id), shifts: [] })
      deptMap.get(id).shifts.push(s)
    })

    const deptsHtml = [...deptMap.values()].map((dept) => {
      const rows = dept.shifts.map((s) => {
        const time       = esc(`${s.startTime?.substring(0, 5) || '—'} – ${s.endTime?.substring(0, 5) || '—'}`)
        const workers    = (s.assignments || []).map((a) => esc(a.worker?.name || '')).filter(Boolean)
        const rawStatus  = typeof s.status === 'string' ? s.status : ''
        const statusCls  = esc(rawStatus.toLowerCase())
        const statusTxt  = esc(localizedStatus(rawStatus))
        const assigned   = s.assignments?.length || 0
        const required   = s.requiredWorkers || 0
        const coverColor = assigned === 0 ? '#dc2626' : assigned < required ? '#d97706' : '#059669'
        return `<tr>
          <td class="col-time">${time}</td>
          <td class="col-workers">${workers.length ? workers.join(', ') : `<span class="no-workers">${esc(t('shifts.printNoWorkers'))}</span>`}</td>
          <td class="col-coverage" style="color:${coverColor}">${assigned}/${required}</td>
          <td class="col-status status-${statusCls}">${statusTxt}</td>
        </tr>`
      }).join('')
      // border-inline-start instead of border-left so the colored band sits on
      // the leading edge of the label in both LTR and RTL.
      return `<div class="dept-block">
        <div class="dept-label" style="border-inline-start:4px solid ${dept.color};color:${dept.color}">${esc(dept.name)}</div>
        <table><thead><tr>
          <th>${esc(t('shifts.printColTime'))}</th>
          <th>${esc(t('shifts.printColWorkers'))}</th>
          <th>${esc(t('shifts.printColCoverage'))}</th>
          <th>${esc(t('shifts.printColStatus'))}</th>
        </tr></thead><tbody>${rows}</tbody></table>
      </div>`
    }).join('')

    return `<div class="day-section${isMulti ? ' day-section-multi' : ''}">
      <div class="day-heading">${esc(fmtPrintDate(date))}</div>
      ${deptsHtml}
    </div>`
  }).join('')

  const rangeLabel = esc(
    isMulti
      ? t('shifts.printWeekOf', { date: fmtPrintDate(days[0].date) })
      : fmtPrintDate(days[0].date),
  )

  const generatedBy = esc(t('shifts.printGeneratedBy'))
  const footerDate = esc(new Date().toLocaleDateString(locale))

  return `<!DOCTYPE html><html lang="${esc(lang)}" dir="${dir}"><head><meta charset="UTF-8">
<title>${esc(t('shifts.exportLabel'))} — ${orgName}</title>
<style>
  /* Direction is set on <html> so all logical properties (text-align: start,
     border-inline-start, flex direction) resolve correctly per language. */
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; overflow-x: hidden; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a2d4f; background: white; padding: 14px 18px; font-size: 12px; text-align: start; }
  .print-header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #1a2d4f; padding-bottom: 8px; margin-bottom: 14px; }
  .org-name { font-size: 18px; font-weight: 800; letter-spacing: -0.5px; }
  .org-name span { color: #bf1f3a; }
  .range-label { font-size: 11px; color: #64748b; }
  .day-section { margin-bottom: 18px; }
  .day-section-multi { page-break-inside: avoid; }
  .day-heading { font-size: 13px; font-weight: 700; color: #1a2d4f; margin-bottom: 8px; padding: 5px 9px; background: #f1f5f9; border-radius: 4px; }
  .dept-block { margin-bottom: 10px; }
  .dept-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; padding: 3px 9px; margin-bottom: 4px; }
  /* table-layout: fixed forces respect of the column widths below — without it,
     a long worker-names cell expands the table beyond the page, and html2canvas
     captures only what fits in the iframe (cropping the offside columns). */
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th { background: #1a2d4f; color: white; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 5px 8px; text-align: start; }
  td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; word-break: break-word; }
  tr:last-child td { border-bottom: none; }
  tr:nth-child(even) td { background: #f8fafc; }
  .col-time { white-space: nowrap; font-weight: 600; width: 90px; }
  .col-workers { width: auto; }
  .col-coverage { width: 60px; font-weight: 700; text-align: center; }
  .col-status { width: 80px; font-size: 10px; font-weight: 600; }
  .status-draft { color: #94a3b8; }
  .status-published { color: #1a2d4f; }
  .status-active { color: #d97706; }
  .status-completed { color: #059669; }
  .no-workers { color: #94a3b8; font-style: italic; }
  .print-footer { margin-top: 18px; border-top: 1px solid #e2e8f0; padding-top: 6px; font-size: 9px; color: #94a3b8; display: flex; justify-content: space-between; }
  @media print {
    body { padding: 0; }
    .day-section-multi { page-break-after: auto; }
  }
</style>
</head><body>
  <div class="print-header">
    <div class="org-name">Shift<span>Right</span> &nbsp;·&nbsp; ${orgName}</div>
    <div class="range-label">${rangeLabel}</div>
  </div>
  ${daysHtml}
  <div class="print-footer">
    <span>${generatedBy}</span>
    <span>${footerDate}</span>
  </div>
</body></html>`
}

// ── Data shaping (shared by CSV + PDF + print) ────────────────────────────────

function getDayExportData() {
  const key = toYMD(state.currentWeek)
  const all = state.shiftsCache[key] || []
  const selectedYMD = toYMD(state.selectedDay)
  const shifts = all
    .filter((s) => s.date.substring(0, 10) === selectedYMD && s.status !== 'CANCELLED')
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
  return shifts.length ? [{ date: state.selectedDay, shifts }] : []
}

function getWeekExportData() {
  const key = toYMD(state.currentWeek)
  const all = state.shiftsCache[key] || []
  return getWeekViewDays()
    .map(({ date, ymd }) => ({
      date,
      shifts: all.filter((s) => s.date.substring(0, 10) === ymd && s.status !== 'CANCELLED')
                 .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    }))
    .filter((d) => d.shifts.length > 0)
}

function localizedStatus(raw) {
  if (typeof raw !== 'string' || !raw) return ''
  const key = STATUS_KEYS[raw]
  return key ? t(key) : (raw.charAt(0) + raw.slice(1).toLowerCase())
}

// ── CSV ───────────────────────────────────────────────────────────────────────

function csvCell(v) {
  const s = (v ?? '').toString()
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function shiftHours(s) {
  // startTime / endTime are "HH:MM" or "HH:MM:SS" strings — work in minutes
  // since midnight, handle overnight shifts (end <= start), return decimal hours.
  const toMins = (str) => {
    if (!str) return null
    const [h, m] = str.split(':').map(Number)
    return h * 60 + (m || 0)
  }
  const a = toMins(s.startTime)
  const b = toMins(s.endTime)
  if (a == null || b == null) return ''
  const diff = b > a ? b - a : (24 * 60 - a) + b
  return (diff / 60).toFixed(1)
}

function buildCSV(days) {
  // Flat ledger: one row per shift. Day + Date together so the reader sees
  // "Wednesday 2026-05-28" without mental date math. Hours computed up-front
  // so the spreadsheet doesn't need a formula. Worker count and names kept
  // separate (count for sums, names for reference).
  const lang   = getLanguage()
  const locale = PRINT_LOCALES[lang] || 'en-GB'
  const dayFmt = new Intl.DateTimeFormat(locale, { weekday: 'long' })

  const header = [
    t('shifts.csvColDay'),
    t('shifts.csvColDate'),
    t('shifts.csvColDepartment'),
    t('shifts.csvColStart'),
    t('shifts.csvColEnd'),
    t('shifts.csvColHours'),
    t('shifts.csvColWorkersRequired'),
    t('shifts.csvColWorkersAssigned'),
    t('shifts.csvColWorkerNames'),
    t('shifts.csvColStatus'),
  ]
  const rows = [header.map(csvCell).join(',')]
  days.forEach(({ date, shifts }) => {
    const dayName = dayFmt.format(date)
    const dateStr = toYMD(date)
    shifts.forEach((s) => {
      const dept = s.department?.name || '—'
      const start = s.startTime?.substring(0, 5) || ''
      const end = s.endTime?.substring(0, 5) || ''
      const hours = shiftHours(s)
      const required = s.requiredWorkers ?? 0
      const assignments = s.assignments || []
      const assigned = assignments.length
      const names = assignments.map((a) => a.worker?.name || '').filter(Boolean).join(', ')
      const status = localizedStatus(s.status)
      rows.push(
        [dayName, dateStr, dept, start, end, hours, required, assigned, names, status]
          .map(csvCell)
          .join(','),
      )
    })
  })
  // BOM so Excel auto-detects UTF-8 (Hebrew names, etc.) without the import wizard.
  return '﻿' + rows.join('\r\n')
}

// ── Download plumbing ─────────────────────────────────────────────────────────

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function exportFilename(days, ext) {
  const orgSlug = (state.currentOrg?.name || 'ShiftRight').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'ShiftRight'
  if (days.length > 1) return `${orgSlug}_week-${toYMD(days[0].date)}.${ext}`
  return `${orgSlug}_${toYMD(days[0].date)}.${ext}`
}

function downloadCSVForDays(days) {
  const csv = buildCSV(days)
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), exportFilename(days, 'csv'))
}

function downloadPDFForDays(days) {
  if (typeof html2pdf === 'undefined') {
    showToast(t('shifts.pdfFailed'), 'error')
    return
  }

  // Render into a same-origin iframe rather than a stray <div>:
  //   - The iframe gets its own <body>, so the print HTML's `body { padding,
  //     font, background }` rules actually apply (a plain <div> ignores them).
  //   - html2canvas reliably captures iframe content; the previous off-screen
  //     `position:fixed; left:-10000px` trick produced blank PDFs because the
  //     element's bounding rect landed in negative space.
  //   - Keep the iframe in-flow but hidden via opacity/pointer-events; we set
  //     a real width so layout matches the eventual rendered size.
  const orientation = days.length > 1 ? 'landscape' : 'portrait'
  const widthPx = orientation === 'landscape' ? 1100 : 794

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  // The iframe's own document sets its <html dir="..."> based on the active
  // language, so we don't force LTR here anymore.
  iframe.style.cssText = [
    'position:fixed',
    'right:0',
    'bottom:0',
    `width:${widthPx}px`,
    'height:10px',
    'border:0',
    'opacity:0',
    'pointer-events:none',
    'z-index:-1',
  ].join(';')
  document.body.appendChild(iframe)

  const iDoc = iframe.contentDocument
  iDoc.open()
  iDoc.write(buildPrintHTML(days))
  iDoc.close()

  // Size the iframe to its actual content. html2canvas captures from the
  // iframe's body, but if the iframe's own height is smaller than the body,
  // some engines crop the captured canvas. Resize after layout settles.
  const fitIframeToContent = () => {
    const h = Math.max(
      iDoc.body?.scrollHeight ?? 0,
      iDoc.documentElement?.scrollHeight ?? 0,
      300,
    )
    iframe.style.height = h + 'px'
  }

  // Allow one paint cycle for fonts / layout before snapshotting.
  setTimeout(() => {
    fitIframeToContent()
    // Pin html2canvas to the iframe's content width/height so it doesn't crop
    // to the parent window's viewport or fall back to scrollable-region heuristics.
    const captureWidth = iDoc.documentElement.scrollWidth || widthPx
    const captureHeight = iDoc.documentElement.scrollHeight
    html2pdf()
      .set({
        margin: [8, 8, 8, 8],
        filename: exportFilename(days, 'pdf'),
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          width: captureWidth,
          height: captureHeight,
          windowWidth: captureWidth,
          windowHeight: captureHeight,
          letterRendering: true,
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation, compress: true },
        pagebreak: { mode: ['css', 'legacy'], avoid: '.day-section-multi' },
      })
      .from(iDoc.body)
      .save()
      .catch((err) => {
        console.error('PDF export failed', err)
        showToast(t('shifts.pdfFailed'), 'error')
      })
      .finally(() => {
        iframe.remove()
      })
  }, 60)
}

// ── Public download handlers (wired to window.* in shifts.js) ─────────────────

export function downloadDayCSV() {
  closeExportMenu()
  const days = getDayExportData()
  if (!days.length) { showToast(t('shifts.exportNoShifts'), 'info'); return }
  downloadCSVForDays(days)
}

export function downloadWeekCSV() {
  closeExportMenu()
  const days = getWeekExportData()
  if (!days.length) { showToast(t('shifts.exportNoShifts'), 'info'); return }
  downloadCSVForDays(days)
}

export function downloadDayPDF() {
  closeExportMenu()
  const days = getDayExportData()
  if (!days.length) { showToast(t('shifts.exportNoShifts'), 'info'); return }
  downloadPDFForDays(days)
}

export function downloadWeekPDF() {
  closeExportMenu()
  const days = getWeekExportData()
  if (!days.length) { showToast(t('shifts.exportNoShifts'), 'info'); return }
  downloadPDFForDays(days)
}
