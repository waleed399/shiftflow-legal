#!/usr/bin/env node
// i18n integrity check. Run from anywhere:  node js/locales/check-i18n.mjs
//
// Reports three classes of problem and exits non-zero if any are found, so it
// can gate CI:
//   1. Locale parity  — keys present in en.js but missing from another locale
//                        (and vice-versa).
//   2. Source usage    — t('some.key') calls in the codebase whose key does not
//                        exist in en.js. This is what catches bugs like the
//                        "activity.pending" key that had no translation.
//   3. Placeholder gaps — a translation missing a {{var}} that its English
//                        counterpart uses (or introducing one en doesn't have).

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOCALES_DIR = __dirname
const JS_ROOT = join(__dirname, '..')           // legal-site/web/js
const WEB_ROOT = join(JS_ROOT, '..')            // legal-site/web

// ── Load locales ────────────────────────────────────────────────────────────
const en = (await import('./en.js')).default
const otherLocales = {}
for (const f of readdirSync(LOCALES_DIR)) {
  if (!f.endsWith('.js') || f === 'en.js') continue
  const code = f.replace(/\.js$/, '')
  otherLocales[code] = (await import(`./${f}`)).default
}

// ── Helpers ───────────────────────────────────────────────────────────────--
// Collect every leaf key path ("a.b.c") and its string value. Arrays are
// treated as leaves (e.g. months.short), matching how t() consumes them.
function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, path, out)
    else out.set(path, v)
  }
  return out
}

function placeholders(val) {
  if (typeof val !== 'string') return new Set()
  return new Set([...val.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]))
}

function walkFiles(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'vendor' || name === 'locales') continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walkFiles(full, exts, out)
    else if (exts.some(e => name.endsWith(e))) out.push(full)
  }
  return out
}

// ── 1 + 3. Locale parity & placeholder gaps ──────────────────────────────────
const enFlat = flatten(en)
const problems = []

for (const [code, loc] of Object.entries(otherLocales)) {
  const locFlat = flatten(loc)
  for (const key of enFlat.keys()) {
    if (!locFlat.has(key)) {
      problems.push(`[parity] "${key}" missing from ${code}.js`)
      continue
    }
    const enPh = placeholders(enFlat.get(key))
    const locPh = placeholders(locFlat.get(key))
    // Singular plural-variant keys (…One) legitimately drop the count in some
    // languages (Hebrew "one shift" reads naturally without the number), so we
    // don't require the placeholder there — but we still flag *extra* ones.
    const isSingularVariant = /One$/.test(key.split('.').pop())
    if (!isSingularVariant) {
      for (const p of enPh) if (!locPh.has(p)) problems.push(`[placeholder] ${code}.js "${key}" is missing {{${p}}}`)
    }
    for (const p of locPh) if (!enPh.has(p)) problems.push(`[placeholder] ${code}.js "${key}" has extra {{${p}}} (not in en)`)
  }
  for (const key of locFlat.keys()) {
    if (!enFlat.has(key)) problems.push(`[parity] "${key}" in ${code}.js has no en.js counterpart`)
  }
}

// ── 2. Source usage: every t('...') key must exist in en.js ───────────────────
// Matches t('a.b'), t("a.b"), and i18n-style attributes data-i18n="a.b".
// Dynamic keys (template literals / variables) can't be statically verified and
// are skipped — we only flag clearly-static string keys.
const T_CALL = /\bt\(\s*(['"])([\w.]+)\1/g
const I18N_ATTR = /data-i18n(?:-placeholder|-title|-aria)?\s*=\s*(['"])([\w.]+)\1/g

const usageProblems = []
const sourceFiles = [
  ...walkFiles(JS_ROOT, ['.js']),
  ...readdirSync(WEB_ROOT).filter(f => f.endsWith('.html')).map(f => join(WEB_ROOT, f)),
]

for (const file of sourceFiles) {
  const src = readFileSync(file, 'utf8')
  const rel = relative(WEB_ROOT, file)
  for (const re of [T_CALL, I18N_ATTR]) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(src))) {
      const key = m[2]
      // skip obvious non-keys (single words used as defaults are rare; require a dot)
      if (!key.includes('.')) continue
      if (!enFlat.has(key)) {
        const line = src.slice(0, m.index).split('\n').length
        usageProblems.push(`[usage] ${rel}:${line} uses "${key}" — not in en.js`)
      }
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────--
const all = [...problems, ...[...new Set(usageProblems)]]
if (all.length === 0) {
  console.log(`✓ i18n OK — ${enFlat.size} keys, locales: ${['en', ...Object.keys(otherLocales)].join(', ')}`)
  process.exit(0)
}
console.error(`✗ ${all.length} i18n issue(s):\n`)
for (const p of all) console.error('  ' + p)
process.exit(1)
