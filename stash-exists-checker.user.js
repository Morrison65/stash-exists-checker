// ==UserScript==
// @name         Stash Exists Checker - Reptyle
// @namespace    local.stash-exists-checker
// @version      2.1.0
// @description  Shows whether the current Reptyle video exists in local Stash (localhost:9999) with a badge next to the title and on listing cards.
// @match        https://app.reptyle.com/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @noframes
// ==/UserScript==

/* global module:readonly */
(() => {
  'use strict';
  const VERSION = '2.1.0';
  const STASH = 'http://localhost:9999';
  const GQL = STASH + '/graphql';
  const QT = 'query($sf:SceneFilterType){findScenes(filter:{per_page:5},scene_filter:$sf){count scenes{id title urls}}}';
  const QF = 'query($q:String!){findScenes(filter:{q:$q,per_page:10}){count scenes{id title urls}}}';
  const cache = new Map();
  const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const canonUrl = (u) => (u || '').split('?')[0].split('#')[0].trim();
  // Structured log sink shared by the local userscripts (docker-workspace/docs/userscripts.md): entries are batched to
  // the collector on localhost:7790 through GM_xmlhttpRequest. The buffer is memory-only; while the collector is down
  // up to 500 entries wait and are retried with backoff.
  const LOG_URL = 'http://localhost:7790/v1/logs';
  function logPage(href) { try { const u = new URL(href); return u.host + u.pathname; } catch (e) { return ''; } }
  function gmLogSend(entries, done) {
    if (typeof GM_xmlhttpRequest !== 'function') { done(true); return; }
    try {
      GM_xmlhttpRequest({
        method: 'POST', url: LOG_URL, timeout: 5000, data: JSON.stringify({ entries }),
        headers: { 'Content-Type': 'application/json', 'X-Userscript-Log': '1' },
        // A rejected batch (4xx) is dropped; only an unreachable or busy collector is retried.
        onload: (r) => done(r.status < 500 && r.status !== 408 && r.status !== 429),
        onerror: () => done(false), ontimeout: () => done(false),
      });
    } catch (e) { done(false); }
  }
  function createLogSink(opts) {
    const send = opts.send || gmLogSend, page = opts.page || (() => logPage(location.href));
    const session = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    let queue = [], seq = 0, timer = 0, busy = false, failures = 0;
    function schedule(ms) { if (!timer) timer = setTimeout(flush, ms); }
    function flush() {
      if (timer) { clearTimeout(timer); timer = 0; }
      if (busy || !queue.length) return;
      const batch = queue.splice(0, 200);
      busy = true;
      send(batch, (ok) => {
        busy = false;
        if (ok) { failures = 0; if (queue.length) schedule(0); return; }
        queue = batch.concat(queue).slice(-500);
        failures++;
        schedule(Math.min(300000, 5000 * 2 ** (failures - 1)));
      });
    }
    function log(level, event, msg, data) {
      const entry = { ts: new Date().toISOString(), script: opts.script, version: opts.version, level, event: String(event), page: page(), session, seq: ++seq };
      if (msg !== undefined && msg !== null && msg !== '') entry.msg = String(msg);
      if (data !== undefined) entry.data = data;
      queue.push(entry);
      if (queue.length > 500) queue.splice(0, queue.length - 500);
      // A full batch goes at once, except while backing off from a down collector.
      if (queue.length >= 50 && !failures) flush(); else schedule(2000);
    }
    return { log, flush, session, pending: () => queue.length };
  }
  // Node unit tests load the pure helpers only; nothing below touches the page.
  if (typeof module === 'object' && module.exports) {
    module.exports = { VERSION, norm, canonUrl, lookupVideo, logPage, createLogSink };
    return;
  }
  const sink = createLogSink({ script: 'stash-exists-checker', version: VERSION });
  const log = sink.log;
  window.addEventListener('pagehide', () => sink.flush());
  log('info', 'started');
  const css = '#stash-exists-badge{display:inline-block;margin-left:12px;padding:4px 12px;border-radius:999px;font-size:13px;font-weight:800;vertical-align:middle;color:#fff;text-decoration:none;cursor:pointer}.stash-yes{background:#16a34a}.stash-no{background:#52525b}.stash-err{background:#b45309}.stash-card-dot{position:absolute;top:6px;left:6px;z-index:5;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:800;color:#fff;background:#52525b;pointer-events:none}.stash-card-dot.stash-yes{background:#16a34a}';
  GM_addStyle(css);
  function postGql(query, variables) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: GQL,
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ query, variables }),
        timeout: 15000,
        onload: (r) => {
          if (r.status < 200 || r.status >= 300) { reject(new Error('Stash HTTP ' + r.status)); return; }
          try { resolve(JSON.parse(r.responseText)); } catch (e) { reject(e); }
        },
        onerror: () => reject(new Error('network error')),
        ontimeout: () => reject(new Error('timeout')),
      });
    });
  }
  async function lookupVideo(opts) {
    const title = (opts && opts.title || '').trim();
    const url = canonUrl(opts && opts.url);
    const key = norm(title) + ' || ' + url;
    if (cache.has(key)) return cache.get(key);
    const p = (async () => {
      try {
        const jobs = [];
        if (title) jobs.push(postGql(QT, { sf: { title: { value: title, modifier: 'EQUALS' } } }).then((d) => ({ k: 't', d })).catch((e) => ({ k: 't', err: e })));
        if (url) jobs.push(postGql(QT, { sf: { url: { value: url, modifier: 'INCLUDES' } } }).then((d) => ({ k: 'u', d })).catch((e) => ({ k: 'u', err: e })));
        const out = await Promise.all(jobs);
        // Every query failed: report Stash as unreachable instead of a false "Not in Stash".
        if (out.length && out.every((r) => r.err)) throw out[0].err;
        let byTitle = null, byUrl = null;
        for (const r of out) {
          const scenes = (r.d && r.d.data && r.d.data.findScenes && r.d.data.findScenes.scenes) || [];
          const count = (r.d && r.d.data && r.d.data.findScenes && r.d.data.findScenes.count) || 0;
          if (r.k === 't') { const exact = scenes.find((s) => norm(s.title) === norm(title)) || null; byTitle = { count, exact, scenes: scenes.slice(0, 5) }; }
          else { const exact = scenes.find((s) => (s.urls || []).some((x) => { const c = x.split('?')[0].split('#')[0]; return c.includes(url) || url.includes(c); })) || scenes[0] || null; byUrl = { count, exact, scenes: scenes.slice(0, 5) }; }
        }
        let similar = 0;
        if (!byTitle?.exact && !byUrl?.exact && title) { try { const fb = await postGql(QF, { q: title }); similar = (fb?.data?.findScenes?.count) || 0; } catch (e) {} }
        const best = (byUrl && byUrl.exact) || (byTitle && byTitle.exact) || null;
        const via = (byUrl?.exact && byTitle?.exact) ? 'url+title' : (byUrl?.exact ? 'url' : (byTitle?.exact ? 'title' : ''));
        return { byTitle, byUrl, best, via, similar, cleanUrl: url, title };
      } catch (e) { return { error: String((e && e.message) || e).slice(0, 180) }; }
    })();
    cache.set(key, p);
    p.then((v) => { if (v && v.error) cache.delete(key); });
    return p;
  }
  async function checkDetail() {
    const h1 = document.querySelector('h1');
    if (!h1) return;
    if (!/^\/movies\/\d+/.test(location.pathname)) { document.getElementById('stash-exists-badge')?.remove(); return; }
    const title = h1.innerText.trim();
    const cleanUrl = canonUrl(location.href);
    if (!title) return;
    let badge = document.getElementById('stash-exists-badge');
    if (badge && badge.dataset.title === title && badge.dataset.url === cleanUrl) return;
    if (badge) badge.remove();
    badge = document.createElement('a');
    badge.id = 'stash-exists-badge';
    badge.dataset.title = title;
    badge.dataset.url = cleanUrl;
    badge.textContent = 'Stash?';
    badge.className = 'stash-no';
    badge.target = '_blank';
    badge.href = STASH + '/search?q=' + encodeURIComponent(title);
    h1.after(badge);
    const res = await lookupVideo({ title, url: cleanUrl });
    if (!badge.isConnected || document.querySelector('h1')?.innerText.trim() !== title) return;
    if (!res || res.error) log('warn', 'stash unreachable', res?.error || 'no result', { view: 'detail' });
    else log('info', 'detail checked', '', { inStash: !!res.best, sceneId: res.best?.id, via: res.via || undefined, byTitle: res.byTitle?.count || 0, byUrl: res.byUrl?.count || 0, similar: res.similar || 0 });
    if (!res || res.error) { badge.textContent = 'Stash unreachable'; badge.className = 'stash-err'; badge.title = (res?.error || 'fetch failed') + ' - is Stash running on localhost:9999?'; return; }
    if (res.best) { badge.textContent = 'In Stash #' + res.best.id + ' (' + res.via + ')'; badge.className = 'stash-yes'; badge.href = STASH + '/scenes/' + res.best.id; badge.title = 'Matched by ' + res.via + '\nTitle: ' + title + '\nURL: ' + cleanUrl + '\nStash: ' + (res.best.title || '') + '\n' + (res.best.urls || []).join('\n'); }
    else { const sim = res.similar || res.byTitle?.count || 0; badge.textContent = sim ? ('Not in Stash (' + sim + ' similar)') : 'Not in Stash'; badge.className = 'stash-no'; badge.title = 'No match\nTitle EQUALS: ' + (res.byTitle?.count || 0) + '\nURL INCLUDES ' + cleanUrl + ': ' + (res.byUrl?.count || 0) + (sim ? '\nFuzzy similar: ' + sim : ''); }
  }
  const cardQueue = [];
  let cardBusy = false;
  async function pumpCards() {
    if (cardBusy) return;
    cardBusy = true;
    const tally = { checked: 0, inStash: 0, failed: 0 };
    try {
      while (cardQueue.length) {
        const batch = cardQueue.splice(0, 4);
        await Promise.all(batch.map(async (job) => {
          try {
            const res = await lookupVideo({ title: job.title, url: job.url });
            tally.checked++;
            if (res?.best) tally.inStash++;
            if (res?.error) tally.failed++;
            if (!job.el.isConnected) return;
            job.el.textContent = res?.best ? '#' + res.best.id : 'x';
            job.el.classList.toggle('stash-yes', !!res?.best);
            job.el.title = res?.best ? ('In Stash via ' + res.via + ': ' + res.best.title + ' (#' + res.best.id + ')') : ('Not in Stash\n' + job.title + '\n' + (job.url || ''));
          } catch (e) { tally.failed++; }
        }));
        await new Promise((r) => setTimeout(r, 150));
      }
    } finally {
      cardBusy = false;
      log(tally.failed ? 'warn' : 'debug', 'cards checked', '', tally);
    }
  }
  function checkCards() {
    const links = document.querySelectorAll('a[href*="/movies/"]');
    links.forEach((a) => {
      const m = (a.getAttribute('href') || '').match(/\/movies\/(\d+)/);
      if (!m) return;
      const withText = a.querySelector('span');
      const title = (a.getAttribute('title') || (withText ? withText.innerText : '') || '').trim();
      if (title.length < 3) return;
      const wrap = a.parentElement || a;
      if (wrap.querySelector(':scope > .stash-card-dot')) return;
      if (a.dataset.stashQueued) return;
      a.dataset.stashQueued = '1';
      const dot = document.createElement('span');
      dot.className = 'stash-card-dot';
      dot.textContent = '?';
      dot.title = 'Checking Stash: ' + title + '\n' + a.href.split('?')[0].split('#')[0];
      wrap.style.position = wrap.style.position || 'relative';
      wrap.prepend(dot);
      cardQueue.push({ title, url: a.href.split('?')[0].split('#')[0], el: dot });
    });
    if (cardQueue.length) pumpCards();
  }
  let t = 0;
  function schedule() { clearTimeout(t); t = setTimeout(() => { checkDetail(); checkCards(); }, 400); }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  const _push = history.pushState;
  history.pushState = function (...args) { const r = _push.apply(this, args); schedule(); return r; };
  window.addEventListener('popstate', schedule);
  checkDetail();
  checkCards();
})();

