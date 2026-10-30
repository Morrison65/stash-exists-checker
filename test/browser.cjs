// Browser test: real headless Chrome on stub pages of every adapter (Reptyle, Adult Time, Brazzers) with stubbed
// GM_xmlhttpRequest/GM_getValue/GM_setValue/GM_addStyle/confirm. All requests are intercepted; nothing reaches the sites or Stash.
// GM storage is one Node-side store shared by every host, like Tampermonkey's per-script storage: each page gets a copy,
// and writes come back through a CDP binding.
// Usage: node test/browser.cjs [path/to/script.user.js]  (CHROME_PATH overrides the Chrome binary)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const source = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', require('../package.json').name + '.user.js'), 'utf8');
const pause = ms => new Promise(r => setTimeout(r, ms));

const gmStore = {};
const stub = () => `
window.__gm = ${JSON.stringify(gmStore)};
window.__log = [];
window.__errors = [];
window.addEventListener("error", e => __errors.push(String(e.message)));
window.addEventListener("unhandledrejection", e => __errors.push(String(e.reason && e.reason.stack || e.reason)));
window.__confirm = true;
window.confirm = function (m) { __log.push('confirm'); return __confirm; };
window.alert = function (m) { __log.push('alert:' + m); };
window.GM_getValue = function (k, d) { return k in __gm ? JSON.parse(JSON.stringify(__gm[k])) : d; };
window.GM_setValue = function (k, v) { __gm[k] = JSON.parse(JSON.stringify(v)); __gmSet(JSON.stringify([k, v])); };
window.GM_addStyle = function (css) { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); return st; };
window.__menu = {};
window.GM_registerMenuCommand = function (name, fn) { __menu[name] = fn; return name; };
window.GM_setClipboard = function (text) { window.__clip = text; };
// Scenes the single-video lookups (video page badge, card tags) can find; the title "Offline" stands for a Stash that does not answer.
const SCENES = [
  { id: '50', title: 'Hit By Url', urls: ['https://app.reptyle.com/movies/100?r=x'] }, { id: '51', title: 'Hit By Title', urls: [] },
  { id: '52', title: 'Different Stash Title', urls: [], files: [{ basename: 'Unknown Card Video Title (2024).mp4' }] },
  { id: '90', title: 'NS Title', urls: ['https://tour.newsite.example/video/80001/ns-title'] }
];
const PERFS = [
  { id: '7', name: 'Jane Doe', alias_list: [], urls: [] },
  { id: '8', name: 'Real Name', alias_list: ['Alias Girl'], urls: ['https://app.reptyle.com/models/2'] },
  { id: '217', name: 'Kenzie Reeves', alias_list: ['Tiny Kenzie'], urls: ['https://site-ma.brazzers.com/model/2717/kenzie-reeves'] },
  { id: '300', name: 'Nia Nacci', alias_list: [], urls: [] },
  { id: '125', name: 'Demi Hawks', alias_list: [], urls: Array.from({ length: 45 }, (_, i) => 'https://example.com/profile/demi-hawks-' + i) },
  // Nuxt members area: an older /girls/ URL (most such performer URLs in the library) under another name, so only the
  // key can match, and a /models/ slug that the
  // id lookup for "jane-doe" finds as a substring (Stash INCLUDES) but must not take.
  { id: '401', name: 'Renamed In Stash', alias_list: [], urls: ['https://holed.com/girls/holed-girl', 'https://holed.com/models/jane-doe-two'] }
];
// URLs added in Stash since the lists were read: a write must keep them.
const LIVE_URLS = { '300': ['https://example.com/nia-live'] };
window.GM_xmlhttpRequest = function (o) {
  // Log batches for the local collector (docker-workspace/docs/userscripts.md) are kept for assertions.
  if (o.url === 'http://localhost:7790/v1/logs') { (window.__sent = window.__sent || []).push(...JSON.parse(o.data).entries); setTimeout(() => o.onload({ status: 200, responseText: '{}' }), 1); return; }
  const body = JSON.parse(o.data), q = body.query, v = body.variables || {};
  let data;
  if (/scene_filter:\\$sf/.test(q) && (v.sf.title?.value === 'Offline' || /\\/movies\\/666/.test(v.sf.url?.value || ''))) { __log.push('lookup:offline'); setTimeout(() => o.onerror(), 10); return; }
  // Setup guide survey: what Stash holds per URL fragment.
  if (/\\$part/.test(q) && /findScenes/.test(q)) { __log.push('survey:scenes:' + v.part); const ss = SCENES.filter(s => s.urls.some(u => u.includes(v.part))); data = { findScenes: { count: ss.length, scenes: ss } }; }
  else if (/\\$part/.test(q)) { __log.push('survey:performers:' + v.part); data = { findPerformers: { count: PERFS.filter(p => p.urls.some(u => u.includes(v.part))).length } }; }
  // File-name lookup: a quoted INCLUDES is one LIKE '%...%' in Stash, % between the words.
  else if (/scene_filter:\\$sf/.test(q) && v.sf.path) { __log.push('lookup:p:' + v.sf.path.value); const re = new RegExp(v.sf.path.value.replace(/"/g, '').split('%').join('.*'), 'i'); const ss = SCENES.filter(s => (s.files || []).some(f => re.test(f.basename))); data = { findScenes: { count: ss.length, scenes: ss } }; }
  else if (/performerUpdate/.test(q)) { __log.push('update:' + JSON.stringify(v.input)); data = { performerUpdate: { id: v.input.id, urls: v.input.urls } }; }
  else if (/findPerformer\\(id:/.test(q)) { __log.push('live:' + v.id); const p = PERFS.find(x => x.id === v.id); data = { findPerformer: p ? { urls: (LIVE_URLS[p.id] || []).concat(p.urls) } : null }; }
  else if (/performer_filter:\\{url/.test(q)) { __log.push('byurl:' + v.u); const ps = PERFS.filter(p => p.urls.some(u => u.includes(v.u))); data = { findPerformers: { performers: JSON.parse(JSON.stringify(ps)) } }; }
  else if (/findPerformers\\(filter:\\{q:/.test(q)) { const n = v.q.toLowerCase(); const ps = PERFS.filter(p => [p.name].concat(p.alias_list).some(x => x.toLowerCase().includes(n))); data = { findPerformers: { count: ps.length, performers: JSON.parse(JSON.stringify(ps)) } }; }
  else if (/findPerformers/.test(q)) { __log.push('perfs:' + v.p); data = { findPerformers: { count: PERFS.length, performers: JSON.parse(JSON.stringify(PERFS)) } }; }
  else if (/url:\\{value:\\$h/.test(q)) { __log.push('scenes:' + v.h + ':' + v.p); data = { findScenes: { scenes: v.h === 'holed.com/' ? [{ id: '80', title: 'Stash Title Differs', urls: ['https://holed.com/video/some-scene'] }] : v.h === 'primalfetishnetwork.com/' ? [{ id: '81', title: 'Old Primal Title', urls: ['https://primalfetishnetwork.com/updates/Some-Primal-Scene.html'] }] : v.h === 'newsite.example' ? SCENES.filter(s => s.urls.some(u => u.includes(v.h))) : v.m === 'MATCHES_REGEX' && /bangbros/.test(v.h) ? [{ id: '70', title: 'BZ Cross', urls: ['https://bangbros.com/video/9001/bz-cross'] }] : v.h === '/en/video/' ? [{ id: '60', title: 'Cross Site', urls: ['https://www.evilangel.com/en/video/evilangel/Cross-Site/209586'] }] : [{ id: '50', title: 'Hit By Url', urls: ['https://app.reptyle.com/movies/100?r=x'] }] } }; }
  else if (/performers:\\{value:\\[217\\]/.test(q)) data = { findScenes: { count: 1, scenes: [{ id: '61', title: 'Title Match AT', urls: [] }] } };
  else if (/performers:\\{value/.test(q)) data = { findScenes: { count: 1, scenes: [{ id: '51', title: 'Hit By Title', urls: [] }] } };
  else if (/scene_filter:\\$sf/.test(q) && v.sf.title) { __log.push('lookup:t:' + v.sf.title.value); const ss = SCENES.filter(s => s.title.toLowerCase() === v.sf.title.value.toLowerCase()); data = { findScenes: { count: ss.length, scenes: ss } }; }
  else if (/scene_filter:\\$sf/.test(q) && v.sf.url) { __log.push('lookup:u:' + v.sf.url.value); const ss = SCENES.filter(s => s.urls.some(u => u.includes(v.sf.url.value))); data = { findScenes: { count: ss.length, scenes: ss } }; }
  else if (/findScenes\\(filter:\\{q:/.test(q)) { __log.push('fuzzy:' + v.q); const ss = SCENES.filter(s => s.title.toLowerCase().includes(v.q.toLowerCase())); data = { findScenes: { count: ss.length, scenes: ss } }; }
  else throw new Error('unexpected query ' + q);
  setTimeout(() => o.onload({ status: 200, responseText: JSON.stringify({ data }) }), 10);
};`;
const card = (id, t) => `<div class="movies-thumb-entry"><a href="/movies/${id}"><img></a><a href="/movies/${id}"><span>${t}</span></a></div>`;
const model = (id, n) => `<div class="models-grid-entry"><div class="ant-card"><a href="/models/${id}"><img></a><div class="ant-card-meta-description"><span>${n}</span></div></div></div>`;
const atItem = (id, t) => `<div class="ListingGrid-ListingGridItem"><div><div class="SceneThumb-WithMenu-container"><div><a class="Link SceneThumb-SceneImageLink-Link" href="/en/video/mommysboy/${t.replace(/ /g, '-')}/${id}"><div class="SceneThumb-WithMenu-SceneImage"><img></div></a><div></div><div class="SceneThumb-Length"><div class="SceneThumb-Length-TextFrame">12:00</div></div></div><div><div><a class="Link SceneThumb-WithMenu-ChannelName-Link" href="/en/channel/mommysboy">Mommys Boy</a><h2 class="Title">${t}</h2><div class="Wordlist WordList">x</div><div class="SceneThumb-WithMenu-MetadataLine">y</div></div><div class="SceneThumb-WithMenu-Actions"><button class="Button SceneThumb-Favorite-Button">f</button></div></div></div><div></div></div></div>`;
function atPage(p) {
  // Header h1 that is not the name; scenes rendered late like the React app; an outer wrapper around several scenes.
  const grid = `<div class="SceneThumbs-Wrapper"><div class="ListingGrid">${atItem(209586, 'Other Name Here')}${atItem(209587, 'Title Match AT')}${atItem(209588, 'Not In Stash')}</div></div>`;
  return `<!doctype html><html><head><title>Adult Time</title></head><body><header><h1>Adult Time</h1></header><main id="m"></main><script>setTimeout(function () { document.getElementById('m').innerHTML = ${JSON.stringify(grid)}; }, 1500);</script><script>${stub()}</script><script>${source}</script></body></html>`;
}
const bzCard = (id, t, mid, mslug) => `<div class="e1vusg2z1"><article class="css-1x2y"><a href="/scene/${id}/${t.toLowerCase().replace(/ /g, '-')}"><img></a><div class="css-9q"><a href="/scene/${id}/${t.toLowerCase().replace(/ /g, '-')}">${t}</a></div><div><a href="/model/${mid}/${mslug}">${mslug}</a></div></article></div>`;
const bzGrid = (mid, mslug) => `<section id="List-container-77"><div class="e1vusg2z0">${bzCard(9001, 'BZ Cross', mid, mslug)}${bzCard(9002, 'Title Match AT', mid, mslug)}${bzCard(9003, 'Not In Stash BZ', mid, mslug)}</div></section>`;
function bzPage(p, search) {
  let body;
  if (p === '/models') body = `<h1>Models</h1><div class="css-g"><div class="css-c"><a href="/model/2717/kenzie-reeves"><img></a><a href="/model/2717/kenzie-reeves">Kenzie Reeves</a></div><div class="css-c"><a href="/model/65308/nia-nacci"><img></a><a href="/model/65308/nia-nacci">Nia Nacci</a></div><div class="css-c"><a href="/model/1/nobody-here"><img></a><a href="/model/1/nobody-here">Nobody</a></div></div>`;
  else if (p.startsWith('/model/')) body = `<h1>Kenzie Reeves</h1>${bzGrid(2717, 'kenzie-reeves')}`;
  else if (/models=65308/.test(search)) body = `<h1>Scenes</h1><div id="late"></div><script>setTimeout(function () { document.getElementById('late').innerHTML = ${JSON.stringify(bzGrid(65308, 'nia-nacci'))}; }, 1500);</script>`;
  // Scene pages link the previous and next scene side by side in one element: no card around either.
  else if (p.startsWith('/scene/')) body = `<h1>Scenes</h1>${bzGrid(2717, 'kenzie-reeves')}<nav class="sib"><a href="/scene/9004/prev-scene-here">Prev Scene Here</a><a href="/scene/9005/next-scene-here">Next Scene Here</a></nav>`;
  else body = `<h1>Scenes</h1>${bzGrid(2717, 'kenzie-reeves')}`;
  return `<!doctype html><html><head><title>Brazzers</title></head><body><div id="root">${body}</div><script>${stub()}</script><script>${source}</script></body></html>`;
}
// Members area of the Nuxt platform (markup shape from the onboarding logs and a live public page: Tailwind classes,
// Vue fragment comments and data-v attributes, one card per direct child of .card-grid, the video heading links the
// current page, tabs below a video).
const nxCard = (slug, t, model = 'jane-doe', name = 'Jane Doe') => `<!--[--><!----><div class="relative w-full flex flex-col gap-1" data-v-9a56089a><div class="w-full flex flex-col gap-1" data-v-9a56089a><div class="relative w-full" data-v-9a56089a><!----><div class="relative cursor-pointer w-full overflow-hidden" data-v-9a56089a><a href="/members/video/${slug}" data-v-9a56089a><img></a></div></div><div class="w-full flex flex-row items-stretch gap-2 p-1 pb-4" data-v-9a56089a><!----><div class="w-full flex flex-row justify-between" data-v-9a56089a><div class="w-full flex flex-col" data-v-9a56089a><a class="text-white leading-tight text-xl cursor-pointer" href="/members/video/${slug}" data-v-9a56089a><strong data-v-9a56089a>${t}</strong></a></div></div></div><a class="inline text-lg text-white" href="/members/models/${model}">${name}</a></div></div><!--]-->`;
const nxGrid = `<div class="card-grid" data-v-0dbae6b8><!--[-->${nxCard('some-scene', 'Some Scene!')}${nxCard('hit-by-title', 'Hit By Title')}${nxCard('nothing-here-at-all', 'Nothing Here At All', 'holed-girl', 'Holed Girl')}<!--]--></div>`;
function nxPage(p) {
  let body;
  if (p.startsWith('/members/models/')) body = `<div class="w-full max-w-7xl flex flex-col"><div class="actor-image w-full h-96 relative bg-cover"><div class="absolute inset-3 flex flex-row"><div class="w-full leading-snug"><p class="text-white text-xl font-bold">Jane Doe</p><p class="text-white">3 videos</p></div></div></div></div>${nxGrid}`;
  else if (p === '/members/video/no-heading-here') body = nxGrid;
  else body = `<div class="w-full max-w-7xl flex flex-col gap-2"><div class="flex flex-row items-center gap-3"><div><h3 class="leading-tight text-xl"><a aria-current="page" class="router-link-active router-link-exact-active text-white" href="${p}">Some Scene!</a></h3><p><span><a class="inline text-lg text-white" href="/members/models/jane-doe">Jane Doe</a></span></p></div></div><a href="${p}/trailer">Trailer</a><a href="${p}/pictures">Pictures</a></div>${nxGrid}`;
  return `<!doctype html><html><head><title>Members Area</title></head><body><div id="__nuxt"><nav><a href="/members/models">Models</a></nav>${body}</div><script>${stub()}</script><script>${source}</script></body></html>`;
}
// Primal Fetish Network: BEM classes, /video/<slug>-<id>.html; Stash holds the older /updates/ URL of the first scene.
const pfCard = (slug, t) => `<div class="main__videoElement item-col"><a href="/video/${slug}.html"><img></a><div class="main__info"><div class="main__data"><a class="main__videoTitle" href="https://primalfetishnetwork.com/video/${slug}.html"> ${t} </a><div class="main__models"><a class="video__listModel" href="/models/jane-doe-325.html"><span class="sub-label">Jane Doe</span></a></div></div></div></div>`;
function pfPage() {
  return `<!doctype html><html><head><title>Primal</title></head><body><main class="performer"><div class="performer__container"><div class="performer__infoWrapper"><h1 class="performer__name">Jane Doe</h1></div></div></main><div class="videos"><div class="videos__container"><div class="videos__videoList">${pfCard('some-primal-scene-3585', 'Jane Doe - Some Primal Scene')}${pfCard('nothing-primal-here-12', 'Nothing Primal Here')}</div></div></div><script>${stub()}</script><script>${source}</script></body></html>`;
}
// A site the script does not know: two h1s (logo and performer name), cards whose title sits beside the links, and a
// click handler that must never see a pick.
const NS = 'members.newsite.example';
const nsCard = (id, t) => `<div class="tile"><a class="thumb" href="/watch/${id}/${t.toLowerCase().replace(/ /g, '-')}"><img></a><h3 class="tile-title">${t}</h3><a class="star" href="/performer/555/jane-doe">Jane Doe</a></div>`;
function nsPage(p) {
  const grid = `<div class="grid">${nsCard(80001, 'NS Title')}${nsCard(80002, 'Hit By Title')}${nsCard(80003, 'Nothing Here At All')}</div>`;
  const body = p.startsWith('/watch/') ? `<h1 class="vid-title">NS Title</h1>${grid}` : `<div class="profile"><h1 class="ProfileName" onclick="window.__pageClicked = true">Jane Doe</h1></div>${grid}`;
  return `<!doctype html><html><head><title>NewSite</title></head><body><header><h1 class="SiteLogo">NewSite</h1></header>${body}<script>${stub()}</script><script>${source}</script></body></html>`;
}
function page(p, host, search) {
  if (host === 'site-ma.brazzers.com') return bzPage(p, search);
  if (host === 'members.adulttime.com') return atPage(p);
  if (host === NS) return nsPage(p);
  if (host === 'holed.com') return nxPage(p);
  if (host === 'primalfetishnetwork.com') return pfPage(p);
  let body;
  if (p === '/models') body = `<h1>Models</h1>${model(1, 'Jane Doe')}${model(2, 'Alias Girl')}${model(3, 'Nobody Here')}`;
  else if (p === '/models/2') body = `<div class="model-name-container"><h2>Alias Girl</h2></div>`;
  else if (p.startsWith('/movies/')) body = `<h1>Hit By Url</h1><h2>Related</h2>${card(100, 'Some Other Title')}${card(101, 'Hit By Title')}${card(102, 'Unknown')}${card(103, 'Unknown Card Video Title')}`;
  else body = `<div class="model-name-container"><h2>Jane Doe</h2></div><h2>Featured in</h2>${card(100, 'Some Other Title')}${card(101, 'Hit By Title')}${card(102, 'Unknown')}`;
  return `<!doctype html><html><head><title>Reptyle | Test</title></head><body>${body}<script>${stub()}</script><script>${source}</script></body></html>`;
}

async function connect(url) {
  const ws = new WebSocket(url), pending = new Map(), listeners = new Map(); let seq = 0;
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = e => { const m = JSON.parse(e.data), t = pending.get(m.id); if (!t) { listeners.get(m.method)?.(m.params); return; } pending.delete(m.id); m.error ? t.reject(Error(JSON.stringify(m.error))) : t.resolve(m.result); };
  return { close: () => ws.close(), on: (ev, l) => listeners.set(ev, l), send: (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }) };
}
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sml-chrome-'));
  const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let pg;
  try {
    const readPort = () => { try { return fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(); } catch { return ''; } };
    for (let n = 0; !/^\d+$/.test(readPort()) && n < 600; n++) await pause(50);
    const targets = await (await fetch(`http://127.0.0.1:${readPort()}/json/list`)).json();
    pg = await connect(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    pg.on('Fetch.requestPaused', async ev => {
      const u = new URL(ev.request.url);
      if (!['app.reptyle.com', 'members.adulttime.com', 'site-ma.brazzers.com', 'holed.com', 'primalfetishnetwork.com', NS].includes(u.hostname) || /\.(png|ico)$/.test(u.pathname)) return pg.send('Fetch.failRequest', { requestId: ev.requestId, errorReason: 'BlockedByClient' });
      pg.send('Fetch.fulfillRequest', { requestId: ev.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body: Buffer.from(page(u.pathname, u.hostname, u.search)).toString('base64') });
    });
    await pg.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    pg.on('Runtime.bindingCalled', ev => { const [k, v] = JSON.parse(ev.payload); gmStore[k] = v; });
    await pg.send('Runtime.enable');
    await pg.send('Runtime.addBinding', { name: '__gmSet' });
    await pg.send('Page.enable');
    const ev = async expr => { const r = await pg.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    const wait = async expr => { for (let n = 0; n < 200; n++) { if (await ev(expr)) return; await pause(30); } throw Error('timeout: ' + expr + ' :: ' + await ev('document.body.innerText') + '\npanel: ' + await ev('document.getElementById("stash-model-link-panel")?.outerHTML || "none"') + '\nlog: ' + await ev('JSON.stringify(__log.slice(-12))') + '\ncount: ' + await ev('document.querySelector("[data-sml-video-count]")?.outerHTML || "none"') + '\nerrors: ' + await ev('JSON.stringify(window.__errors || [])')); };
    const go = async (p, host = 'app.reptyle.com') => { await pg.send('Page.navigate', { url: 'https://' + host + p }); await wait('document.readyState==="complete" && !!window.__log'); };
    // GM writes reach gmStore through binding events, which can trail the page; wait for them before the next page,
    // or that page gets a snapshot without them (the real storage has no such gap).
    const stored = async (k, ok) => { for (let n = 0; n < 200; n++) { if (ok(gmStore[k])) return; await pause(30); } throw Error('timeout: stored ' + k); };
    const panel = '(document.getElementById("stash-model-link-panel")?.innerText || "")';

    // Detail page, exact name match, video marks by URL id and by title.
    await go('/models/1');
    await wait(panel + '.includes("Videos on this page in Stash")');
    const text = await ev(panel);
    assert.match(text, /Found in Stash: Jane Doe \(id 7\)/);
    assert.match(text, /This page URL is NOT saved/);
    assert.match(text, /Videos on this page in Stash: 2\/3/);
    assert.equal(await ev('document.querySelectorAll(".stash-model-link-video-badge").length'), 2);
    assert.equal(await ev('!!document.getElementById("stash-model-link-heading-badge")'), true);
    assert.deepEqual(await ev('__log.filter(x=>x.startsWith("scenes:"))'), ['scenes:app.reptyle.com:1']);
    // Both bulk lists are stored for the next pages and sites.
    assert.ok(await ev('__log.includes("perfs:1")'));
    assert.equal(gmStore['cache:v1:performers'].items.length, 6);
    assert.equal(gmStore['cache:v1:scenes:app.reptyle.com'].items[0].id, '50');
    // Card tags: an id in the stored scene list answers at once, the other cards are looked up (title, URL, file name).
    // One corner, one tag: where the IN STASH badge is, no tag; never inside the title.
    const tags = '[...document.querySelectorAll(".movies-thumb-entry")].map(c=>(c.querySelector(".stash-model-link-video-badge") ? "badge" : "") + (c.querySelector(".stash-exists-tag")?.textContent || ""))';
    await wait(tags + '.join("|")==="badge|badge|NOT IN STASH"');
    await pause(500);
    assert.deepEqual(await ev(tags), ['badge', 'badge', 'NOT IN STASH']);
    assert.equal(await ev('[...document.querySelectorAll(".stash-exists-tag")].every(t=>t.parentElement.classList.contains("movies-thumb-entry"))'), true);
    assert.equal(await ev('__log.some(x=>x.startsWith("lookup:") && x.includes("/movies/100"))'), false);
    assert.ok(await ev('__log.includes("lookup:t:Hit By Title")'));
    assert.equal(await ev('__log.some(x=>x.startsWith("fuzzy:") || x.startsWith("lookup:p:"))'), false, 'cards get no fuzzy search; "Unknown" is too short for a file lookup');
    // Add URL: cancel writes nothing, confirm writes the page URL.
    await ev('__confirm=false; [...document.querySelectorAll("#stash-model-link-panel button")].find(b=>b.textContent.startsWith("Add this URL")).click()');
    await pause(100);
    assert.equal(await ev('__log.some(x=>x.startsWith("update:"))'), false);
    assert.equal(await ev('[...document.querySelectorAll("#stash-model-link-panel button")].find(b=>b.textContent==="Add this URL in Stash").disabled'), false);
    await ev('__confirm=true; [...document.querySelectorAll("#stash-model-link-panel button")].find(b=>b.textContent.startsWith("Add this URL")).click()');
    await wait('__log.some(x=>x.startsWith("update:"))');
    assert.deepEqual(JSON.parse((await ev('__log.find(x=>x.startsWith("update:"))')).slice(7)), { id: '7', urls: ['https://app.reptyle.com/models/1'] });
    // The write drops the stored performer list once Stash answers; the stored scenes stay.
    await stored('cache:v1:performers', v => v === null);
    assert.ok(gmStore['cache:v1:scenes:app.reptyle.com']);

    // Any other Reptyle page: no panel, scenes marked by id only (the title match needs a model page).
    await go('/movies/100');
    await wait('document.querySelectorAll(".stash-model-link-video-badge").length===1');
    assert.equal(await ev('!!document.getElementById("stash-model-link-panel")'), false);
    assert.equal(await ev('document.querySelector(".stash-model-link-video-badge").getAttribute("data-sml-key")'), '50');
    // Next page: scenes come from storage, the dropped performer list is fetched again.
    assert.equal(await ev('__log.some(x=>x.startsWith("scenes:"))'), false);
    await wait('__log.includes("perfs:1")');
    // Video page badge after the title: the page's id is in the stored scene list, so no lookup is needed.
    const badge = '(document.getElementById("stash-exists-badge")?.textContent || "")';
    await wait(badge + '==="In Stash #50 (url)"');
    assert.equal(await ev('__log.some(x=>x.startsWith("lookup:") && x.includes("/movies/100"))'), false);
    assert.equal(await ev('document.getElementById("stash-exists-badge").href'), 'http://localhost:9999/scenes/50');
    assert.equal(await ev('document.getElementById("stash-exists-badge").previousElementSibling.tagName'), 'H1');
    await wait('(window.__sent || []).some(e => e.event === "detail checked" && e.data.sceneId === "50" && e.data.via === "url")');
    // Without a performer page there is no title map: the card tags tell title and file-name matches apart.
    const via = '[...document.querySelectorAll(".movies-thumb-entry")].map(c=>c.querySelector(".stash-model-link-video-badge") ? "badge" : c.querySelector(".stash-exists-tag")?.getAttribute("data-stash-via") || "")';
    await wait(via + '.join("|")==="badge|title|none|file"');
    assert.equal(await ev('document.querySelector("[data-stash-via=file]").textContent'), '\u2713 IN STASH \u00b7 FILE');
    assert.equal(await ev('document.querySelector("[data-stash-via=file]").href'), 'http://localhost:9999/scenes/52');
    assert.ok(await ev('__log.includes("lookup:p:\\"unknown%card%video%title\\"")'));
    // In-app navigation to a video Stash does not answer for: "Stash unreachable", never "Not in Stash".
    await ev('history.pushState({}, "", "/movies/666"); document.querySelector("h1").textContent = "Offline"');
    await wait(badge + '==="Stash unreachable"');
    assert.equal(await ev('document.getElementById("stash-exists-badge").className'), 'stash-err');
    await wait('(window.__sent || []).some(e => e.event === "stash unreachable" && e.data.view === "detail")');

    // Detail page reached by alias.
    await go('/models/2');
    await wait(panel + '.includes("Found in Stash")');
    assert.match(await ev(panel), /Found in Stash: Real Name \(id 8\)/);
    assert.match(await ev(panel), /This page URL is saved/);
    assert.equal(await ev('__log.some(x=>x.startsWith("perfs:") || x.startsWith("scenes:"))'), false);

    // Listing: name and alias badges, + URL only where the URL is missing, with confirm.
    await go('/models');
    await wait('document.querySelectorAll(".stash-model-link-model-badge").length===2');
    assert.equal(await ev('document.querySelectorAll(".stash-model-link-model-add").length'), 1);
    assert.equal(await ev('document.querySelector(".stash-model-link-model-add").closest(".ant-card").innerText.includes("Jane Doe")'), true);
    await ev('__confirm=false; document.querySelector(".stash-model-link-model-add").click()');
    await pause(100);
    assert.equal(await ev('document.querySelector(".stash-model-link-model-add").textContent'), '+ URL');
    await ev('__confirm=true; document.querySelector(".stash-model-link-model-add").click()');
    await wait('!document.querySelector(".stash-model-link-model-add")');
    assert.ok(await ev('__log.some(x=>x==="update:"+JSON.stringify({id:"7",urls:["https://app.reptyle.com/models/1"]}))'));
    await stored('cache:v1:performers', v => v === null);
    await pause(2300); // the 2 s re-check must not add a second badge or bring + URL back
    assert.equal(await ev('document.querySelectorAll(".stash-model-link-model-badge").length'), 2);
    assert.equal(await ev('document.querySelectorAll(".stash-model-link-model-add").length'), 0);
    assert.equal(await ev('__log.filter(x=>x.startsWith("alert")).length'), 0);

    // Adult Time: name from the URL, floating panel, header h1 untouched, cross-site scene id and title matches,
    // late cards picked up by the re-check, the multi-scene wrapper never badged.
    await go('/en/pornstar/view/Kenzie-Reeves/49648', 'members.adulttime.com');
    await wait(panel + '.includes("Found in Stash")');
    assert.match(await ev(panel), /Found in Stash: Kenzie Reeves \(id 217\)/);
    assert.match(await ev(panel), /This page URL is NOT saved/);
    // The floating panel sits in the shared bottom-right dock, so another userscript's panel there stacks instead of overlapping.
    assert.equal(await ev('document.getElementById("stash-model-link-panel").parentElement.id'), 'userscript-dock');
    assert.equal(await ev('getComputedStyle(document.getElementById("userscript-dock")).position'), 'fixed');
    assert.equal(await ev('(() => { const o = document.createElement("div"); o.id = "other-panel"; o.style.cssText = "height:120px;width:300px;order:20;pointer-events:auto;flex:none"; document.getElementById("userscript-dock").append(o); const a = document.getElementById("stash-model-link-panel").getBoundingClientRect(), b = o.getBoundingClientRect(); o.remove(); return a.bottom <= b.top || b.bottom <= a.top; })()'), true, 'docked panels overlap');
    // Structured logs reach the collector: start, the lookup result, with page host+path only.
    await wait('(window.__sent || []).some(e => e.event === "performer lookup")');
    assert.ok(await ev('__sent.every(e => e.script === "stash-exists-checker" && e.version && e.session && !/[?#]/.test(e.page))'));
    assert.ok(await ev('__sent.some(e => e.event === "started" && e.data.site === "adulttime")'));
    // The video page badge is Reptyle-only until a site's video page is picked in the setup guide.
    assert.equal(await ev('!!document.getElementById("stash-exists-badge")'), false);
    assert.equal(await ev('!!document.getElementById("stash-model-link-heading-badge")'), false);
    assert.deepEqual(await ev('__log.filter(x=>x.startsWith("scenes:/en"))'), ['scenes:/en/video/:1']);
    await wait(panel + '.includes("Videos on this page in Stash: 2/3")');
    assert.equal(await ev('document.querySelectorAll(".stash-model-link-video-badge").length'), 2);
    assert.equal(await ev('[...document.querySelectorAll(".stash-model-link-video-badge")].every(b=>b.parentElement.classList.contains("ListingGrid-ListingGridItem"))'), true);
    assert.deepEqual(await ev('[...document.querySelectorAll(".stash-model-link-video-badge")].map(b=>b.href.split("/").pop()).sort()'), ['60', '61']);
    assert.deepEqual(await ev('[...document.querySelectorAll("[data-sml-video-green]")].map(e=>e.tagName+":"+e.textContent.replace(/^\\u2713 /,""))').then(x => x.sort()), ['H2:Other Name Here', 'H2:Title Match AT']);
    assert.equal(await ev('[...document.querySelectorAll(".SceneThumb-WithMenu-ChannelName-Link")].some(a=>a.hasAttribute("data-sml-video-green"))'), false);
    // Card tags on Adult Time: the card Stash holds by neither id nor title gets one tag, on the grid item (the card
    // selector also matches the image link, which must not get it), after a title and a file-name lookup.
    const atCards = '[...document.querySelectorAll(".ListingGrid-ListingGridItem")].map(c=>c.querySelector(".stash-model-link-video-badge") ? "badge" : c.querySelector(".stash-exists-tag")?.getAttribute("data-stash-via") || "")';
    await wait(atCards + '.join("|")==="badge|badge|none"');
    assert.equal(await ev('document.querySelector(".stash-exists-tag").parentElement.classList.contains("ListingGrid-ListingGridItem")'), true);
    assert.ok(await ev('__log.includes("lookup:t:Not In Stash") && __log.includes("lookup:p:\\"not%in%stash\\"")'));
    assert.equal(await ev('__log.some(x=>x.startsWith("lookup:u:"))'), false, 'no URL query once the scene list is loaded');
    await ev('__confirm=true; [...document.querySelectorAll("#stash-model-link-panel button")].find(b=>b.textContent.startsWith("Add this URL")).click()');
    await wait('__log.some(x=>x.includes("\\"id\\":\\"217\\""))');
    assert.ok(await ev('__log.some(x=>x==="update:"+JSON.stringify({id:"217",urls:["https://site-ma.brazzers.com/model/2717/kenzie-reeves","https://members.adulttime.com/en/pornstar/view/Kenzie-Reeves/49648"]}))'));
    await stored('cache:v1:performers', v => v === null);

    // Floating panel stays small next to the grid: 45 saved URLs are folded, height is capped, and the fold toggle
    // keeps only the summary lines and is remembered on the next page.
    await go('/en/pornstar/view/Demi-Hawks/53303', 'members.adulttime.com');
    await wait(panel + '.includes("Found in Stash: Demi Hawks (id 125)")');
    const box = 'document.getElementById("stash-model-link-panel")';
    assert.equal(await ev(box + '.querySelector("details").open'), false);
    assert.equal(await ev(box + '.querySelector("summary").textContent'), 'Saved URLs (45)');
    assert.ok(await ev(box + '.getBoundingClientRect().height < 260'), 'panel height ' + await ev(box + '.getBoundingClientRect().height'));
    assert.ok(await ev(box + '.getBoundingClientRect().width <= 340'));
    await ev(box + '.querySelector("details").open = true');
    assert.ok(await ev(box + '.getBoundingClientRect().height <= innerHeight - 100'));
    // Content taller than the cap scrolls inside the panel (the open URL list is long).
    await ev(box + '.querySelector("details > div").style.maxHeight = "none"');
    assert.ok(await ev(box + '.scrollHeight > ' + box + '.clientHeight'), 'panel content should overflow');
    assert.equal(await ev('getComputedStyle(' + box + ').overflowY'), 'auto');
    assert.equal(await ev('(' + box + '.scrollTop = 50, ' + box + '.scrollTop)'), 50);
    await ev(box + '.querySelector("details > div").style.maxHeight = "140px"');
    await ev(box + '.querySelector("[data-sml-toggle]").click()');
    const visible = '[...' + box + '.children].filter(e=>e.style.display!=="none" && !e.hasAttribute("data-sml-toggle")).map(e=>e.innerText.split("\\n")[0])';
    await wait(panel + '.includes("Videos on this page in Stash")');
    assert.deepEqual(await ev(visible), ['STASH', '\u2713 Found in Stash: Demi Hawks (id 125)', 'Videos on this page in Stash: 1/3']);
    assert.equal(await ev(box + '.querySelector("[data-sml-toggle]").getAttribute("aria-expanded")'), 'false');
    await go('/en/pornstar/view/Kenzie-Reeves/49648', 'members.adulttime.com');
    await wait(panel + '.includes("Found in Stash: Kenzie Reeves")');
    assert.equal(await ev(box + '.querySelector("details")?.style.display || "none"'), 'none');
    await ev(box + '.querySelector("[data-sml-toggle]").click()');
    assert.equal(await ev('GM_getValue("panelCollapsed", null)'), false);

    // "See all" from the pornstar page: /en/videos filtered to her name is her model page; the URL to save is the remembered pornstar page.
    await go('/en/videos/?sortBy=all_scenes_latest_desc&refinementList%5Bactors.name%5D%5B0%5D=Kenzie%20Reeves&fromSeeAll=1', 'members.adulttime.com');
    await wait(panel + '.includes("Videos on this page in Stash: 2/3")');
    assert.match(await ev(panel), /Found in Stash: Kenzie Reeves \(id 217\)/);
    assert.match(await ev(panel), /This page URL is NOT saved/);
    await ev('__confirm=true; __log.length=0; [...document.querySelectorAll("#stash-model-link-panel button")].find(b=>b.textContent.startsWith("Add this URL")).click()');
    await wait('__log.some(x=>x.startsWith("update:"))');
    assert.ok(await ev('__log.some(x=>x.startsWith("update:") && x.endsWith(",\\"https://members.adulttime.com/en/pornstar/view/Kenzie-Reeves/49648\\"]}"))'));
    await stored('cache:v1:performers', v => v === null);
    // Video page: id and title from the URL (no title element known), the badge floats in the shared dock.
    const badgeText = '(document.getElementById("stash-exists-badge")?.textContent || "")';
    await go('/en/video/evilangel/Cross-Site/209586', 'members.adulttime.com');
    await wait(badgeText + '==="In Stash #60 (url)"');
    assert.equal(await ev('document.getElementById("stash-exists-badge").parentElement.id'), 'userscript-dock');
    // Unfiltered video listing: no model page, but scenes Stash holds are marked by id.
    await go('/en/videos/', 'members.adulttime.com');
    await wait('document.querySelectorAll(".stash-model-link-video-badge").length===1');
    assert.equal(await ev('!!document.getElementById("stash-model-link-panel")'), false);
    assert.equal(await ev('document.querySelector(".stash-model-link-video-badge").getAttribute("data-sml-key")'), '60');
    // This page refetches the performer list the "See all" write dropped; the next site reuses it.
    await stored('cache:v1:performers', v => !!v);

    // Brazzers model page: found by id in a saved URL, structural cards, heading shows the name.
    const badges = 'document.querySelectorAll(".stash-model-link-video-badge")';
    await go('/model/2717/kenzie-reeves', 'site-ma.brazzers.com');
    await wait(panel + '.includes("Videos on this page in Stash")');
    assert.match(await ev(panel), /Found in Stash: Kenzie Reeves \(id 217\)/);
    assert.match(await ev(panel), /This page URL is saved/);
    assert.match(await ev(panel), /Videos on this page in Stash: 2\/3/);
    assert.ok(await ev('__log.includes("byurl:brazzers.com/model/2717/")'));
    // The performer list stored on Adult Time serves Brazzers too; Brazzers scenes are its own lists.
    assert.equal(await ev('__log.some(x=>x.startsWith("perfs:"))'), false);
    // One regex list for the whole Aylo network; the Brazzers scene is found under its BangBros URL (same release id).
    assert.ok(await ev('__log.some(x => x.startsWith("scenes:(?i)^https?://") && x.includes("bangbros") && x.endsWith(":1"))'));
    assert.equal(await ev('__log.filter(x => x.startsWith("scenes:")).length'), 1);
    assert.equal(await ev('!!document.getElementById("stash-model-link-heading-badge")'), true);
    assert.equal(await ev(badges + '.length'), 2);
    assert.equal(await ev('[...' + badges + '].every(b=>b.parentElement.classList.contains("e1vusg2z1"))'), true);
    assert.deepEqual(await ev('[...' + badges + '].map(b=>b.href.split("/").pop()).sort()'), ['61', '70']);
    assert.deepEqual(await ev('GM_getValue("model:aylo:2717", null)'), { name: 'kenzie reeves', url: 'https://site-ma.brazzers.com/model/2717/kenzie-reeves' });

    // Scenes filtered to that model (?models=2717) count as the model page.
    await go('/scenes?addon=162%2C5971%2C5951&models=2717', 'site-ma.brazzers.com');
    await wait(panel + '.includes("Videos on this page in Stash: 2/3")');
    assert.match(await ev(panel), /Found in Stash: Kenzie Reeves \(id 217\)/);
    assert.equal(await ev('!!document.getElementById("stash-model-link-heading-badge")'), false);

    // Unknown id, not in Stash by URL: the name comes from the late-loading cards and the panel is redrawn.
    await go('/scenes?models=65308', 'site-ma.brazzers.com');
    await wait(panel + '.includes("model #65308")');
    await wait(panel + '.includes("Found in Stash: Nia Nacci (id 300)")');
    assert.match(await ev(panel), /This page URL is NOT saved/);
    await ev('__confirm=true; __log.length=0; [...document.querySelectorAll("#stash-model-link-panel button")].find(b=>b.textContent.startsWith("Add this URL")).click()');
    await wait('__log.some(x=>x.startsWith("update:"))');
    assert.ok(await ev('__log.some(x=>x==="update:"+JSON.stringify({id:"300",urls:["https://example.com/nia-live","https://site-ma.brazzers.com/model/65308/nia-nacci"]}))'));
    await stored('cache:v1:performers', v => v === null);

    // Plain scene listing: no model page, no panel, but every page marks what Stash has: scenes by id only
    // (no title search across the collection) and model links by the model id in a saved performer URL.
    await go('/scenes', 'site-ma.brazzers.com');
    await wait('document.querySelectorAll(".stash-model-link-video-badge").length===1');
    assert.equal(await ev('!!document.getElementById("stash-model-link-panel")'), false);
    assert.equal(await ev('document.querySelector(".stash-model-link-video-badge").getAttribute("data-sml-key")'), '70');
    await wait('document.querySelectorAll("a[data-sml-model]").length===3');
    assert.equal(await ev('[...document.querySelectorAll("a[data-sml-model]")].every(a=>a.getAttribute("data-sml-model")==="217" && a.textContent.startsWith("\\u2713 "))'), true);
    // Card tags on Brazzers (title from the scene link): the cards Stash holds by neither id, title nor file name.
    const bzCards = '[...document.querySelectorAll(".e1vusg2z1")].map(c=>c.querySelector(".stash-model-link-video-badge") ? "badge" : c.querySelector(".stash-exists-tag")?.getAttribute("data-stash-via") || "")';
    await wait(bzCards + '.join("|")==="badge|none|none"');
    // A reused card that now shows another scene loses its badge, and its tag follows the new scene.
    await ev('document.querySelectorAll("a[href^=\\"/scene/9001/\\"]").forEach(a=>a.setAttribute("href","/scene/9999/other"))');
    await wait('document.querySelectorAll(".stash-model-link-video-badge").length===0');
    assert.equal(await ev('document.querySelectorAll("[data-sml-video-green]").length'), 0);
    await wait(bzCards + '.join("|")==="none|none|none"');
    assert.equal(await ev('document.querySelector(".e1vusg2z1").dataset.stashQueued'), '9999');
    // Video pages: the scene Stash holds under its BangBros URL answers from the list; one it lacks is asked by the title
    // from the URL (exact title, file name, similar count) and reads "Not in Stash", never "Stash unreachable".
    await go('/scene/9001/bz-cross', 'site-ma.brazzers.com');
    await wait(badgeText + '==="In Stash #70 (url)"');
    assert.equal(await ev('document.getElementById("stash-exists-badge").parentElement.id'), 'userscript-dock');
    await go('/scene/9003/not-in-stash-bz', 'site-ma.brazzers.com');
    await wait(badgeText + '.startsWith("Not in Stash")');
    assert.ok(await ev('__log.includes("lookup:t:not in stash bz") && __log.includes("lookup:p:\\"not%in%stash%bz\\"")'));
    // Two scene links in one element are no card: they get no tag and are not re-queued on every pass (4.1.0 flipped
    // the element between both scenes once a second for as long as the tab was open).
    await ev('window.__flips = 0; new MutationObserver(r => { window.__flips += r.length; }).observe(document.querySelector("nav.sib"), { attributes: true, attributeFilter: ["data-stash-queued"] })');
    await pause(3500);
    assert.equal(await ev('window.__flips'), 0);
    assert.equal(await ev('document.querySelectorAll("nav.sib .stash-exists-tag").length'), 0);

    // Model listing: names from the URL, structural cards, + URL only where the URL is missing.
    await stored('cache:v1:performers', v => !!v); // stored again by the plain listing after the last write
    // The stored performer list is 11 minutes old: its marks show, and it is fetched and stored again.
    gmStore['cache:v1:performers'].at -= 660000;
    await go('/models', 'site-ma.brazzers.com');
    await wait('document.querySelectorAll(".stash-model-link-model-badge").length===2');
    await wait('__log.includes("perfs:1")');
    assert.ok(Date.now() - gmStore['cache:v1:performers'].at < 60000);
    assert.equal(await ev('document.querySelectorAll(".stash-model-link-model-add").length'), 1);
    assert.equal(await ev('document.querySelector(".stash-model-link-model-add").parentElement.innerText.includes("Nia Nacci")'), true);
    assert.equal(await ev('[...document.querySelectorAll(".stash-model-link-model-badge")].every(b=>b.parentElement.classList.contains("css-c"))'), true);

    // Nuxt members area (built in since 4.4.0). A profile saved by 4.1.0 with Tailwind selectors and no card tags is ignored.
    gmStore['profiles:v1'] = { 'holed.com': { v: 1, host: 'holed.com', model: { path: '^/members/models/[^/]+(?:/|$)', nameSel: 'p.text-white.text-xl', linkPrefix: '/members/models/', key: 'slug' }, card: { linkPrefix: '/members/video/', titleSel: 'strong', key: 'slug' } } };
    await go('/members/models/jane-doe', 'holed.com');
    await wait(panel + '.includes("Videos on this page in Stash")');
    // The id lookup asked for holed.com/models/jane-doe and got performer 401 (jane-doe-two contains it): not taken,
    // the name finds Jane Doe.
    assert.ok(await ev('__log.includes("byurl:holed.com/models/jane-doe")'));
    assert.match(await ev(panel), /Found in Stash: Jane Doe \(id 7\)/);
    await wait('(window.__sent || []).some(e => e.event === "started" && e.data.site === "holed")');
    const nxCards = '[...document.querySelectorAll(".card-grid > div")].map(c=>c.querySelector(".stash-model-link-video-badge") ? "badge" : c.querySelector(".stash-exists-tag")?.getAttribute("data-stash-via") || "")';
    // Members links match the tour URL Stash holds (/video/<slug>), the performer's scenes by title; tags sit on the
    // card-grid cards.
    await wait(nxCards + '.join("|")==="badge|badge|none"');
    assert.equal(await ev('document.querySelector(".stash-model-link-video-badge").getAttribute("data-sml-key")'), '80');
    // Badges and tags sit on the grid's direct children (videoCardSel), not on an inner element found by structure.
    assert.equal(await ev('[...document.querySelectorAll(".stash-model-link-video-badge, .stash-exists-tag")].every(b => b.parentElement.parentElement.classList.contains("card-grid"))'), true);
    // The performer saved under an older /girls/ URL and another name is found by that key on the /members/models/ link.
    await wait('!!document.querySelector("a[href=\\"/members/models/holed-girl\\"][data-sml-model=\\"401\\"]")');
    assert.equal(await ev('document.querySelectorAll("a[href=\\"/members/models/jane-doe\\"][data-sml-model=\\"401\\"]").length'), 0);
    // The performer URL added is the tour URL, not the members-area page.
    await ev('[...document.querySelectorAll("#stash-model-link-panel button")].find(b=>b.textContent.startsWith("Add this URL")).click()');
    await wait('__log.some(x=>x.startsWith("update:") && x.includes("holed.com"))');
    assert.ok(await ev('__log.some(x=>x==="update:"+JSON.stringify({id:"7",urls:["https://holed.com/models/jane-doe"]}))'));
    await stored('cache:v1:performers', v => v === null);
    // Video page: the badge goes after the heading link to the current page; tabs below the video are this video.
    await go('/members/video/some-scene', 'holed.com');
    await wait(badgeText + '==="In Stash #80 (url)"');
    assert.equal(await ev('document.getElementById("stash-exists-badge").previousElementSibling.getAttribute("aria-current")'), 'page');
    assert.equal(await ev('[...document.querySelectorAll("[data-stash-queued]")].some(c => c.dataset.stashQueued === "trailer" || c.dataset.stashQueued === "pictures")'), false);
    // Without the heading the title comes from the URL and the badge floats in the dock.
    await go('/members/video/no-heading-here', 'holed.com');
    await wait(badgeText + '.startsWith("Not in Stash")');
    assert.equal(await ev('document.getElementById("stash-exists-badge").parentElement.id'), 'userscript-dock');
    assert.ok(await ev('__log.includes("lookup:t:no heading here")'));
    // The guide on a host whose profile is superseded starts from an empty draft, not from the ignored 4.1.0 picks.
    await ev('__menu["Stash: edit the setup of this site"]()');
    await wait('!!document.getElementById("stash-exists-setup")');
    await stored('setup:v1:holed.com', v => v && v.open && v.draft);
    assert.deepEqual(gmStore['setup:v1:holed.com'].draft, { v: 1, host: 'holed.com' });
    await ev('document.querySelector("#stash-exists-setup [data-setup=close]").click()');
    await stored('setup:v1:holed.com', v => v && v.open === false);
    await stored('cache:v1:performers', v => !!v);
    // Primal Fetish Network: the card's /video/<slug>-<id>.html matches the older /updates/<Title>.html URL in Stash.
    await go('/models/jane-doe-325.html', 'primalfetishnetwork.com');
    await wait(panel + '.includes("Videos on this page in Stash")');
    const pfCards = '[...document.querySelectorAll(".main__videoElement")].map(c=>c.querySelector(".stash-model-link-video-badge") ? "badge" : c.querySelector(".stash-exists-tag")?.getAttribute("data-stash-via") || "")';
    await wait(pfCards + '.join("|")==="badge|none"');
    assert.equal(await ev('document.querySelector(".stash-model-link-video-badge").getAttribute("data-sml-key")'), '81');
    delete gmStore['profiles:v1'];

    // Unknown site: the script runs but stays inert (no Stash request, no log entry, nothing drawn) and only offers the
    // setup guide in the Tampermonkey menu.
    await go('/performer/555/jane-doe', NS);
    await pause(2500);
    assert.deepEqual(await ev('Object.keys(__menu)'), ['Stash: set up this site']);
    assert.deepEqual(await ev('__log'), []);
    assert.deepEqual(await ev('window.__sent || []'), []);
    assert.equal(await ev('!!document.querySelector("#stash-model-link-panel, .stash-model-link-video-badge, #userscript-dock")'), false);
    // The guide: pick the performer name. The pick is captured before the page sees the click.
    const setup = 'document.getElementById("stash-exists-setup")';
    const pick = (kind, target) => ev(`(() => { ${setup}.querySelector("[data-setup=pick-${kind}]").click(); const e = document.querySelector(${JSON.stringify(target)}); for (const t of ["mouseover", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) e.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true })); })()`);
    const draft = () => (gmStore['setup:v1:' + NS] || {}).draft || {};
    await ev('__menu["Stash: set up this site"]()');
    await wait('!!' + setup);
    assert.equal(await ev(setup + '.parentElement.id'), 'userscript-dock');
    await pick('model', 'h1.ProfileName');
    await stored('setup:v1:' + NS, v => v && v.draft && v.draft.model);
    assert.deepEqual(draft().model, [{ path: '^/performer/\\d+/[^/]+(?:/|$)', nameSel: 'h1.ProfileName', linkPrefix: '/performer/', key: 'id', sample: { page: '/performer/555/jane-doe', name: 'Jane Doe' } }]);
    assert.equal(await ev('!!window.__pageClicked'), false, 'the page saw the pick click');
    // A transparent link stretched over a card and a click-through title, as on many members sites: the picker offers
    // the title under the pointer anyway, the arrow keys move to its parent and back, and the click picks the title.
    await ev('(() => { const c = document.querySelectorAll(".tile")[1]; c.style.position = "relative"; const o = document.createElement("a"); o.href = "/watch/80002/hit-by-title"; o.className = "cover"; o.style.cssText = "position:absolute;inset:0;z-index:3"; c.append(o); c.querySelector("h3").style.pointerEvents = "none"; })()');
    await ev(setup + '.querySelector("[data-setup=pick-card]").click()');
    const tip = '(document.querySelector("[data-setup=tip]")?.textContent || "")';
    await ev('(() => { const r = document.querySelectorAll(".tile")[1].querySelector("h3").getBoundingClientRect(); window.dispatchEvent(new MouseEvent("mousemove", { clientX: r.left + 5, clientY: r.top + r.height / 2 })); })()');
    assert.match(await ev(tip), /^h3\.tile-title — Hit By Title/);
    await ev('window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }))');
    assert.match(await ev(tip), /^div\.tile — /);
    await ev('window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }))');
    assert.match(await ev(tip), /^h3\.tile-title/);
    await ev('document.querySelector("a.cover").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))');
    await stored('setup:v1:' + NS, v => v && v.draft && v.draft.card);
    assert.equal(await ev('location.pathname'), '/performer/555/jane-doe', 'the pick click followed the link');
    assert.equal(await ev('!!document.querySelector("[data-setup=box], [data-setup=tip], [data-setup=style]")'), false, 'picker leftovers');
    // The card is found by structure, and its own class is kept because the other cards share it.
    assert.deepEqual(draft().card, [{ linkPrefix: '/watch/', titleSel: 'h3.tile-title', cardSel: 'div.tile', key: 'id', sample: { page: '/performer/555/jane-doe', link: '/watch/80002/hit-by-title', title: 'Hit By Title' } }]);
    await wait(setup + '.innerText.includes("This page links 3 videos that way (keys 80001, 80002, 80003)")');
    // Another example with the same rule is not added twice.
    await pick('card', '.tile:nth-child(3) h3.tile-title');
    await wait(setup + '.innerText.includes("Same rule as an earlier example.")');
    assert.equal(draft().card.length, 1);
    // Class choice on markup from the onboarding logs: BEM names (main__videoTitle) stay, CSS-module hashes
    // (styles_MUaQmnAOb3, Title_title__3xYz1) and state classes (Link--hover) go.
    await ev('(() => { const h = document.createElement("h2"); h.className = "main__videoTitle styles_MUaQmnAOb3 Title_title__3xYz1 Link--hover"; h.textContent = "Class Test"; h.setAttribute("data-class-test", "1"); document.querySelector(".profile").append(h); })()');
    await ev(setup + '.querySelector("[data-setup=pick-listing]").click()');
    await ev('(() => { const r = document.querySelector("[data-class-test]").getBoundingClientRect(); window.dispatchEvent(new MouseEvent("mousemove", { clientX: r.left + 3, clientY: r.top + r.height / 2 })); })()');
    assert.match(await ev(tip), /^h2\.main__videoTitle — Class Test/);
    await ev('window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); document.querySelector("[data-class-test]").remove()');
    // A "model list" pick on a name inside a video card becomes a performer link: a page of videos is no model list.
    await pick('listing', '.tile:nth-child(1) a.star');
    await stored('setup:v1:' + NS, v => v && v.draft && v.draft.performerLink);
    assert.deepEqual(draft().performerLink, [{ linkPrefix: '/performer/', key: 'id', sample: { page: '/performer/555/jane-doe', link: '/performer/555/jane-doe', name: 'Jane Doe' } }]);
    assert.equal(draft().listing, undefined);
    assert.ok(await ev(setup + '.innerText.includes("saved as a performer link")'));
    // Every pick is logged with its page context, URLs without query strings, so support can be built from the log.
    await wait('(window.__sent || []).some(e => e.event === "site onboarding" && e.msg === "card picked")');
    const logged = await ev('__sent.find(e => e.msg === "card picked").data');
    assert.equal(logged.host, NS);
    assert.match(logged.element.html, /tile-title/);
    assert.deepEqual(logged.page.sampleKeys, ['80001', '80002', '80003']);
    assert.ok(logged.element.chain.length >= 2);
    // The guide survives navigation: on a video page, pick its title.
    await go('/watch/80001/ns-title', NS);
    await wait('!!' + setup);
    await pick('video', 'h1.vid-title');
    await stored('setup:v1:' + NS, v => v && v.draft && v.draft.video);
    assert.equal(draft().video[0].path, '^/watch/\\d+/[^/]+(?:/|$)');
    assert.equal(draft().video[0].titleSel, 'h1.vid-title');
    // Card tags on, what Stash holds for the site, export to clipboard and log.
    await ev(setup + '.querySelector("[data-setup=tags]").click()');
    await stored('setup:v1:' + NS, v => v && v.draft && v.draft.tags === true);
    await ev(setup + '.querySelector("[data-setup=survey]").click()');
    await wait(setup + '.innerText.includes("newsite.example: 1 scenes, 0 performers in Stash")');
    assert.ok(await ev(setup + '.innerText.includes("https://tour.newsite.example/video/80001/ns-title \\u2192 key 80001")'));
    await ev(setup + '.querySelector("[data-setup=export]").click()');
    assert.equal(JSON.parse(await ev('__clip')).profile.host, NS);
    await wait('(window.__sent || []).some(e => e.event === "site profile exported" && e.data.profile.card[0].linkPrefix === "/watch/")');
    // Esc cancels a pick without changing the draft.
    await ev(setup + '.querySelector("[data-setup=pick-listing]").click(); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))');
    assert.ok(await ev(setup + '.innerText.includes("Pick cancelled.")'));
    assert.equal(await ev('!!document.querySelector("[data-setup=box]")'), false);
    // Save and turn on: the profile is stored and the site works like a built-in one.
    await ev(setup + '.querySelector("[data-setup=save]").click()');
    await stored('profiles:v1', v => v && v[NS] && v[NS].video);
    await stored('setup:v1:' + NS, v => v && v.open === false);
    await pause(500);
    await go('/performer/555/jane-doe', NS);
    await wait(panel + '.includes("Videos on this page in Stash: 2/3")');
    assert.match(await ev(panel), /Found in Stash: Jane Doe \(id 7\)/);
    assert.equal(await ev('!!' + setup), false, 'the guide stays closed after saving');
    assert.deepEqual(await ev('Object.keys(__menu)'), ['Stash: edit the setup of this site']);
    assert.equal(await ev('!!document.getElementById("stash-model-link-heading-badge")'), true);
    assert.equal(await ev('document.getElementById("stash-model-link-heading-badge").parentElement.className'), 'ProfileName');
    const nsCards = '[...document.querySelectorAll(".tile")].map(c=>c.querySelector(".stash-model-link-video-badge") ? "badge" : c.querySelector(".stash-exists-tag")?.getAttribute("data-stash-via") || "")';
    await wait(nsCards + '.join("|")==="badge|badge|none"');
    // Performer links inside the video cards are marked (green with a check), never with a performer badge on the card.
    await wait('document.querySelectorAll("a.star[data-sml-model=\\"7\\"]").length===3');
    assert.equal(await ev('document.querySelectorAll(".tile .stash-model-link-model-badge").length'), 0);
    await go('/watch/80001/ns-title', NS);
    await wait(badge + '==="In Stash #90 (url)"');
    console.log('browser test OK');
  } catch (e) { console.error('browser test FAILED:', e.message); process.exitCode = 1; }
  finally { pg?.close(); chrome.kill(); await pause(300); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }
})();
