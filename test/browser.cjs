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
window.__confirm = true;
window.confirm = function (m) { __log.push('confirm'); return __confirm; };
window.alert = function (m) { __log.push('alert:' + m); };
window.GM_getValue = function (k, d) { return k in __gm ? JSON.parse(JSON.stringify(__gm[k])) : d; };
window.GM_setValue = function (k, v) { __gm[k] = JSON.parse(JSON.stringify(v)); __gmSet(JSON.stringify([k, v])); };
window.GM_addStyle = function (css) { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); return st; };
// Scenes the single-video lookups (video page badge, card dots) can find; the title "Offline" stands for a Stash that does not answer.
const SCENES = [{ id: '50', title: 'Hit By Url', urls: ['https://app.reptyle.com/movies/100?r=x'] }, { id: '51', title: 'Hit By Title', urls: [] }];
const PERFS = [
  { id: '7', name: 'Jane Doe', alias_list: [], urls: [] },
  { id: '8', name: 'Real Name', alias_list: ['Alias Girl'], urls: ['https://app.reptyle.com/models/2'] },
  { id: '217', name: 'Kenzie Reeves', alias_list: ['Tiny Kenzie'], urls: ['https://site-ma.brazzers.com/model/2717/kenzie-reeves'] },
  { id: '300', name: 'Nia Nacci', alias_list: [], urls: [] },
  { id: '125', name: 'Demi Hawks', alias_list: [], urls: Array.from({ length: 45 }, (_, i) => 'https://example.com/profile/demi-hawks-' + i) }
];
// URLs added in Stash since the lists were read: a write must keep them.
const LIVE_URLS = { '300': ['https://example.com/nia-live'] };
window.GM_xmlhttpRequest = function (o) {
  // Log batches for the local collector (docker-workspace/docs/userscripts.md) are kept for assertions.
  if (o.url === 'http://localhost:7790/v1/logs') { (window.__sent = window.__sent || []).push(...JSON.parse(o.data).entries); setTimeout(() => o.onload({ status: 200, responseText: '{}' }), 1); return; }
  const body = JSON.parse(o.data), q = body.query, v = body.variables || {};
  let data;
  if (/scene_filter:\\$sf/.test(q) && (v.sf.title?.value === 'Offline' || /\\/movies\\/666/.test(v.sf.url?.value || ''))) { __log.push('lookup:offline'); setTimeout(() => o.onerror(), 10); return; }
  if (/performerUpdate/.test(q)) { __log.push('update:' + JSON.stringify(v.input)); data = { performerUpdate: { id: v.input.id, urls: v.input.urls } }; }
  else if (/findPerformer\\(id:/.test(q)) { __log.push('live:' + v.id); const p = PERFS.find(x => x.id === v.id); data = { findPerformer: p ? { urls: (LIVE_URLS[p.id] || []).concat(p.urls) } : null }; }
  else if (/performer_filter:\\{url/.test(q)) { __log.push('byurl:' + v.u); const ps = PERFS.filter(p => p.urls.some(u => u.includes(v.u))); data = { findPerformers: { performers: JSON.parse(JSON.stringify(ps)) } }; }
  else if (/findPerformers\\(filter:\\{q:/.test(q)) { const n = v.q.toLowerCase(); const ps = PERFS.filter(p => [p.name].concat(p.alias_list).some(x => x.toLowerCase().includes(n))); data = { findPerformers: { count: ps.length, performers: JSON.parse(JSON.stringify(ps)) } }; }
  else if (/findPerformers/.test(q)) { __log.push('perfs:' + v.p); data = { findPerformers: { count: PERFS.length, performers: JSON.parse(JSON.stringify(PERFS)) } }; }
  else if (/url:\\{value:\\$h/.test(q)) { __log.push('scenes:' + v.h + ':' + v.p); data = { findScenes: { scenes: v.h === 'brazzers.com/video/' ? [{ id: '70', title: 'BZ Cross', urls: ['https://www.brazzers.com/video/9001/bz-cross'] }] : /brazzers/.test(v.h) ? [] : v.h === '/en/video/' ? [{ id: '60', title: 'Cross Site', urls: ['https://www.evilangel.com/en/video/evilangel/Cross-Site/209586'] }] : [{ id: '50', title: 'Hit By Url', urls: ['https://app.reptyle.com/movies/100?r=x'] }] } }; }
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
  else body = `<h1>Scenes</h1>${bzGrid(2717, 'kenzie-reeves')}`;
  return `<!doctype html><html><head><title>Brazzers</title></head><body><div id="root">${body}</div><script>${stub()}</script><script>${source}</script></body></html>`;
}
function page(p, host, search) {
  if (host === 'site-ma.brazzers.com') return bzPage(p, search);
  if (host === 'members.adulttime.com') return atPage(p);
  let body;
  if (p === '/models') body = `<h1>Models</h1>${model(1, 'Jane Doe')}${model(2, 'Alias Girl')}${model(3, 'Nobody Here')}`;
  else if (p === '/models/2') body = `<div class="model-name-container"><h2>Alias Girl</h2></div>`;
  else if (p.startsWith('/movies/')) body = `<h1>Hit By Url</h1><h2>Related</h2>${card(100, 'Some Other Title')}${card(101, 'Hit By Title')}${card(102, 'Unknown')}`;
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
      if (!['app.reptyle.com', 'members.adulttime.com', 'site-ma.brazzers.com'].includes(u.hostname) || /\.(png|ico)$/.test(u.pathname)) return pg.send('Fetch.failRequest', { requestId: ev.requestId, errorReason: 'BlockedByClient' });
      pg.send('Fetch.fulfillRequest', { requestId: ev.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body: Buffer.from(page(u.pathname, u.hostname, u.search)).toString('base64') });
    });
    await pg.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    pg.on('Runtime.bindingCalled', ev => { const [k, v] = JSON.parse(ev.payload); gmStore[k] = v; });
    await pg.send('Runtime.enable');
    await pg.send('Runtime.addBinding', { name: '__gmSet' });
    await pg.send('Page.enable');
    const ev = async expr => { const r = await pg.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    const wait = async expr => { for (let n = 0; n < 200; n++) { if (await ev(expr)) return; await pause(30); } throw Error('timeout: ' + expr + ' :: ' + await ev('document.body.innerText')); };
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
    assert.equal(gmStore['cache:v1:performers'].items.length, 5);
    assert.equal(gmStore['cache:v1:scenes:app.reptyle.com'].items[0].id, '50');
    // Card dots: an id in the stored scene list answers at once, the other cards are looked up by title and URL.
    const dots = '[...document.querySelectorAll(".stash-card-dot")].map(d=>d.textContent)';
    await wait(dots + '.length===3 && !' + dots + '.includes("?")');
    assert.deepEqual(await ev(dots), ['#50', '#51', 'x']);
    assert.equal(await ev('__log.some(x=>x.startsWith("lookup:") && x.includes("/movies/100"))'), false);
    assert.ok(await ev('__log.includes("lookup:t:Hit By Title")'));
    assert.ok(await ev('__log.includes("fuzzy:Unknown")'));
    // The dot (top right) and the IN STASH badge (top left) of one card do not overlap.
    assert.equal(await ev('(() => { const c = document.querySelector(".movies-thumb-entry"), a = c.querySelector(".stash-model-link-video-badge").getBoundingClientRect(), b = c.querySelector(".stash-card-dot").getBoundingClientRect(); return a.right <= b.left || b.right <= a.left; })()'), true, 'dot and badge overlap');
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
    // Video page badge after the title: exact title and canonical URL both match.
    const badge = '(document.getElementById("stash-exists-badge")?.textContent || "")';
    await wait(badge + '==="In Stash #50 (url+title)"');
    assert.ok(await ev('__log.includes("lookup:u:https://app.reptyle.com/movies/100")'));
    assert.equal(await ev('document.getElementById("stash-exists-badge").href'), 'http://localhost:9999/scenes/50');
    assert.equal(await ev('document.getElementById("stash-exists-badge").previousElementSibling.tagName'), 'H1');
    await wait('(window.__sent || []).some(e => e.event === "detail checked" && e.data.sceneId === "50" && e.data.via === "url+title")');
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
    // Video badge and card dots are Reptyle-only: no other adapter knows its video page DOM.
    assert.equal(await ev('!!document.querySelector(".stash-card-dot, #stash-exists-badge")'), false);
    assert.equal(await ev('!!document.getElementById("stash-model-link-heading-badge")'), false);
    assert.deepEqual(await ev('__log.filter(x=>x.startsWith("scenes:/en"))'), ['scenes:/en/video/:1']);
    await wait(panel + '.includes("Videos on this page in Stash: 2/3")');
    assert.equal(await ev('document.querySelectorAll(".stash-model-link-video-badge").length'), 2);
    assert.equal(await ev('[...document.querySelectorAll(".stash-model-link-video-badge")].every(b=>b.parentElement.classList.contains("ListingGrid-ListingGridItem"))'), true);
    assert.deepEqual(await ev('[...document.querySelectorAll(".stash-model-link-video-badge")].map(b=>b.href.split("/").pop()).sort()'), ['60', '61']);
    assert.deepEqual(await ev('[...document.querySelectorAll("[data-sml-video-green]")].map(e=>e.tagName+":"+e.textContent.replace(/^\\u2713 /,""))').then(x => x.sort()), ['H2:Other Name Here', 'H2:Title Match AT']);
    assert.equal(await ev('[...document.querySelectorAll(".SceneThumb-WithMenu-ChannelName-Link")].some(a=>a.hasAttribute("data-sml-video-green"))'), false);
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
    assert.ok(await ev('__log.includes("scenes:brazzers.com/video/:1")'));
    assert.equal(await ev('!!document.getElementById("stash-model-link-heading-badge")'), true);
    assert.equal(await ev(badges + '.length'), 2);
    assert.equal(await ev('[...' + badges + '].every(b=>b.parentElement.classList.contains("e1vusg2z1"))'), true);
    assert.deepEqual(await ev('[...' + badges + '].map(b=>b.href.split("/").pop()).sort()'), ['61', '70']);
    assert.deepEqual(await ev('GM_getValue("model:brazzers:2717", null)'), { name: 'kenzie reeves', url: 'https://site-ma.brazzers.com/model/2717/kenzie-reeves' });

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
    // A reused card that now shows another scene loses its badge.
    await ev('document.querySelectorAll("a[href^=\\"/scene/9001/\\"]").forEach(a=>a.setAttribute("href","/scene/9999/other"))');
    await wait('document.querySelectorAll(".stash-model-link-video-badge").length===0');
    assert.equal(await ev('document.querySelectorAll("[data-sml-video-green]").length'), 0);

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
    console.log('browser test OK');
  } catch (e) { console.error('browser test FAILED:', e.message); process.exitCode = 1; }
  finally { pg?.close(); chrome.kill(); await pause(300); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }
})();
