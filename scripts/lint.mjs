#!/usr/bin/env node
// DevOps lint: repo hygiene checks with zero new dependencies.
// Fails on: relative parent imports in src/, literal secrets in the
// Asterisk fixture, committed raw captures/certs/env files.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
let failures = 0;
const fail = (msg) => { failures += 1; console.error(`lint: ${msg}`); };

// 1. No relative parent imports in src/ (enforce @/ aliases).
let srcFiles = [];
try {
  srcFiles = execSync('git ls-files "src/**/*.ts" "src/**/*.tsx"', { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
} catch { srcFiles = []; }
for (const f of srcFiles) {
  const content = readFileSync(path.join(ROOT, f), 'utf8');
  const hits = content.split('\n').filter((l) => /from\s+['"]\.\.\//.test(l) || /import\s*\(\s*['"]\.\.\//.test(l));
  if (hits.length) fail(`${f}: relative parent import(s): ${hits[0].trim()}`);
}

// 2. Fixture: passwords only via ${DAAD_TEST_PASSWORD_*} placeholders.
const pjsip = path.join(ROOT, 'docker/asterisk/config/pjsip.conf');
if (existsSync(pjsip)) {
  const lines = readFileSync(pjsip, 'utf8').split('\n');
  for (const l of lines) {
    if (/^\s*password\s*=/.test(l) && !l.includes('${DAAD_TEST_PASSWORD')) fail(`pjsip.conf literal secret: ${l.trim()}`);
  }
}
const envExample = path.join(ROOT, 'docker/asterisk/.env.example');
if (existsSync(envExample) && !readFileSync(envExample, 'utf8').includes('changeme')) {
  fail('.env.example must contain placeholder values only');
}

// 3. No committed raw captures / certs / .env.
const banned = [
  'docker/asterisk/.env',
  'docker/asterisk/certs/asterisk.key',
  'docker/asterisk/certs/asterisk.crt',
];
for (const b of banned) if (existsSync(path.join(ROOT, b))) fail(`must not commit ${b}`);
const capDir = path.join(ROOT, 'docker/asterisk/captures');
if (existsSync(capDir)) {
  for (const f of readdirSync(capDir)) {
    if (/\.pcap(ng)?$/.test(f) || (/\.log$/.test(f) && !f.endsWith('.sanitized.log'))) {
      fail(`captures/${f}: only *.sanitized.log may be committed`);
    }
  }
}

// 4. Legacy sip.js fallback is gated behind VITE_DEV_LEGACY_WS=1 (default off).
// The default desktop path (App/context/components) must never import it.
const legacyImporters = [];
for (const f of srcFiles) {
  if (
    f.startsWith('src/components/') ||
    f.startsWith('src/context/') ||
    f === 'src/App.tsx' ||
    f === 'src/main.tsx'
  ) {
    const content = readFileSync(path.join(ROOT, f), 'utf8');
    if (/sipService|services\/sipService/.test(content)) legacyImporters.push(f);
  }
}
for (const f of legacyImporters) fail(`${f}: default path must not import legacy sipService (use nativeSipClient)`);
const svcSrc = existsSync(path.join(ROOT, 'src/services/sipService.ts'))
  ? readFileSync(path.join(ROOT, 'src/services/sipService.ts'), 'utf8')
  : '';
if (svcSrc && /traceSip\s*:\s*true/.test(svcSrc)) fail('src/services/sipService.ts: traceSip must be false (no raw SIP traces)');
if (svcSrc && !/DEV_LEGACY_WS/.test(svcSrc)) fail('src/services/sipService.ts: must be gated behind DEV_LEGACY_WS flag');
if (process.env.VITE_DEV_LEGACY_WS === '1' || process.env.DEV_LEGACY_WS === '1') {
  fail('DEV_LEGACY_WS must not be enabled in prod/CI builds (legacy sip.js fallback)');
}
for (const envFile of ['.env.production', '.env']) {
  const p = path.join(ROOT, envFile);
  if (existsSync(p)) {
    const c = readFileSync(p, 'utf8');
    if (/^\s*(VITE_)?DEV_LEGACY_WS\s*=\s*1/m.test(c)) fail(`${envFile}: must not enable DEV_LEGACY_WS`);
  }
}

if (failures) { console.error(`lint: ${failures} failure(s)`); process.exit(1); }
console.log('lint: ok');
