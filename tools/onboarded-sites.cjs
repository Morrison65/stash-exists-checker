#!/usr/bin/env node
// Every site set up by hand with the setup guide must be built in, so a fresh install supports it out of the box (a
// profile lives only in that browser's Tampermonkey storage). Reads the local userscript logs (docker-workspace/docs/
// userscripts.md: <workspace>/logs/userscripts/YYYY-MM-DD.jsonl, 30 days kept) and lists every host this script ran on
// with a profile but no built-in adapter ("started" with site "profile:<host>"), or whose profile was saved or exported.
// Fails when one is not built in (siteFor of the current source, no profiles). Hosts where the guide was only opened or
// picked from are listed as notes. Without local logs (CI, a new machine) it passes with a note.
//   node tools/onboarded-sites.cjs [logs dir]     (default: USERSCRIPT_LOGS, else ../logs/userscripts)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const dir = process.argv[2] || process.env.USERSCRIPT_LOGS || path.join(root, '..', 'logs', 'userscripts');
const { siteFor } = require(path.join(root, 'stash-exists-checker.user.js'));

if (!fs.existsSync(dir)) { console.log('Onboarded sites: no local logs at ' + dir + '; skipped.'); process.exit(0); }
const hosts = new Map();
const entry = (h) => { if (!hosts.has(h)) hosts.set(h, { profile: false, picks: 0, events: new Set(), last: '', versions: new Set() }); return hosts.get(h); };
for (const f of fs.readdirSync(dir).filter((x) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(x)).sort()) {
  for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
    if (!line.includes('"stash-exists-checker"')) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.script !== 'stash-exists-checker') continue;
    const d = e.data || {};
    let host = null, profile = false, pick = false;
    if (e.event === 'started' && typeof d.site === 'string' && d.site.startsWith('profile:')) { host = d.site.slice(8); profile = true; }
    else if (e.event === 'site profile saved' || e.event === 'site profile exported') { host = d.host; profile = true; }
    else if (e.event === 'site onboarding') { host = d.host; pick = / picked$/.test(e.msg || ''); }
    if (!host) continue;
    const h = entry(String(host).toLowerCase());
    h.profile = h.profile || profile;
    if (pick) h.picks++;
    h.events.add(e.event + (e.event === 'started' ? ' (' + d.site + ')' : ''));
    if ((e.received || '') > h.last) h.last = e.received || '';
    if (e.version) h.versions.add(e.version);
  }
}
const missing = [], notes = [];
for (const [host, h] of [...hosts].sort()) {
  if (siteFor(host)) continue;
  const line = host + ' (last ' + h.last.slice(0, 10) + ', script ' + [...h.versions].join('/') + '; ' + [...h.events].join(', ') + ')';
  (h.profile ? missing : notes).push(line + (h.profile ? '' : '; ' + h.picks + ' picks, no profile saved'));
}
const builtIn = [...hosts.keys()].filter((h) => siteFor(h)).length;
console.log('Onboarded sites in ' + dir + ': ' + hosts.size + ' hosts, ' + builtIn + ' built in.');
for (const n of notes) console.log('  note: guide used, not built in: ' + n);
if (missing.length) {
  console.error('Not built in, but set up by hand (a new install would not support them): ');
  for (const m of missing) console.error('  ' + m);
  console.error('Write an adapter from their "site onboarding" / "site profile exported" log entries (AGENTS.md).');
  process.exit(1);
}
