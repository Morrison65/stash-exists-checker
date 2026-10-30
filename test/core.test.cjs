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
test('runs on every site (setup guide everywhere) and Stash is the only connect', () => {
    assert.deepEqual(meta.match, ['*://*/*']);
    assert.deepEqual(meta.connect, ['localhost']);
    assert.ok(meta.grant.includes('GM_registerMenuCommand'));
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
const { linkPrefixOf, pathPatternOf, keyModeOf, profileKey, registrableDomain, validProfile, profileSite, ayloTitleFromUrl, gammaTitleFromUrl } = require('../stash-exists-checker.user.js');

// The setup guide derives a site's rules from the pages the user picks on. Acceptance: from sample URLs of the three
// built-in sites it must reproduce what their adapters were written with by hand.
test('picked pages give the link prefixes the built-in adapters use', () => {
    assert.equal(linkPrefixOf('/models/11304'), '/models/');
    assert.equal(linkPrefixOf('/movies/32219'), '/movies/');
    assert.equal(linkPrefixOf('/model/2717/kenzie-reeves', 'Kenzie Reeves'), '/model/');
    assert.equal(linkPrefixOf('/scene/10045231/some-title'), '/scene/');
    assert.equal(linkPrefixOf('/en/pornstar/view/Kenzie-Reeves/49648', 'Kenzie Reeves'), '/en/pornstar/view/');
    assert.equal(linkPrefixOf('/en/video/mommysboy/Be-Polite-To-Our-Guest-Young-Man/209586'), '/en/video/');
    assert.equal(linkPrefixOf('/model/jane', 'Jane'), '/model/', 'a one-word name slug is not part of the prefix');
    assert.equal(linkPrefixOf('/12345/x'), '');
});
test('picked pages give path patterns that keep model and video pages apart', () => {
    const re = (p, n) => new RegExp(pathPatternOf(p, n));
    assert.equal(pathPatternOf('/models/11304'), '^/models/\\d+(?:/|$)');
    assert.equal(pathPatternOf('/model/2717/kenzie-reeves', 'Kenzie Reeves'), '^/model/\\d+/[^/]+(?:/|$)');
    const gammaModel = re('/en/pornstar/view/Kenzie-Reeves/49648', 'Kenzie Reeves');
    assert.ok(gammaModel.test('/en/pornstar/view/Demi-Hawks/53303'));
    assert.ok(!gammaModel.test('/en/video/mommysboy/Some-Title/209586'), 'a model pattern must not match video pages');
    assert.ok(re('/movies/32219').test('/movies/1'));
    assert.ok(!re('/movies/32219').test('/models/1'));
    assert.equal(keyModeOf('/model/2717/kenzie-reeves', '/model/'), 'id');
    assert.equal(keyModeOf('/videos/some-title-slug', '/videos/'), 'slug');
});
test('profile keys read the site links and the tour URLs Stash holds alike', () => {
    const scene = profileKey('site-ma.brazzers.com', '/scene/', 'id');
    assert.equal(scene('/scene/10045231/some-title?x=1'), '10045231');
    assert.equal(scene('https://www.brazzers.com/video/10045231/some-title'), '10045231', 'other hosts are keyed by path alone');
    assert.equal(scene('/model/2717/kenzie-reeves'), null, 'own links outside the prefix are not scenes');
    const slug = profileKey('www.example.com', '/videos/', 'slug');
    assert.equal(slug('/videos/Some-Title.html'), 'some-title');
    assert.equal(slug('https://tour.example.com/video/some-title/'), 'some-title');
    assert.equal(scene('not a url at all', 'x'), null);
    assert.equal(registrableDomain('members.example.com'), 'example.com');
    assert.equal(registrableDomain('a.b.example.co.uk'), 'example.co.uk');
});
// Members areas link /members/video/<slug> while Stash holds the tour URL /video/<slug> on the same host.
const membersProfile = () => ({
    v: 1, host: 'members-site.example',
    model: { path: '^/members/models/[^/]+(?:/|$)', nameSel: 'p.name', linkPrefix: '/members/models/', key: 'slug', sample: { page: '/members/models/jane-doe', name: 'Jane Doe' } },
    card: { linkPrefix: '/members/video/', titleSel: 'strong', key: 'slug' },
    video: { path: '^/members/video/[^/]+(?:/|$)', titleSel: 'h3 a', linkPrefix: '/members/video/', key: 'slug', sample: { page: '/members/video/some-scene', title: 'Some Scene' } },
    // A performer name picked on a video page as "model list" (4.1.0 saved these).
    listing: { path: '^/members/video/some-scene/?$', nameSel: 'a.inline', linkPrefix: '/members/models/', key: 'slug', sample: { page: '/members/video/some-scene', link: '/members/models/jane-doe', name: 'Jane Doe' } },
    tags: true
});
test('members-area prefixes also key the tour URLs Stash holds on the same host', () => {
    const s = profileSite(membersProfile(), null);
    assert.equal(s.sceneKey('/members/video/some-scene'), 'some-scene');
    assert.equal(s.sceneKey('https://members-site.example/video/some-scene'), 'some-scene');
    assert.equal(s.modelKey('https://members-site.example/models/jane-doe'), 'jane-doe');
    assert.equal(s.sceneKey('https://members-site.example/models/jane-doe'), null, 'a tour model URL is no scene');
    assert.equal(s.modelKey('https://members-site.example/video/some-scene'), null);
    assert.equal(s.sceneKey('/members/'), null);
});
test('a slug is the segment right after the prefix, not a tab below the video', () => {
    const s = profileSite(membersProfile(), null);
    assert.equal(s.sceneKey('/members/video/some-scene/trailer'), 'some-scene');
    assert.equal(s.sceneKey('/members/video/some-scene/pictures'), 'some-scene');
    assert.equal(s.sceneKey('https://members-site.example/video/some-scene/'), 'some-scene');
});
test('performer names picked on a video page are performer links, not a model list', () => {
    const s = profileSite(membersProfile(), null);
    assert.ok(!s.listing.test('/members/video/some-scene'), 'a video page is never a model list');
    assert.equal(s.modelNameSel, '');
    assert.equal(s.modelLinkSel, 'a[href*="/members/models/"]');
    // A page of videos (/videos/) is no model list either, with or without a video pick.
    const videos = profileSite({ v: 1, host: 'www.example.com', listing: { path: '^/videos/?$', nameSel: 'span.sub-label', linkPrefix: '/models/', key: 'slug', sample: { page: '/videos/', link: '/models/jane-doe-1.html', name: 'Jane' } } }, null);
    assert.equal(videos.listing.test('/videos/'), false);
    assert.equal(videos.modelLinkSel, 'a[href*="/models/"]');
    // A real model list stays one.
    const models = profileSite({ v: 1, host: 'www.example.com', listing: { path: '^/models/?$', nameSel: 'span.n', linkPrefix: '/models/', key: 'slug', sample: { page: '/models/', link: '/models/jane', name: 'Jane' } } }, null);
    assert.ok(models.listing.test('/models/'));
    assert.equal(models.modelNameSel, 'span.n');
});
const sampleProfile = () => ({
    v: 1, host: 'members.newsite.example',
    model: { path: '^/performer/\\d+/[^/]+(?:/|$)', nameSel: 'h1.ProfileName', linkPrefix: '/performer/', key: 'id' },
    card: { linkPrefix: '/watch/', titleSel: 'h3.tile-title', key: 'id' },
    video: { path: '^/watch/\\d+/[^/]+(?:/|$)', titleSel: 'h1.vid-title', linkPrefix: '/watch/', key: 'id' },
    tags: true
});
test('a saved profile makes an unknown host a supported site with every check', () => {
    const profiles = { 'members.newsite.example': sampleProfile() };
    assert.equal(siteFor('members.newsite.example'), null);
    const s = siteFor('members.newsite.example', profiles);
    assert.equal(s.id, 'profile:members.newsite.example');
    assert.ok(s.detail.test('/performer/555/anna-x'));
    assert.ok(!s.listing.test('/performer/555/anna-x'), 'no model list picked: never a listing');
    assert.equal(s.videoLinkSel, 'a[href*="/watch/"]');
    assert.equal(s.sceneKey('https://tour.newsite.example/video/80001/x'), '80001');
    assert.deepEqual(s.sceneUrlParts, ['newsite.example']);
    assert.ok(s.performerUrlRe.test('https://www.newsite.example/performer/555/anna-x'));
    assert.ok(!s.performerUrlRe.test('https://www.othersite.example/performer/555'));
    assert.ok(s.scenePage.test('/watch/80001/some-title'));
    assert.equal(s.cardTags, true);
    assert.equal(s.strictName, true, 'never falls back to the page title as a performer name');
    // Partial profiles work: a card-only profile marks videos, a model-only one has no scene list to fetch.
    const cardOnly = profileSite({ host: 'x.example', card: { linkPrefix: '/v/', key: 'id' } }, null);
    assert.equal(cardOnly.detail.test('/v/1'), false);
    assert.deepEqual(cardOnly.sceneUrlParts, ['x.example']);
    const modelOnly = profileSite({ host: 'x.example', model: { path: '^/m/\\d+', nameSel: 'h1', linkPrefix: '/m/', key: 'id' } }, null);
    assert.deepEqual(modelOnly.sceneUrlParts, []);
    assert.equal(modelOnly.videoLinkSel, 'a[data-stash-exists-none]');
});
test('on a built-in host a profile changes selectors only, never the keys', () => {
    const at = siteFor('members.adulttime.com');
    const s = siteFor('members.adulttime.com', { 'members.adulttime.com': { v: 1, host: 'members.adulttime.com', video: { path: '^/en/video/[^/]+/[^/]+/\\d+(?:/|$)', titleSel: 'h1.ScenePlayerHeader-SceneTitle' }, card: { linkPrefix: '/x/', titleSel: 'h2.Other' }, tags: false } });
    assert.equal(s.id, 'adulttime');
    assert.equal(s.sceneKey, at.sceneKey);
    assert.equal(s.videoLinkSel, at.videoLinkSel);
    assert.equal(s.videoTitleSel, 'h2.Other');
    assert.ok(s.scenePage.test('/en/video/mommysboy/Title/209586'));
    assert.equal(s.cardTags, false, 'a profile can switch the card tags off');
    assert.equal(at.cardTags, true, 'the built-in adapter itself is not changed');
});
test('DFXtra is a Gamma members site: scene ids shared with every Gamma site, actor ids only from its own URLs', () => {
    const d = siteFor('members.dfxtra.com'), at = siteFor('members.adulttime.com');
    assert.equal(d.id, 'dfxtra');
    assert.equal(d.sceneKey('/en/video/cuckoldsessions/Sit-There-And-Watch/232565'), '232565');
    assert.equal(d.sceneKey('https://www.evilangel.com/en/video/x/Some-Title/232565'), '232565');
    assert.deepEqual(d.sceneUrlParts, at.sceneUrlParts, 'one /en/video/ list for the Gamma network');
    assert.equal(d.modelKey('/en/pornstar/view/Julia-James/123281'), '123281');
    assert.equal(d.nameFromUrl('/en/pornstar/view/Julia-James/123281'), 'Julia James');
    assert.ok(d.performerUrlRe.test('https://www.dfxtra.com/en/pornstar/view/Demi-Hawks/107255'));
    assert.ok(!d.performerUrlRe.test('https://www.adulttime.com/en/pornstar/view/Demi-Hawks/107255'));
    assert.ok(!at.performerUrlRe.test('https://www.dfxtra.com/en/pornstar/view/Demi-Hawks/107255'));
    assert.ok(!d.performerUrlRe.test('https://wwwxdfxtra.com/en/pornstar/view/x/1'), 'the dot in the domain is literal');
});
test('several examples per pick widen the rules; profiles saved with one example still load', () => {
    const two = {
        v: 1, host: 'www.example.com',
        model: [{ path: '^/models/[^/]+(?:/|$)', nameSel: 'h1.performer__name', linkPrefix: '/models/', key: 'slug' }, { path: '^/stars/\\d+(?:/|$)', nameSel: 'h2.star-name', linkPrefix: '/stars/', key: 'id' }],
        card: [{ linkPrefix: '/video/', titleSel: 'a.main__videoTitle', cardSel: 'div.main__videoElement', key: 'slug' }, { linkPrefix: '/clip/', titleSel: 'h3.clip-title', cardSel: 'div.clip', key: 'id' }],
        performerLink: [{ linkPrefix: '/pornstar/', key: 'id' }],
        tags: true
    };
    const s = profileSite(two, null);
    assert.ok(s.detail.test('/models/harlow-west-325.html') && s.detail.test('/stars/12'));
    assert.ok(!s.detail.test('/video/x'));
    assert.equal(s.headingSel, 'h1.performer__name, h2.star-name');
    assert.equal(s.videoLinkSel, 'a[href*="/video/"], a[href*="/clip/"]');
    assert.equal(s.videoTitleSel, 'a.main__videoTitle, h3.clip-title');
    assert.equal(s.videoCardSel, 'div.main__videoElement, div.clip', 'every card pick found a card class');
    assert.equal(s.modelLinkSel, 'a[href*="/models/"], a[href*="/stars/"], a[href*="/pornstar/"]');
    // Each prefix keeps its own key mode; tour URLs on other hosts use the first one.
    assert.equal(s.sceneKey('/video/harlow-west-wrecked-the-car-3585.html'), 'harlow-west-wrecked-the-car-3585');
    assert.equal(s.sceneKey('/clip/77/x'), '77');
    assert.equal(s.sceneKey('/other/1'), null);
    assert.equal(s.modelKey('/pornstar/9/x'), '9');
    assert.equal(s.modelKey('/models/harlow-west-325.html'), 'harlow-west-325');
    // A card pick without a card class keeps structural detection for all cards.
    assert.equal(profileSite({ host: 'www.example.com', card: [{ linkPrefix: '/v/', cardSel: 'div.a' }, { linkPrefix: '/w/' }] }, null).videoCardSel, '');
    // 4.0/4.1 profiles hold single objects; the DFXtra profile saved then loads unchanged.
    const old = { v: 1, host: 'members.newsite.example', model: { path: '^/p/\\d+', nameSel: 'h1', linkPrefix: '/p/', key: 'id' }, card: { linkPrefix: '/watch/', titleSel: 'h3', key: 'id' } };
    assert.equal(validProfile(old), '');
    assert.equal(profileSite(old, null).videoLinkSel, 'a[href*="/watch/"]');
    assert.equal(validProfile(two), '');
    assert.match(validProfile({ host: 'a.example', card: [{ linkPrefix: '/v/' }, { linkPrefix: 'x' }] }), /card\[1\]\.linkPrefix/);
    assert.match(validProfile({ host: 'a.example', card: [{ cardSel: 5 }] }), /cardSel/);
});
test('broken profiles are rejected and ignored', () => {
    assert.equal(validProfile(sampleProfile()), '');
    assert.match(validProfile({}), /host/);
    assert.match(validProfile({ host: 'a.example', model: { path: '(' } }), /regex/);
    assert.match(validProfile({ host: 'a.example', card: { linkPrefix: 'watch' } }), /linkPrefix/);
    assert.match(validProfile({ host: 'a.example', card: { key: 'guid' } }), /key/);
    assert.match(validProfile({ host: 'a.example', stash: { sceneParts: [1] } }), /sceneParts/);
    assert.equal(siteFor('a.example', { 'a.example': { host: 'a.example', model: { path: '(' } } }), null);
});
test('the video badge needs a known video page; card tags run on every built-in site', () => {
    const r = siteFor('app.reptyle.com');
    assert.ok(r.scenePage.test('/movies/29638'));
    assert.ok(!r.scenePage.test('/models/11304'));
    assert.equal(r.sceneTitleSel, 'h1');
    assert.equal(r.cardTags, true);
    // (every video page needs a title element or a title from the URL; checked below)
    assert.deepEqual(SITES.filter(s => s.scenePage).map(s => s.id), ['reptyle', 'adulttime', 'dfxtra', 'aylo']);
    assert.deepEqual(SITES.filter(s => s.sceneTitleSel).map(s => s.id), ['reptyle'], 'title element known on Reptyle only; elsewhere the title comes from the URL until one is picked');
    for (const s of SITES) if (s.scenePage && !s.sceneTitleSel) assert.equal(typeof s.sceneTitleFromUrl, 'function', s.id + ' needs a title source');
    const at = siteFor('members.adulttime.com');
    assert.ok(at.scenePage.test('/en/video/mommysboy/Be-Polite-To-Our-Guest-Young-Man/209586'));
    assert.ok(!at.scenePage.test('/en/videos/'));
    assert.equal(gammaTitleFromUrl('/en/video/mommysboy/Be-Polite-To-Our-Guest-Young-Man/209586'), 'Be Polite To Our Guest Young Man');
    assert.equal(gammaTitleFromUrl('https://www.evilangel.com/en/video/Anally-Talented-03/67506'), 'Anally Talented 03');
    assert.equal(gammaTitleFromUrl('/en/video/Room-101-Part-2'), '');
    assert.deepEqual(SITES.filter(s => s.cardTags).map(s => s.id), ['reptyle', 'adulttime', 'dfxtra', 'aylo'], 'card titles are known on every built-in site');
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
test('aylo adapter: one scene id across the whole network, members links match tour URLs of every brand', () => {
    const b = siteFor('site-ma.brazzers.com');
    assert.equal(b.id, 'aylo');
    assert.equal(siteFor('site-ma.bangbros.com').id, 'aylo');
    assert.equal(siteFor('site-ma.realitykings.com').id, 'aylo');
    assert.ok(b.detail.test('/model/2717/kenzie-reeves'));
    assert.ok(!b.detail.test('/models'));
    assert.ok(b.listing.test('/models'));
    assert.equal(b.sceneKey('/scene/10045231/some-title'), '10045231');
    assert.equal(b.sceneKey('https://www.brazzers.com/video/10045231/some-title'), '10045231');
    assert.equal(b.sceneKey('https://brazzersnetwork.com/video/7/x'), '7');
    // A Brazzers members scene that Stash holds under its BangBros tour URL (same release id) is the same scene.
    assert.equal(b.sceneKey('https://bangbros.com/video/11356971/stepdaughter-anal-fantasy'), '11356971');
    assert.equal(b.sceneKey('https://www.realitykings.com/scene/5112233/x'), '5112233');
    assert.equal(b.sceneKey('https://www.letsdoeit.com/watch/123/x'), '123');
    assert.equal(b.sceneKey('https://www.bangbrothers.example/video/10045231/x'), null, 'look-alike hosts are not Aylo');
    assert.equal(b.sceneKey('https://evilbrazzers.com.example/video/1/x'), null);
    // The one Stash list for the network: a Go regex (case-insensitive flag) over every Aylo domain.
    const part = b.sceneUrlParts[0], re = new RegExp(part.regex.replace('(?i)', ''), 'i');
    assert.equal(part.name, 'aylo');
    assert.ok(part.regex.startsWith('(?i)^https?://'));
    assert.ok(re.test('https://bangbros.com/video/11356971/stepdaughter-anal-fantasy'));
    assert.ok(re.test('https://www.Brazzers.com/video/1/x'));
    assert.ok(!re.test('https://www.evilangel.com/en/video/x/1'));
    assert.ok(!re.test('https://notbrazzers.com/video/1/x'), 'domain names are whole');
    assert.equal(b.sceneKey('/model/2717/kenzie-reeves'), null);
    assert.equal(b.modelKey('/model/2717/kenzie-reeves'), '2717');
    assert.equal(b.modelKey('https://www.brazzers.com/pornstar/2717/kenzie-reeves'), '2717');
    assert.equal(b.modelUrl('https://site-ma.brazzers.com', '2717', '/model/2717/kenzie-reeves?x=1'), 'https://site-ma.brazzers.com/model/2717/kenzie-reeves');
    assert.deepEqual(b.performerUrlParts('65308'), ['brazzers.com/model/65308/', 'brazzers.com/pornstar/65308/', 'brazzers.com/modelprofile/65308/', 'brazzersnetwork.com/pornstar/65308/']);
    assert.deepEqual(b.performerUrlParts('9', 'site-ma.bangbros.com').slice(0, 3), ['bangbros.com/model/9/', 'bangbros.com/pornstar/9/', 'bangbros.com/modelprofile/9/'], 'the members brand first');
    assert.ok(b.performerUrlRe.test('https://www.bangbros.com/model/9/x'));
    assert.equal(b.modelKey('https://www.realitykings.com/model/77/x'), '77');
    // The video page: id and title from the URL (no title element is known), badge floating.
    assert.ok(b.scenePage.test('/scene/11356971/stepdaughter-anal-fantasy'));
    assert.equal(b.sceneTitleSel, undefined);
    assert.equal(ayloTitleFromUrl('/scene/11356971/stepdaughter-anal-fantasy'), 'stepdaughter anal fantasy');
    assert.equal(ayloTitleFromUrl('/scene/11356971'), '');
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
test('lookup finds a scene by file name when neither URL nor title match', async () => {
    const sent = [];
    stash((body) => {
        if (!body.variables.sf || !body.variables.sf.path) return scenes([]);
        sent.push(body.variables.sf.path);
        return scenes([
            { id: '32', title: 'Other', urls: [], files: [{ basename: 'Two Cougars and more.mp4' }] },
            { id: '33', title: '', urls: [], files: [{ basename: 'Two Cougars, One Cub - Krystal and Lexi (Part 1).mp4' }] }
        ]);
    });
    const res = await lookupVideo({ title: 'Two Cougars, One Cub: Krystal and Lexi', url: 'https://app.reptyle.com/movies/14', fuzzy: false });
    assert.deepEqual(sent, [{ value: '"two%cougars%one%cub%krystal%and%lexi"', modifier: 'INCLUDES' }], 'one quoted LIKE pattern, words in order');
    assert.equal(res.best.id, '33', 'the file name must hold the whole title, not only some words');
    assert.equal(res.via, 'file');
    const short = await lookupVideo({ title: 'Part 1', url: 'https://app.reptyle.com/movies/15', fuzzy: false });
    assert.equal(sent.length, 1, 'short titles get no file lookup');
    assert.equal(short.best, null);
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
