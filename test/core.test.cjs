const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '..', 'stash-exists-checker.user.js');
const source = fs.readFileSync(file, 'utf8');
const pkg = require('../package.json');
const header = /==UserScript==([\s\S]*?)==\/UserScript==/.exec(source)[1];
const meta = {};
for (const [, key, value] of header.matchAll(/^\/\/ @(\S+)\s*(.*)$/gm)) (meta[key] ||= []).push(value.trim());

test('metadata is complete and versions agree', () => {
    for (const key of ['name', 'namespace', 'version', 'description', 'match', 'grant', 'connect']) assert.ok(meta[key], key + ' is missing');
    assert.equal(meta.version[0], pkg.version);
    assert.equal(require(file).VERSION, pkg.version);
    assert.equal(pkg.name + '.user.js', path.basename(file));
});
test('Sider runtime leftovers are gone', () => {
    assert.equal(meta['bound-url'], undefined);
    assert.equal(meta.changelog, undefined);
    assert.doesNotMatch(source, /siderRuntime|\?r=[0-9a-f]{8}/);
});
test('every GM API used is granted and every grant is used', () => {
    const code = source.replace(/^\/\/.*$/gm, '');
    for (const api of new Set(code.match(/\bGM_[A-Za-z]+/g) || [])) assert.ok(meta.grant.includes(api), api + ' is used but not granted');
    for (const api of meta.grant) assert.match(code, new RegExp('\\b' + api + '\\b'), api + ' is granted but unused');
});

const { SITES, siteFor, normUrl, normTitle, normName, extractMovieId, extractModelId, extractGammaSceneId, extractGammaActorId, gammaNameFromUrl, ayloNameFromUrl, modelIdFromParam, modelNameFromParam, cachedList } = require('../stash-exists-checker.user.js');

test('updates come from the raw file on master', () => {
    const raw = 'https://raw.githubusercontent.com/Morrison65/' + pkg.name + '/master/' + pkg.name + '.user.js';
    assert.deepEqual(meta.updateURL, [raw]);
    assert.deepEqual(meta.downloadURL, [raw]);
});
test('every adapter host has a whole-site @match and Stash is the only connect', () => {
    const hosts = SITES.flatMap(s => s.hosts);
    assert.deepEqual([...meta.match].sort(), hosts.map(h => 'https://' + h + '/*').sort());
    assert.deepEqual(meta.connect, ['localhost']);
});
test('adapters are complete and ids are unique', () => {
    const fields = ['id', 'hosts', 'detail', 'listing', 'videoLinkSel', 'modelLinkSel', 'sceneUrlParts', 'sceneKey', 'modelKey', 'modelUrl'];
    // Empty card selectors are allowed: they switch to structural card detection.
    const selectors = ['videoCardSel', 'modelCardSel', 'modelEntrySel', 'modelNameSel'];
    for (const s of SITES) {
        for (const f of fields) assert.ok(s[f], s.id + ' lacks ' + f);
        for (const f of selectors) assert.equal(typeof s[f], 'string', s.id + ' needs ' + f + ' (may be empty)');
        if (s.modelParam) assert.equal(typeof s.performerUrlParts, 'function', s.id + ' filters by model id but cannot look it up');
        assert.equal(typeof s.anchorSel, 'string', s.id + ' needs anchorSel (empty for a floating panel)');
        assert.ok(s.anchorSel || s.nameFromUrl, s.id + ' needs an anchor or nameFromUrl to find the name');
    }
    assert.equal(new Set(SITES.map(s => s.id)).size, SITES.length);
});
test('the adapter is chosen by host, subdomains included, look-alikes excluded', () => {
    assert.equal(siteFor('app.reptyle.com').id, 'reptyle');
    assert.equal(siteFor('APP.REPTYLE.COM').id, 'reptyle');
    assert.equal(siteFor('x.app.reptyle.com').id, 'reptyle');
    assert.equal(siteFor('evilapp.reptyle.com'), null);
    assert.equal(siteFor('reptyle.com'), null);
    assert.equal(siteFor(''), null);
});
test('reptyle adapter keys pages, scenes and models', () => {
    const r = siteFor('app.reptyle.com');
    assert.ok(r.detail.test('/models/11304'));
    assert.ok(!r.detail.test('/models'));
    assert.ok(r.listing.test('/models/'));
    assert.equal(r.sceneKey('https://app.reptyle.com/movies/32219?r=x'), '32219');
    assert.equal(r.modelKey('/models/11304/'), '11304');
    assert.equal(r.modelUrl('https://app.reptyle.com', '11304'), 'https://app.reptyle.com/models/11304');
});
test('only adapters with a known video page DOM get the video badge and card dots', () => {
    const r = siteFor('app.reptyle.com');
    assert.ok(r.scenePage.test('/movies/29638'));
    assert.ok(!r.scenePage.test('/models/11304'));
    assert.equal(r.sceneTitleSel, 'h1');
    assert.equal(r.cardDots, true);
    for (const s of SITES) if (s.scenePage) assert.equal(typeof s.sceneTitleSel, 'string', s.id + ' needs sceneTitleSel');
    assert.deepEqual(SITES.filter(s => s.scenePage || s.cardDots).map(s => s.id), ['reptyle']);
});
test('ids come from movie and model links only', () => {
    assert.equal(extractMovieId('https://app.reptyle.com/movies/32219?r=x'), '32219');
    assert.equal(extractMovieId('/models/11304'), null);
    assert.equal(extractModelId('/models/11304/'), '11304');
    assert.equal(extractModelId('/movies/1'), null);
    assert.equal(extractModelId(null), null);
});
test('adult time adapter: detail and listing paths, scene ids shared across Gamma sites', () => {
    const at = siteFor('members.adulttime.com');
    assert.equal(at.id, 'adulttime');
    assert.ok(at.detail.test('/en/pornstar/view/Kenzie-Reeves/49648'));
    assert.ok(at.detail.test('/de/pornstar/Kenzie-Reeves/49648'));
    assert.ok(!at.detail.test('/en/pornstars'));
    assert.ok(at.listing.test('/en/pornstars'));
    assert.equal(at.sceneKey('https://members.adulttime.com/en/video/mommysboy/Be-Polite-To-Our-Guest-Young-Man/209586'), '209586');
    assert.equal(at.sceneKey('https://www.evilangel.com/en/video/Anally-Talented-03/67506'), '67506');
    assert.equal(at.sceneKey('/en/video/sample/1020/?utm=x'), '1020');
    assert.equal(at.sceneKey('/en/video/Room-101-Part-2'), null);
    assert.equal(at.modelKey('/en/pornstar/view/Kenzie-Reeves/49648'), '49648');
    assert.equal(at.modelUrl('https://members.adulttime.com', '49648', '/en/pornstar/view/Kenzie-Reeves/49648/'), 'https://members.adulttime.com/en/pornstar/view/Kenzie-Reeves/49648');
    assert.deepEqual(at.sceneUrlParts, ['/en/video/']);
});
test('gamma helpers read names and ids from URLs', () => {
    assert.equal(gammaNameFromUrl('/en/pornstar/view/Kenzie-Reeves/49648'), 'Kenzie Reeves');
    assert.equal(gammaNameFromUrl('/en/pornstar/view/Sof%C3%ADa-Lee/1'), 'Sof\u00eda Lee');
    assert.equal(gammaNameFromUrl('/en/pornstar/view/name/88709'), '');
    assert.equal(gammaNameFromUrl('/en/pornstar/view/-/48477'), '');
    assert.equal(gammaNameFromUrl('/en/video/x/1'), '');
    assert.equal(extractGammaActorId('https://www.evilangel.com/en/pornstar/view/34290'), '34290');
    assert.equal(gammaNameFromUrl('https://www.evilangel.com/en/pornstar/view/34290'), '');
    assert.equal(normTitle('Sofía in Café Olé'), 'sofia in cafe ole');
    assert.equal(extractGammaSceneId(null), null);
});
test('brazzers adapter: members ids match tour URLs in Stash, other networks do not', () => {
    const b = siteFor('site-ma.brazzers.com');
    assert.equal(b.id, 'brazzers');
    assert.ok(b.detail.test('/model/2717/kenzie-reeves'));
    assert.ok(!b.detail.test('/models'));
    assert.ok(b.listing.test('/models'));
    assert.equal(b.sceneKey('/scene/10045231/some-title'), '10045231');
    assert.equal(b.sceneKey('https://www.brazzers.com/video/10045231/some-title'), '10045231');
    assert.equal(b.sceneKey('https://brazzersnetwork.com/video/7/x'), '7');
    assert.equal(b.sceneKey('https://www.bangbros.com/video/10045231/x'), null);
    assert.equal(b.sceneKey('https://evilbrazzers.com.example/video/1/x'), null);
    assert.equal(b.sceneKey('/model/2717/kenzie-reeves'), null);
    assert.equal(b.modelKey('/model/2717/kenzie-reeves'), '2717');
    assert.equal(b.modelKey('https://www.brazzers.com/pornstar/2717/kenzie-reeves'), '2717');
    assert.equal(b.modelUrl('https://site-ma.brazzers.com', '2717', '/model/2717/kenzie-reeves?x=1'), 'https://site-ma.brazzers.com/model/2717/kenzie-reeves');
    assert.deepEqual(b.performerUrlParts('65308'), ['brazzers.com/model/65308/', 'brazzers.com/pornstar/65308/', 'brazzersnetwork.com/pornstar/65308/']);
    assert.equal(ayloNameFromUrl('/model/2717/kenzie-reeves'), 'kenzie reeves');
    assert.equal(normName(ayloNameFromUrl('/model/2717/kenzie-reeves')), normName('Kenzie Reeves'));
});
test('a page filtered to one model id counts as that model page', () => {
    assert.equal(modelIdFromParam('?addon=162%2C5971%2C5951&models=65308', 'models'), '65308');
    assert.equal(modelIdFromParam('?models=65308%2C2717', 'models'), null);
    assert.equal(modelIdFromParam('?models=', 'models'), null);
    assert.equal(modelIdFromParam('?addon=1', 'models'), null);
    assert.equal(modelIdFromParam('?models=1', undefined), null);
});
test('adult time "See all" pages are filtered to one model by name', () => {
    const at = siteFor('members.adulttime.com');
    const seeAll = '?sortBy=all_scenes_latest_desc&refinementList%5Bactors.name%5D%5B0%5D=Demi%20Hawks&fromSeeAll=1';
    assert.equal(modelNameFromParam(seeAll, at.modelNameParam), 'Demi Hawks');
    assert.equal(modelNameFromParam(seeAll + '&refinementList%5Bactors.name%5D%5B1%5D=Other', at.modelNameParam), null);
    assert.equal(modelNameFromParam('?sortBy=x', at.modelNameParam), null);
    assert.equal(modelNameFromParam(seeAll, undefined), null);
});
test('URL comparison ignores trailing slashes and padding', () => {
    assert.equal(normUrl(' https://app.reptyle.com/models/1// '), 'https://app.reptyle.com/models/1');
    assert.equal(normUrl(undefined), '');
});
test('title normalisation folds quotes, accents and punctuation', () => {
    assert.equal(normTitle('Caf\u00e9 \u2018Night\u2019 \u2013 Part  2!'), normTitle("cafe 'night' part 2"));
    assert.equal(normTitle(null), '');
});
test('model names compare without case, accents or punctuation', () => {
    assert.equal(normName('  Jane DOE '), 'jane doe');
    assert.equal(normName('Anna-Belle'), normName('anna belle'));
    assert.equal(normName('Sof\u00eda Lee'), 'sofia lee');
});
// Shared Stash lists: a fake store stands in for Tampermonkey storage.
function memStore(entries = {}) { return { entries, set: (n, e) => { entries[n] = e; }, get: n => entries[n] ?? null }; }
function counted(items, fail) { const f = () => { f.calls++; return fail ? Promise.reject(new Error('down')) : Promise.resolve(items); }; f.calls = 0; return f; }
test('a fresh stored list is used without asking Stash', async () => {
    const store = memStore({ p: { at: Date.now() - 1000, items: ['stored'] } }), fetchFn = counted(['fresh']), used = [];
    const get = cachedList(store, 'p', fetchFn, items => used.push(items));
    await get(); await get();
    assert.equal(fetchFn.calls, 0);
    assert.deepEqual(used, [['stored']]);
});
test('a missing list is fetched once and stored for the next page', async () => {
    const store = memStore(), fetchFn = counted(['fresh']), used = [];
    const get = cachedList(store, 'p', fetchFn, items => used.push(items));
    await Promise.all([get(), get()]);
    assert.equal(fetchFn.calls, 1);
    assert.deepEqual(used, [['fresh']]);
    assert.deepEqual(store.entries.p.items, ['fresh']);
    assert.ok(Date.now() - store.entries.p.at < 1000);
    const next = counted(['other']);
    await cachedList(store, 'p', next, () => {})();
    assert.equal(next.calls, 0);
});
test('a stale list serves at once while it is refetched', async () => {
    const store = memStore({ p: { at: Date.now() - 700000, items: ['stale'] } }), fetchFn = counted(['fresh']), used = [];
    const get = cachedList(store, 'p', fetchFn, items => used.push(items));
    const pending = get();
    assert.deepEqual(used, [['stale']]);
    await pending;
    await new Promise(r => setTimeout(r, 0));
    assert.equal(fetchFn.calls, 1);
    assert.deepEqual(used, [['stale'], ['fresh']]);
    assert.deepEqual(store.entries.p.items, ['fresh']);
});
test('dropped, malformed or day-old lists are refetched', async () => {
    for (const entry of [null, { at: Date.now(), items: 'x' }, { items: [] }, { at: Date.now() - 90000000, items: ['old'] }]) {
        const fetchFn = counted(['fresh']), used = [];
        await cachedList(memStore({ p: entry }), 'p', fetchFn, items => used.push(items))();
        assert.equal(fetchFn.calls, 1);
        assert.deepEqual(used, [['fresh']]);
    }
});
test('a failed fetch is not stored and not retried at once', async () => {
    const store = memStore(), fetchFn = counted(null, true);
    const get = cachedList(store, 'p', fetchFn, () => assert.fail('nothing to use'));
    await assert.rejects(get(), /down/);
    await assert.rejects(get(), /down/);
    assert.equal(fetchFn.calls, 1);
    assert.equal(store.entries.p, undefined);
});

// Single-video lookups (video page badge and card dots).
const { norm, canonUrl, lookupVideo } = require('../stash-exists-checker.user.js');

test('norm collapses whitespace runs and case', () => {
    assert.equal(norm('  Foo   BAR\tbaz\n'), 'foo bar baz');
    assert.equal(norm(null), '');
});
test('canonUrl strips query, hash and whitespace', () => {
    assert.equal(canonUrl(' https://app.reptyle.com/movies/1?r=abc#x '), 'https://app.reptyle.com/movies/1');
    assert.equal(canonUrl(''), '');
    assert.equal(canonUrl(undefined), '');
});

// Stands in for Tampermonkey's GM_xmlhttpRequest; the handler gets the parsed GraphQL request body.
function stash(handler) {
    global.GM_xmlhttpRequest = (opts) => {
        const body = JSON.parse(opts.data);
        Promise.resolve(handler(body)).then((result) => {
            if (result instanceof Error) opts.onerror();
            else opts.onload({ status: result.status || 200, responseText: JSON.stringify(result.json) });
        });
    };
}
const scenes = (list) => ({ json: { data: { findScenes: { count: list.length, scenes: list } } } });

test('lookup matches by canonical URL and title and reports both', async () => {
    const scene = { id: '7', title: 'Some  Title', urls: ['https://app.reptyle.com/movies/10?x=1'] };
    stash(() => scenes([scene]));
    const res = await lookupVideo({ title: 'some title', url: 'https://app.reptyle.com/movies/10?r=zz' });
    assert.equal(res.best.id, '7');
    assert.equal(res.via, 'url+title');
});
test('lookup falls back to a fuzzy count when nothing matches', async () => {
    stash((body) => (body.variables.q ? scenes([{ id: '1', title: 'x', urls: [] }, { id: '2', title: 'y', urls: [] }]) : scenes([])));
    const res = await lookupVideo({ title: 'Unknown', url: 'https://app.reptyle.com/movies/11' });
    assert.equal(res.best, null);
    assert.equal(res.similar, 2);
});
test('unreachable Stash is an error, never a false "Not in Stash", and is retried', async () => {
    stash(() => new Error('down'));
    const failed = await lookupVideo({ title: 'Offline', url: 'https://app.reptyle.com/movies/12' });
    assert.ok(failed.error);
    stash(() => scenes([{ id: '9', title: 'Offline', urls: [] }]));
    const retried = await lookupVideo({ title: 'Offline', url: 'https://app.reptyle.com/movies/12' });
    assert.equal(retried.best.id, '9');
});
test('HTTP errors from Stash count as failures', async () => {
    stash(() => ({ status: 500, json: {} }));
    const res = await lookupVideo({ title: 'Broken', url: 'https://app.reptyle.com/movies/13' });
    assert.match(res.error, /Stash HTTP 500/);
});

const { logPage, createLogSink } = require('../stash-exists-checker.user.js');

// Shared log sink contract (docker-workspace/docs/userscripts.md); the send stub stands in for GM_xmlhttpRequest.
test('logPage keeps host and path only', () => {
    assert.equal(logPage('https://app.reptyle.com/movies/1?r=abc#x'), 'app.reptyle.com/movies/1');
    assert.equal(logPage('not a url'), '');
});
test('log sink batches structured entries and keeps them while the collector is down', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const sent = [];
    let up = false;
    const sink = createLogSink({ script: 'test-script', version: '1.2.3', page: () => 'host/path', send: (batch, done) => { if (up) sent.push(...batch); done(up); } });
    sink.log('info', 'started');
    sink.log('error', 'lookup failed', 'timeout', { status: 0 });
    assert.equal(sink.pending(), 2);
    t.mock.timers.tick(2000);
    assert.equal(sink.pending(), 2, 'a failed send keeps the batch');
    up = true;
    t.mock.timers.tick(5000);
    assert.equal(sink.pending(), 0);
    assert.deepEqual(sent.map((e) => [e.level, e.event, e.msg, e.seq]), [['info', 'started', undefined, 1], ['error', 'lookup failed', 'timeout', 2]]);
    const [first, second] = sent;
    assert.equal(first.script, 'test-script');
    assert.equal(first.version, '1.2.3');
    assert.equal(first.page, 'host/path');
    assert.equal(first.session, second.session);
    assert.deepEqual(second.data, { status: 0 });
    assert.match(first.ts, /^\d{4}-\d\d-\d\dT/);
});
test('log sink flushes full batches at once and caps its buffer at 500', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const batches = [];
    const sink = createLogSink({ script: 's', version: '1', page: () => '', send: (batch, done) => { batches.push(batch.length); done(false); } });
    for (let i = 0; i < 50; i++) sink.log('debug', 'e' + i);
    assert.deepEqual(batches, [50], 'the 50th entry sends without waiting');
    for (let i = 0; i < 600; i++) sink.log('debug', 'more');
    assert.equal(sink.pending(), 500);
    assert.deepEqual(batches, [50], 'no request storm while the collector is down');
});
