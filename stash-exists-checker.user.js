// ==UserScript==
// @name         Stash Exists Checker - Reptyle
// @namespace    local.stash-exists-checker
// @version      4.0.0
// @description  Shows what is already in local Stash (localhost:9999): a badge on video pages and cards, the Stash performer match with an add-URL button and Stash link on model pages, and in-Stash marks on models and videos. Built in: Reptyle, Adult Time, Brazzers; any other site can be set up from the Tampermonkey menu by picking the performer name and video titles on its pages.
// @match        *://*/*
// @updateURL    https://raw.githubusercontent.com/Morrison65/stash-exists-checker/master/stash-exists-checker.user.js
// @downloadURL  https://raw.githubusercontent.com/Morrison65/stash-exists-checker/master/stash-exists-checker.user.js
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @connect      localhost
// @noframes
// ==/UserScript==

/* global module:readonly */

(function () {
  'use strict';
  const VERSION = '4.0.0';
  // One adapter per site or network: everything page-specific lives here, the core below is generic. Sites set up with the
  // picker are stored as JSON profiles and turned into the same adapter shape by profileSite (see "Site profiles" below).
  // hosts: page hosts the adapter runs on. detail/listing: model page paths.
  // anchorSel: the panel goes after it; empty means a floating panel. nameFromUrl (optional): model name from a path, tried first.
  // videoTitleSel (optional): the title element in a video card when the title is not the text of a scene link.
  // videoCardSel/modelCardSel empty: a card is the largest ancestor of a link that still holds only that one scene or model.
  // modelParam / modelNameParam (optional): a query parameter that filters a page to one model by id (?models=<id>) or by name;
  // such a page counts as that model's page.
  // performerUrlParts(id) (optional): URL fragments that find the performer in Stash by the site's model id, before any name search.
  // performerUrlRe (optional): which saved performer URLs carry this site's model ids (modelKey is applied only to those).
  // sceneUrlParts: URL fragments that select this site's scenes in Stash; sceneKey/modelKey reduce a URL to the id both sides share.
  // scenePage/sceneTitleSel (optional): video page path and its title element; the page gets a badge from lookupVideo.
  // cardTags (optional): every video card with a title gets a corner tag: IN STASH (by URL), IN STASH · TITLE, IN STASH · FILE or NOT IN STASH.
  var SITES = [{
    id: 'reptyle',
    hosts: ['app.reptyle.com'],
    detail: /^\/models\/\d+/,
    listing: /^\/models\/?$/,
    headingSel: '.model-name-container h2',
    anchorSel: '.model-name-container',
    headingFallbackSel: 'h2',
    nameSkip: /featured in/i,
    titleSep: '|',
    videoCardSel: '.movies-thumb-entry',
    videoLinkSel: 'a[href*="/movies/"]',
    modelLinkSel: 'a[href*="/models/"]',
    modelCardSel: '.ant-card',
    modelEntrySel: '.models-grid-entry',
    modelNameSel: '.ant-card-meta-description span',
    sceneUrlParts: ['app.reptyle.com'],
    sceneKey: extractMovieId,
    modelKey: extractModelId,
    modelUrl: function (origin, key) { return origin + '/models/' + key; },
    performerUrlRe: /^https?:\/\/app\.reptyle\.com\//i,
    scenePage: /^\/movies\/\d+/,
    sceneTitleSel: 'h1',
    cardTags: true
  }, {
    // Gamma network members area. A scene keeps its numeric id on every Gamma site (adulttime, evilangel, puretaboo ...),
    // so all /en/video/ URLs in Stash count. The members DOM is only partly known: the name comes from the URL,
    // the panel floats, and cards are the outermost elements around exactly one scene link.
    id: 'adulttime',
    hosts: ['members.adulttime.com'],
    detail: /^\/[a-z]{2}\/pornstar\/(?:view\/)?[^/]+\/\d+/i,
    listing: /^\/[a-z]{2}\/pornstars\/?$/i,
    headingSel: 'h1',
    anchorSel: '',
    headingFallbackSel: 'h1',
    nameFromUrl: gammaNameFromUrl,
    // "See all" on a pornstar page opens /en/videos?refinementList[actors.name][0]=<Name>.
    modelNameParam: 'refinementList[actors.name][0]',
    videoCardSel: '.ListingGrid-ListingGridItem, [class*="SceneThumb"]',
    videoLinkSel: 'a[href*="/video/"]',
    // Members cards: the scene link wraps only the image, the title is a plain h2.Title next to a channel link.
    videoTitleSel: 'h2.Title, [class*="SceneTitle"]',
    modelLinkSel: 'a[href*="/pornstar/"]',
    modelCardSel: '.ListingGrid-ListingGridItem, [class*="ActorThumb"]',
    modelEntrySel: '.ListingGrid-ListingGridItem',
    modelNameSel: '[class*="ActorThumb-Name"], [class*="ActorName"]',
    sceneUrlParts: ['/en/video/'],
    sceneKey: extractGammaSceneId,
    modelKey: extractGammaActorId,
    modelUrl: function (origin, key, href) { var u = new URL(href, origin); return u.origin + u.pathname.replace(/\/+$/, ''); },
    // Gamma actor ids differ between Gamma sites, so only Adult Time's own URLs count.
    performerUrlRe: /^https?:\/\/(?:[a-z0-9-]+\.)?adulttime\.com\//i,
    // Members cards rarely have a Stash URL (Stash holds the tour URLs of many Gamma sites): tags also match by title and file.
    cardTags: true
  }, {
    // Aylo members area. Members links are /scene/<id>/<slug> and /model/<id>/<slug>; Stash mostly holds the tour URLs
    // brazzers.com/video/<id>/<slug> and brazzers.com/pornstar/<id>/<slug>, with the same ids. Classes are build hashes,
    // so cards are found by structure.
    id: 'brazzers',
    hosts: ['site-ma.brazzers.com'],
    detail: /^\/model\/\d+/,
    listing: /^\/models\/?$/,
    modelParam: 'models',
    headingSel: 'h1',
    anchorSel: '',
    headingFallbackSel: 'h2',
    nameFromUrl: ayloNameFromUrl,
    videoCardSel: '',
    videoLinkSel: 'a[href*="/scene/"], a[href*="/video/"]',
    modelLinkSel: 'a[href*="/model/"]',
    modelCardSel: '',
    modelEntrySel: '',
    modelNameSel: '',
    sceneUrlParts: ['brazzers.com/video/', 'brazzers.com/scene/', 'brazzersnetwork.com/video/', 'brazzersvr.com/video/'],
    sceneKey: ayloId(/(^|\.)brazzers(network|vr)?\.com$/, 'video|scene'),
    modelKey: ayloId(/(^|\.)brazzers(network|vr)?\.com$/, 'model|pornstar'),
    modelUrl: function (origin, key, href) { var u = new URL(href, origin); return u.origin + u.pathname.replace(/\/+$/, ''); },
    performerUrlParts: function (id) { return ['brazzers.com/model/' + id + '/', 'brazzers.com/pornstar/' + id + '/', 'brazzersnetwork.com/pornstar/' + id + '/']; },
    cardTags: true
  }];
  // Structured log sink shared by the local userscripts (docker-workspace/docs/userscripts.md): entries are batched to
  // the collector on localhost:7790 through GM_xmlhttpRequest. The buffer is memory-only; while the collector is down
  // up to 500 entries wait and are retried with backoff.
  var LOG_URL = 'http://localhost:7790/v1/logs';
  function logPage(href) { try { var u = new URL(href); return u.host + u.pathname; } catch (e) { return ''; } }
  function gmLogSend(entries, done) {
    if (typeof GM_xmlhttpRequest !== 'function') { done(true); return; }
    try {
      GM_xmlhttpRequest({
        method: 'POST', url: LOG_URL, timeout: 5000, data: JSON.stringify({ entries: entries }),
        headers: { 'Content-Type': 'application/json', 'X-Userscript-Log': '1' },
        // A rejected batch (4xx) is dropped; only an unreachable or busy collector is retried.
        onload: function (r) { done(r.status < 500 && r.status !== 408 && r.status !== 429); },
        onerror: function () { done(false); }, ontimeout: function () { done(false); }
      });
    } catch (e) { done(false); }
  }
  function createLogSink(opts) {
    var send = opts.send || gmLogSend, page = opts.page || function () { return logPage(location.href); };
    var session = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    var queue = [], seq = 0, timer = 0, busy = false, failures = 0;
    function schedule(ms) { if (!timer) timer = setTimeout(flush, ms); }
    function flush() {
      if (timer) { clearTimeout(timer); timer = 0; }
      if (busy || !queue.length) return;
      var batch = queue.splice(0, 200);
      busy = true;
      send(batch, function (ok) {
        busy = false;
        if (ok) { failures = 0; if (queue.length) schedule(0); return; }
        queue = batch.concat(queue).slice(-500);
        failures++;
        schedule(Math.min(300000, 5000 * Math.pow(2, failures - 1)));
      });
    }
    function log(level, event, msg, data) {
      var entry = { ts: new Date().toISOString(), script: opts.script, version: opts.version, level: level, event: String(event), page: page(), session: session, seq: ++seq };
      if (msg !== undefined && msg !== null && msg !== '') entry.msg = String(msg);
      if (data !== undefined) entry.data = data;
      queue.push(entry);
      if (queue.length > 500) queue.splice(0, queue.length - 500);
      // A full batch goes at once, except while backing off from a down collector.
      if (queue.length >= 50 && !failures) flush(); else schedule(2000);
    }
    return { log: log, flush: flush, session: session, pending: function () { return queue.length; } };
  }
  // Shared bottom-right dock (docker-workspace/docs/userscripts.md): the local userscripts stack their floating panels in
  // one #userscript-dock instead of overlapping. CSS order sorts them, lowest next to the corner, so injection order does not
  // matter; column-reverse makes an overflowing dock scroll from the bottom, so the panels next to the corner stay visible.
  var DOCK_CSS = 'position:fixed!important;right:0!important;bottom:0!important;left:auto!important;top:auto!important;z-index:2147483647!important;display:flex!important;flex-direction:column-reverse!important;align-items:flex-end!important;gap:8px!important;box-sizing:border-box!important;padding:12px!important;margin:0!important;max-height:100vh!important;max-width:100vw!important;overflow-y:auto!important;overscroll-behavior:contain!important;pointer-events:none!important;background:none!important;border:0!important;';
  function dockPanel(el, order) {
    var dock = document.getElementById('userscript-dock');
    if (!dock) { dock = document.createElement('div'); dock.id = 'userscript-dock'; dock.style.cssText = DOCK_CSS; }
    if (!dock.isConnected) (document.body || document.documentElement).appendChild(dock);
    el.style.setProperty('order', String(order), 'important');
    el.style.setProperty('pointer-events', 'auto', 'important');
    el.style.setProperty('flex', 'none', 'important');
    if (el.parentElement !== dock) dock.appendChild(el);
    return dock;
  }
  // Site profiles: sites onboarded with the setup guide (Tampermonkey menu). A profile is JSON only (regexes as strings),
  // stored by host under PROFILES_KEY; profileSite turns it into an adapter. On a built-in host a profile changes only
  // DOM-level fields (name, title and video page selectors, card tags), never the key functions.
  // Shape: { v, host, model: { path, nameSel, linkPrefix, key }, listing: { path, nameSel, linkPrefix, key },
  //   card: { linkPrefix, titleSel, key }, video: { path, titleSel, linkPrefix, key }, stash: { sceneParts: [] }, tags }.
  var PROFILES_KEY = 'profiles:v1';
  // Setup guide state lives up here: on other sites the script returns before any later var is assigned.
  var SETUP_ID = 'stash-exists-setup';
  var picking = null;
  var NEVER = /(?!)/;
  var NO_LINKS = 'a[data-stash-exists-none]';
  // Path words that name a kind of page; a link prefix runs up to the last of them (/en/video/, /en/pornstar/view/).
  var KIND_WORDS = /^(?:videos?|scenes?|movies?|watch|v|clips?|updates?|trailers?|films?|episodes?|models?|pornstars?|performers?|actors?|actress(?:es)?|girls?|stars?|talents?|profiles?|view|channels?|sets?|galler(?:y|ies)|photos?)$/i;
  function pathSegments(path) { return String(path || '').split(/[?#]/)[0].split('/').filter(Boolean); }
  // Lowercase words are page kinds or sections; ids, slugs and the name itself are not.
  function literalSegment(seg, name) { return /^[a-z][a-z_]{0,24}$/.test(seg) && !(name && normTitle(seg) === normTitle(name)); }
  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function linkPrefixOf(path, name) {
    var segs = pathSegments(path), run = [];
    for (var i = 0; i < segs.length && literalSegment(segs[i], name); i++) run.push(segs[i]);
    if (!run.length) return '';
    var last = 0;
    for (var j = 0; j < run.length; j++) if (KIND_WORDS.test(run[j])) last = j;
    return '/' + run.slice(0, last + 1).join('/') + '/';
  }
  // Path pattern of a page: the link prefix literally, every later segment as an id (\d+) or any slug.
  function pathPatternOf(path, name) {
    var prefix = linkPrefixOf(path, name), rest = pathSegments(String(path).slice(prefix ? prefix.length - 1 : 0));
    return '^' + escapeRe(prefix ? prefix.slice(0, -1) : '') + rest.map(function (s) { return '/' + (/^\d+$/.test(s) ? '\\d+' : '[^/]+'); }).join('') + '(?:/|$)';
  }
  function keyModeOf(path, prefix) { return pathSegments(String(path).slice(prefix ? prefix.length - 1 : 0)).some(function (s) { return /^\d+$/.test(s); }) ? 'id' : 'slug'; }
  // Key of a link or a Stash URL: the last numeric path segment (id mode) or the last segment (slug mode). Links on the
  // site itself must start with the prefix; URLs on other hosts (the tour URLs Stash holds) are keyed by path alone.
  function profileKey(host, prefix, mode) {
    return function (href) {
      var u;
      try { u = new URL(String(href || ''), 'https://' + host); } catch (e) { return null; }
      var path = u.pathname;
      if (u.hostname.toLowerCase() === host) { if (prefix && path.toLowerCase().indexOf(prefix.toLowerCase()) !== 0) return null; path = path.slice(prefix ? prefix.length - 1 : 0); }
      var segs = pathSegments(path);
      if (mode === 'slug') { var s = segs.length ? segs[segs.length - 1].toLowerCase().replace(/\.(?:html?|php|aspx?)$/, '') : ''; return s || null; }
      for (var i = segs.length - 1; i >= 0; i--) if (/^\d+$/.test(segs[i])) return segs[i];
      return null;
    };
  }
  // Domain Stash URLs of this site most likely contain: members.example.com -> example.com, a.b.co.uk -> b.co.uk.
  function registrableDomain(host) { var l = String(host || '').toLowerCase().split('.'); return l.slice(l.length > 2 && l[l.length - 2].length <= 3 && l[l.length - 1].length === 2 ? -3 : -2).join('.'); }
  function selectorAttr(prefix) { return prefix ? 'a[href*="' + prefix.replace(/["\\]/g, '\\$&') + '"]' : NO_LINKS; }
  function sameDomainUrl(origin, key, href) { var u = new URL(href, origin); return u.origin + u.pathname.replace(/\/+$/, ''); }
  // Returns '' for a usable profile, else what is wrong with it.
  function validProfile(p) {
    if (!p || typeof p !== 'object' || typeof p.host !== 'string' || !/^[a-z0-9.-]+$/i.test(p.host)) return 'host missing';
    var parts = ['model', 'listing', 'card', 'video'];
    for (var i = 0; i < parts.length; i++) {
      var x = p[parts[i]];
      if (x === undefined || x === null) continue;
      if (typeof x !== 'object') return parts[i] + ' is not an object';
      if (x.path !== undefined) { try { new RegExp(x.path); } catch (e) { return parts[i] + '.path is not a regex'; } }
      var sels = ['nameSel', 'titleSel'];
      for (var j = 0; j < sels.length; j++) if (x[sels[j]] !== undefined && (typeof x[sels[j]] !== 'string' || x[sels[j]].length > 300)) return parts[i] + '.' + sels[j] + ' is not a selector';
      if (x.linkPrefix !== undefined && !/^(?:\/[^"\\]*\/)?$/.test(x.linkPrefix)) return parts[i] + '.linkPrefix must start and end with /';
      if (x.key !== undefined && x.key !== 'id' && x.key !== 'slug') return parts[i] + '.key must be id or slug';
    }
    if (p.stash && p.stash.sceneParts && !(Array.isArray(p.stash.sceneParts) && p.stash.sceneParts.every(function (s) { return typeof s === 'string' && s.trim(); }))) return 'stash.sceneParts must be a list of URL fragments';
    return '';
  }
  // Adapter from a profile; base is the built-in adapter of the same host, if any.
  function profileSite(p, base) {
    var m = p.model || {}, l = p.listing || {}, c = p.card || {}, v = p.video || {};
    if (base) {
      var s = Object.assign({}, base, { profile: p });
      if (m.nameSel) { s.headingSel = m.nameSel; s.headingFallbackSel = m.nameSel; }
      if (l.nameSel) s.modelNameSel = l.nameSel;
      if (c.titleSel) s.videoTitleSel = c.titleSel;
      if (v.path && v.titleSel) { s.scenePage = new RegExp(v.path, 'i'); s.sceneTitleSel = v.titleSel; }
      if (typeof p.tags === 'boolean') s.cardTags = p.tags;
      return s;
    }
    var host = p.host.toLowerCase();
    var cPrefix = c.linkPrefix || v.linkPrefix || '', mPrefix = m.linkPrefix || l.linkPrefix || '';
    var parts = p.stash && p.stash.sceneParts && p.stash.sceneParts.length ? p.stash.sceneParts : [registrableDomain(host)];
    var domains = parts.map(function (x) { return x.replace(/^https?:\/\//, '').split('/')[0]; }).filter(Boolean);
    return {
      id: 'profile:' + host, hosts: [host], profile: p, strictName: true,
      detail: m.path ? new RegExp(m.path, 'i') : NEVER, listing: l.path ? new RegExp(l.path, 'i') : NEVER,
      headingSel: m.nameSel || '', anchorSel: '', headingFallbackSel: m.nameSel || '',
      videoCardSel: '', videoLinkSel: selectorAttr(cPrefix), videoTitleSel: c.titleSel || '',
      modelLinkSel: selectorAttr(mPrefix), modelCardSel: '', modelEntrySel: '', modelNameSel: l.nameSel || '',
      sceneUrlParts: cPrefix ? parts : [],
      sceneKey: profileKey(host, cPrefix, c.key || v.key || 'id'), modelKey: profileKey(host, mPrefix, m.key || l.key || 'id'),
      modelUrl: sameDomainUrl,
      performerUrlRe: domains.length ? new RegExp('^https?://(?:[a-z0-9-]+\\.)*(?:' + domains.map(escapeRe).join('|') + ')/', 'i') : NEVER,
      scenePage: v.path && v.titleSel ? new RegExp(v.path, 'i') : undefined, sceneTitleSel: v.titleSel, cardTags: !!p.tags && !!cPrefix
    };
  }
  var STASH_ORIGIN = 'http://localhost:9999';
  var ENDPOINT = STASH_ORIGIN + '/graphql';
  // Single-video lookups (video pages and card tags): exact title and canonical URL, then file name; a free-text search only counts similar scenes.
  const QT = 'query($sf:SceneFilterType){findScenes(filter:{per_page:5},scene_filter:$sf){count scenes{id title urls}}}';
  const QF = 'query($q:String!){findScenes(filter:{q:$q,per_page:10}){count scenes{id title urls}}}';
  const QP = 'query($sf:SceneFilterType){findScenes(filter:{per_page:5},scene_filter:$sf){count scenes{id title urls files{basename}}}}';
  // File-name lookup for scenes without a matching URL or title: the title's words in order with anything between them.
  // Stash runs a quoted path INCLUDES as one SQL LIKE '%...%', so % between the words skips punctuation and separators.
  // Short titles ("Part 1") would match too much and get no file lookup.
  function filePattern(title) { const words = normTitle(title).split(' ').filter(Boolean); return words.length >= 3 && words.join('').length >= 10 ? '"' + words.join('%') + '"' : ''; }
  const lookupCache = new Map();
  const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const canonUrl = (u) => (u || '').split('?')[0].split('#')[0].trim();
  // Node unit tests load the pure helpers only (function declarations are hoisted); nothing else touches the page.
  if (typeof module === 'object' && module.exports) {
    module.exports = { logPage: logPage, createLogSink: createLogSink, VERSION: VERSION, SITES: SITES, siteFor: siteFor, cachedList: cachedList, normUrl: normUrl, normTitle: normTitle, normName: normName, extractMovieId: extractMovieId, extractModelId: extractModelId, extractGammaSceneId: extractGammaSceneId, extractGammaActorId: extractGammaActorId, gammaNameFromUrl: gammaNameFromUrl, ayloId: ayloId, ayloNameFromUrl: ayloNameFromUrl, modelIdFromParam: modelIdFromParam, modelNameFromParam: modelNameFromParam, norm: norm, canonUrl: canonUrl, lookupVideo: lookupVideo, linkPrefixOf: linkPrefixOf, pathPatternOf: pathPatternOf, keyModeOf: keyModeOf, profileKey: profileKey, registrableDomain: registrableDomain, validProfile: validProfile, profileSite: profileSite };
    return;
  }
  // Runs on every page. Other sites only get the setup guide in the Tampermonkey menu: no requests, no logs, no observer
  // until the guide is used or a profile exists.
  var profiles = loadProfiles();
  var site = siteFor(location.hostname, profiles);
  var sink = createLogSink({ script: 'stash-exists-checker', version: VERSION });
  var log = sink.log;
  window.addEventListener('pagehide', function () { sink.flush(); });
  try { GM_registerMenuCommand(site ? 'Stash: edit the setup of this site' : 'Stash: set up this site', function () { openSetup(true); }); } catch (e) {}
  if (setupState().open) openSetup(false);
  if (!site) return;
  log('info', 'started', '', { site: site.id });
  // Background list refreshes run every two seconds: log only when one starts or stops failing.
  var listFailing = {};
  function listResult(name) {
    return [function () { if (listFailing[name]) { listFailing[name] = false; log('info', 'stash list recovered', '', { list: name }); } },
      function (e) { if (!listFailing[name]) { listFailing[name] = true; log('warn', 'stash list failed', e && e.message, { list: name }); } }];
  }
  var PANEL_ID = 'stash-model-link-panel';
  var HEADING_BADGE_ID = 'stash-model-link-heading-badge';
  var VIDEO_BADGE_CLASS = 'stash-model-link-video-badge';
  var MODEL_BADGE_CLASS = 'stash-model-link-model-badge';
  var MODEL_ADD_CLASS = 'stash-model-link-model-add';
  var lastPath = '';
  var headingOrigColor = '';
  var sceneMapCache = null;
  var performerTitleMapCache = null;
  var performerTitleMapFor = null;
  var performerFound = false;
  var performerMapCache = null;
  var performerKeyMapCache = null;
  var sceneRows = {};
  // Bulk Stash lists live in Tampermonkey storage, which belongs to the script and so is shared by every site and tab
  // (localStorage would be per site). Raw rows are stored; each site builds its own maps from them.
  var CACHE_PREFIX = 'cache:v1:';
  var stashStore = {
    get: function (name) { try { return GM_getValue(CACHE_PREFIX + name, null); } catch (e) { return null; } },
    set: function (name, entry) { try { GM_setValue(CACHE_PREFIX + name, entry); } catch (e) {} }
  };
  var MODEL_LINK_CHECK = 'data-sml-model-check';
  // One bulk Stash list (all performers, or the scenes under one URL part) kept in store under name. A stored list is used
  // at once; one older than 10 minutes is fetched again while the stored copy keeps serving, one older than a day is ignored.
  // After a failed fetch the next try waits a minute. use(items) gets the stored list and every newer one.
  function cachedList(store, name, fetchFn, use) {
    var TTL = 600000, MAX_AGE = 86400000, RETRY = 60000;
    var checkedAt = 0, usedAt = 0, promise = null;
    return function () {
      var now = Date.now();
      if (promise && now - checkedAt < TTL) return promise;
      var stored = store.get(name);
      if (!stored || typeof stored.at !== 'number' || !Array.isArray(stored.items) || now - stored.at > MAX_AGE) stored = null;
      if (stored && stored.at > usedAt) { usedAt = stored.at; use(stored.items); }
      if (stored && now - stored.at < TTL) { checkedAt = stored.at; promise = Promise.resolve(); return promise; }
      checkedAt = now;
      var fetching = fetchFn().then(function (items) { var at = Date.now(); store.set(name, { at: at, items: items }); usedAt = at; use(items); }, function (e) { checkedAt = Date.now() - TTL + RETRY; throw e; });
      if (usedAt) { fetching.catch(function () {}); promise = Promise.resolve(); } else promise = fetching;
      return promise;
    };
  }
  // Built-in adapter by host (subdomains included), a stored profile on top of it or on its own; null for other sites.
  function siteFor(host, profiles) {
    host = String(host || '').toLowerCase();
    var p = profiles && Object.prototype.hasOwnProperty.call(profiles, host) && !validProfile(profiles[host]) ? profiles[host] : null;
    for (var i = 0; i < SITES.length; i++) { for (var j = 0; j < SITES[i].hosts.length; j++) { var h = SITES[i].hosts[j]; if (host === h || host.slice(-h.length - 1) === '.' + h) return p ? profileSite(p, SITES[i]) : SITES[i]; } }
    return p ? profileSite(p, null) : null;
  }
  function extractGammaSceneId(href) { var m = String(href || '').match(/\/[a-z]{2}\/video\/(?:[^/?#]+\/)*?(\d+)\/?(?:[?#]|$)/i); return m ? m[1] : null; }
  function extractGammaActorId(href) { var m = String(href || '').match(/\/pornstar\/(?:view\/)?[^/?#]+\/(\d+)\/?(?:[?#]|$)/i); return m ? m[1] : null; }
  // Gamma puts the name in the URL ("Kenzie-Reeves"); some sites use a placeholder slug ("name", "-").
  function gammaNameFromUrl(href) { var m = String(href || '').match(/\/pornstar\/(?:view\/)?([^/?#]+)\/\d+/i); if (!m) return ''; var slug; try { slug = decodeURIComponent(m[1]); } catch (e) { slug = m[1]; } if (/^(?:name|view|-+)$/i.test(slug)) return ''; return slug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  // Aylo ids: /<kind>/<id>/<slug> on a host matching hostRe; relative links (the current site) always qualify.
  function ayloId(hostRe, kinds) { var pathRe = new RegExp('^/(?:' + kinds + ')/(\\d+)(?:[/?#]|$)', 'i'); return function (href) { var s = String(href || ''); var m = s.match(/^(?:https?:)?\/\/([^/?#]+)(.*)$/i); if (m && !hostRe.test(m[1].toLowerCase())) return null; var p = (m ? m[2] : s).match(pathRe); return p ? p[1] : null; }; }
  function ayloNameFromUrl(href) { var m = String(href || '').match(/\/(?:model|pornstar)\/\d+\/([^/?#]+)/i); if (!m) return ''; var slug; try { slug = decodeURIComponent(m[1]); } catch (e) { slug = m[1]; } return slug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  // The one model a page is filtered to (?models=65308); several ids or none mean no model page.
  function modelIdFromParam(search, param) { if (!param) return null; var v; try { v = new URLSearchParams(search).get(param); } catch (e) { return null; } return v && /^\d+$/.test(v.trim()) ? v.trim() : null; }
  // The one model name a page is filtered to; a second value (...[1]) means several models.
  function modelNameFromParam(search, param) { if (!param) return null; var sp; try { sp = new URLSearchParams(search); } catch (e) { return null; } var v = (sp.get(param) || '').trim(); if (!v || sp.get(param.replace(/\[0\]$/, '[1]'))) return null; return v; }
  function q(sel) { return sel ? document.querySelector(sel) : null; }
  function getPageUrl() { return location.origin + location.pathname; }
  function headingEl() { return q(site.headingSel) || q(site.headingFallbackSel); }
  function headingText(h) { var c = h.cloneNode(true); var b = c.querySelector('#' + HEADING_BADGE_ID); if (b) b.remove(); return (c.textContent || '').trim(); }
  function getModelName() {
    var fromUrl = site.nameFromUrl ? site.nameFromUrl(location.pathname) : '';
    if (fromUrl) return fromUrl;
    var h = q(site.headingSel);
    if (site.strictName) return h ? headingText(h).replace(/\s+/g, ' ').slice(0, 80) : '';
    if (h && headingText(h)) return headingText(h);
    var hs = site.headingFallbackSel ? Array.prototype.slice.call(document.querySelectorAll(site.headingFallbackSel)) : [];
    for (var i = 0; i < hs.length; i++) {
      var t = (hs[i].innerText || '').trim();
      if (t && !(site.nameSkip && site.nameSkip.test(t)) && t.length < 80) return t;
    }
    var parts = site.titleSep ? document.title.split(site.titleSep) : [];
    if (parts.length > 1 && parts[1].trim()) return parts[1].trim();
    return document.title.trim() || '';
  }
  function normUrl(u) { return String(u || '').trim().replace(/\/+$/, ''); }
  function gql(query, variables) {
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: 'POST',
        url: ENDPOINT,
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ query: query, variables: variables || {} }),
        timeout: 15000,
        onload: function (r) {
          if (r.status < 200 || r.status >= 300) { reject(new Error('Stash HTTP ' + r.status)); return; }
          var j;
          try { j = JSON.parse(r.responseText); } catch (e) { reject(e); return; }
          if (j.errors && j.errors.length) { reject(new Error(j.errors[0].message || 'GraphQL error')); return; }
          resolve(j.data);
        },
        onerror: function () { reject(new Error('network error')); },
        ontimeout: function () { reject(new Error('timeout')); }
      });
    });
  }
  // The only write the script makes; always asks first. The update replaces all URLs and p may come from a stored list,
  // so it appends to the performer's current URLs. It drops the stored performer list, so the next page refetches it.
  function addPerformerUrl(p, url) {
    if (!confirm('Add this URL to "' + p.name + '" (Stash id ' + p.id + ')?\n\n' + url)) return Promise.resolve(null);
    return gql('query($id:ID!){ findPerformer(id:$id){ urls } }', { id: p.id }).then(function (data) {
      if (!data || !data.findPerformer) throw new Error('performer ' + p.id + ' is no longer in Stash');
      stashStore.set('performers', null);
      var cur = data.findPerformer.urls || [];
      function done(urls) { var k = site.modelKey(url); if (k && performerKeyMapCache) performerKeyMapCache[k] = p; return urls; }
      if (cur.some(function (u) { return normUrl(u).toLowerCase() === normUrl(url).toLowerCase(); })) return done(cur.slice());
      var next = cur.concat([url]);
      return gql('mutation($input:PerformerUpdateInput!){ performerUpdate(input:$input){ id urls } }', { input: { id: p.id, urls: next } }).then(function () { return done(next); });
    });
  }
  function resetHeading() { var b = document.getElementById(HEADING_BADGE_ID); if (!b) return; var h = b.parentElement; b.remove(); if (!h) return; if (headingOrigColor) h.style.color = headingOrigColor; else h.style.color = ''; h.style.fontWeight = ''; }
  // Only a heading that shows this model's name is coloured, so a generic page heading stays untouched.
  function highlightHeading(name) { var h = headingEl(); if (!h || normName(headingText(h)) !== normName(name)) return; if (!headingOrigColor && !h.style.color) headingOrigColor = getComputedStyle(h).color; h.style.color = '#22c55e'; h.style.fontWeight = '700'; if (!document.getElementById(HEADING_BADGE_ID)) { var b = document.createElement('span'); b.id = HEADING_BADGE_ID; b.textContent = ' \u2611'; b.style.cssText = 'color:#22c55e;font-weight:800;margin-left:6px;'; h.appendChild(b); } }
  function extractMovieId(href) { var m = String(href || '').match(/\/movies\/(\d+)/); return m ? m[1] : null; }
  function normTitle(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2018\u2019\u201c\u201d]/g, "'").replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  // Outermost elements matching videoCardSel that link exactly one scene, so nested matches and whole lists are skipped.
  // Counted once per element and link selector during a scheduler pass (passMemo): every link of a structural list asks
  // about the same ancestors, which made card detection quadratic.
  function keyCount(el, linkSel, keyFn) { var memo = passMemo ? (passMemo.get(linkSel) || passMemo.set(linkSel, new Map()).get(linkSel)) : null; if (memo && memo.has(el)) return memo.get(el); var keys = {}, n = 0; var ls = el ? el.querySelectorAll(linkSel) : []; for (var i = 0; i < ls.length; i++) { var k = keyFn(ls[i].getAttribute('href') || ls[i].href); if (k && !keys[k]) { keys[k] = 1; n++; } } if (memo) memo.set(el, n); return n; }
  // Largest ancestor of the link that holds only this one key: its parent is the list holding several.
  // A link with no list around it (a lone featured video) gets its highest ancestor within four levels, so marks never land
  // inside a title element.
  function structuralCard(link, linkSel, keyFn) { var lone = link.parentElement; for (var el = link.parentElement, d = 0; el && el !== document.body && d < 8; el = el.parentElement, d++) { if (keyCount(el.parentElement, linkSel, keyFn) > 1) return el; if (d < 4) lone = el; } return lone; }
  function videoCards() { if (!site.videoCardSel) { var seen = [], links = document.querySelectorAll(site.videoLinkSel); for (var li = 0; li < links.length; li++) { if (!site.sceneKey(links[li].getAttribute('href') || links[li].href)) continue; var c = structuralCard(links[li], site.videoLinkSel, site.sceneKey); if (c && seen.indexOf(c) < 0) seen.push(c); } return seen.filter(function (c) { return !seen.some(function (o) { return o !== c && o.contains(c); }); }); } var all = Array.prototype.filter.call(document.querySelectorAll(site.videoCardSel), function (c) { var keys = {}, n = 0; var ls = c.querySelectorAll(site.videoLinkSel); for (var i = 0; i < ls.length; i++) { var k = site.sceneKey(ls[i].getAttribute('href') || ls[i].href); if (k && !keys[k]) { keys[k] = 1; n++; } } return ls.length > 0 && n <= 1; }); return all.filter(function (c) { return !all.some(function (o) { return o !== c && o.contains(c); }); }); }
  // The card of one video link, as videoCards sees it: the outermost videoCardSel match that still holds only this video
  // (Adult Time's selector also matches the image link itself), else the structural card.
  function cardFor(a) { var best = null; if (site.videoCardSel) { for (var el = a; el && el !== document.body; el = el.parentElement) { if (!el.matches(site.videoCardSel)) continue; if (keyCount(el, site.videoLinkSel, site.sceneKey) > 1) break; best = el; } } return best || structuralCard(a, site.videoLinkSel, site.sceneKey); }
  function cardTitleForCard(card) { if (site.videoTitleSel) { var te = card.querySelector(site.videoTitleSel); return te ? (te.innerText || te.textContent || '').trim() : ''; } var links = card.querySelectorAll(site.videoLinkSel); for (var ti = 0; ti < links.length; ti++) { var t = (links[ti].innerText || '').trim(); if (t) return t; } return ''; }
  function matchSceneForCard(card, urlMap, titleMap) { var as = card.querySelectorAll(site.videoLinkSel), id = null; for (var ai = 0; ai < as.length && !id; ai++) id = site.sceneKey(as[ai].getAttribute('href') || as[ai].href); if (!as.length) return null; if (id && urlMap && urlMap[id]) return urlMap[id]; if (titleMap) { var nt = normTitle(cardTitleForCard(card)); if (nt && titleMap[nt]) return titleMap[nt]; } return null; }
  function fetchScenesForUrlPart(part) { return (function next(page, acc) { return gql('query($h:String!,$p:Int!){ findScenes(scene_filter:{url:{value:$h, modifier:INCLUDES}}, filter:{per_page:500, page:$p}){ scenes{ id title urls } } }', { h: part, p: page }).then(function (data) { var ss = (data && data.findScenes && data.findScenes.scenes) || []; var all = acc.concat(ss); return (ss.length < 500 || page >= 20) ? all : next(page + 1, all); }); })(1, []); }
  function buildSceneMap() { var map = {}; for (var l = 0; l < site.sceneUrlParts.length; l++) { var scenes = sceneRows[site.sceneUrlParts[l]] || []; for (var i = 0; i < scenes.length; i++) { var s = scenes[i]; for (var j = 0; j < ((s.urls) || []).length; j++) { var id = site.sceneKey(s.urls[j]); if (id && !map[id]) map[id] = s; } } } sceneMapCache = map; markDirty(); }
  // One stored list per URL part, so adapters that share a part (Gamma's /en/video/) share its scenes.
  var sceneLists = site.sceneUrlParts.map(function (part) { return cachedList(stashStore, 'scenes:' + part, function () { return fetchScenesForUrlPart(part); }, function (items) { sceneRows[part] = items; buildSceneMap(); }); });
  function ensureSceneMap() { return Promise.all(sceneLists.map(function (get) { return get(); })).then(function () { return sceneMapCache; }); }
  function fetchPerformerTitleMap(pid) { if (performerTitleMapCache && performerTitleMapFor === String(pid)) return Promise.resolve(performerTitleMapCache); var num = parseInt(pid, 10); return gql('query{ findScenes(scene_filter:{performers:{value:[' + num + '], modifier:INCLUDES}}, filter:{per_page:200}){ count scenes{ id title urls } } }').then(function (data) { var map = {}; var scenes = ((data && data.findScenes && data.findScenes.scenes) || []); for (var i = 0; i < scenes.length; i++) { var k = normTitle(scenes[i].title); if (k && !map[k]) map[k] = scenes[i]; } performerTitleMapCache = map; performerTitleMapFor = String(pid); return map; }); }
  function titleLinkForCard(card) { if (site.videoTitleSel) return card.querySelector(site.videoTitleSel); var links = card.querySelectorAll(site.videoLinkSel); for (var li = 0; li < links.length; li++) { if ((links[li].innerText || '').trim()) return links[li]; } return null; }
  function styleVideoTitle(card, hit) { var link = titleLinkForCard(card); if (!link) return; var t = link.querySelector('span') || link; if (t.getAttribute && t.getAttribute('data-sml-video-green') === '1') return; t.style.color = '#22c55e'; t.style.fontWeight = '700'; t.setAttribute('data-sml-video-green', '1'); try { t.title = (hit.title || '') + ' (Stash id ' + hit.id + ')'; } catch (e) {} var chk = document.createElement('span'); chk.setAttribute('data-sml-video-check', '1'); chk.textContent = '\u2713 '; chk.style.cssText = 'color:#22c55e;font-weight:800;'; try { t.insertBefore(chk, t.firstChild); } catch (e2) {} }
  function unmarkVideoCard(card) { var b = card.querySelector('.' + VIDEO_BADGE_CLASS); if (b) b.remove(); var marked = card.querySelectorAll('[data-sml-video-green="1"]'); for (var cj = 0; cj < marked.length; cj++) { var m = marked[cj]; var chk = m.querySelector('[data-sml-video-check]'); if (chk) chk.remove(); m.style.color = ''; m.style.fontWeight = ''; m.removeAttribute('data-sml-video-green'); m.removeAttribute('title'); } }
  // Runs on every page and every re-check: marks cards whose scene is in Stash and drops marks that no longer fit
  // (single-page apps reuse card elements for other scenes). Titles only count when a performer's scenes are given.
  function markVideos(urlMap, titleMap, cards) { cards = cards || videoCards(); for (var i = 0; i < cards.length; i++) { var card = cards[i]; var hit = matchSceneForCard(card, urlMap || {}, titleMap || null); var old = card.querySelector('.' + VIDEO_BADGE_CLASS); if (old && (!hit || old.getAttribute('data-sml-key') !== String(hit.id))) { unmarkVideoCard(card); old = null; } if (!hit) continue; if (!old) { var tag = card.querySelector('.stash-exists-tag'); if (tag) tag.remove(); try { if (getComputedStyle(card).position === 'static') card.style.position = 'relative'; } catch (e) {} var b = document.createElement('a'); b.className = VIDEO_BADGE_CLASS; b.setAttribute('data-sml-key', String(hit.id)); b.textContent = '\u2713 IN STASH'; b.href = STASH_ORIGIN + '/scenes/' + hit.id; b.target = '_blank'; b.rel = 'noopener'; b.title = (hit.title || '') + ' (Stash id ' + hit.id + ')'; b.style.cssText = 'position:absolute;top:6px;left:6px;z-index:5;background:#16a34a;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;text-decoration:none;box-shadow:0 1px 4px rgba(0,0,0,.4);'; b.addEventListener('click', function (ev) { ev.stopPropagation(); }); card.appendChild(b); } try { styleVideoTitle(card, hit); } catch (e2) {} } }
  function extractModelId(href) { var m = String(href || '').match(/\/models\/(\d+)/); return m ? m[1] : null; }
  function modelCardForLink(a) { if (!site.modelCardSel) return structuralCard(a, site.modelLinkSel, site.modelKey) || a; try { var card = a.closest(site.modelCardSel); if (card) return card; } catch (e) {} var el = a; for (var mi = 0; mi < 4 && el; mi++) { el = el.parentElement; if (el && el.matches && site.modelEntrySel && el.matches(site.modelEntrySel)) return el; } return a.parentElement || a; }
  function modelNameEl(card) { return (site.modelNameSel && card.querySelector(site.modelNameSel)) || card.querySelector('span'); }
  function modelNameForLink(a, card) { var fromUrl = site.nameFromUrl ? site.nameFromUrl(a.getAttribute('href') || a.href) : ''; if (fromUrl) return fromUrl; var s = modelNameEl(card); if (s && s.textContent.trim()) return s.textContent.trim(); var t = (a.innerText || '').trim(); if (t && t.length < 80) return t; return ''; }
  // Names compare like titles: case, accents and punctuation do not count ("Anna-Belle" = "anna belle").
  function normName(s) { return normTitle(s); }
  function performerNames(p) { return [p.name].concat(p.alias_list || []); }
  function fetchPerformerList() { return (function next(page, acc) { return gql('query($p:Int!){ findPerformers(filter:{per_page:500, page:$p}){ count performers{ id name alias_list urls } } }', { p: page }).then(function (data) { var ps = (data && data.findPerformers && data.findPerformers.performers) || []; var all = acc.concat(ps); return (ps.length < 500 || page >= 10) ? all : next(page + 1, all); }); })(1, []); }
  function buildPerformerMaps(all) { var map = {}; for (var i = 0; i < all.length; i++) { var k = normName(all[i].name); if (k && !map[k]) map[k] = all[i]; } for (var ai = 0; ai < all.length; ai++) { var al = all[ai].alias_list || []; for (var aj = 0; aj < al.length; aj++) { var ak = normName(al[aj]); if (ak && !map[ak]) map[ak] = all[ai]; } } var keys = {}; for (var ki = 0; ki < all.length; ki++) { var us = all[ki].urls || []; for (var kj = 0; kj < us.length; kj++) { if (site.performerUrlRe && !site.performerUrlRe.test(us[kj])) continue; var kk = site.modelKey(us[kj]); if (kk && !keys[kk]) keys[kk] = all[ki]; } } performerKeyMapCache = keys; performerMapCache = map; markDirty(); }
  // The performer list is the same query on every site, so one stored copy serves them all.
  var performerList = cachedList(stashStore, 'performers', fetchPerformerList, buildPerformerMaps);
  function fetchPerformerMap() { return performerList().then(function () { return performerMapCache; }); }
  function clearModelMarks() { var els = document.querySelectorAll('.' + MODEL_BADGE_CLASS + ', .' + MODEL_ADD_CLASS); for (var ci2 = 0; ci2 < els.length; ci2++) els[ci2].remove(); var names = document.querySelectorAll('[data-sml-name-green="1"]'); for (var cj = 0; cj < names.length; cj++) { names[cj].style.color = ''; names[cj].style.fontWeight = ''; names[cj].removeAttribute('data-sml-name-green'); } }
  // The handlers below only read pageUrl synchronously and performerMapCache at click time (the shared cache), so the loop closures are safe.
  // eslint-disable-next-line no-loop-func
  function markModelCards(map) { var links = document.querySelectorAll(site.modelLinkSel); for (var i = 0; i < links.length; i++) { var a = links[i]; var href = a.getAttribute('href') || a.href || ''; var rid = site.modelKey(href); if (!rid) continue; var card = modelCardForLink(a); if (!card || card.querySelector(':scope > .' + MODEL_BADGE_CLASS)) continue; var name = modelNameForLink(a, card); var hit = (performerKeyMapCache && performerKeyMapCache[rid]) || (name ? map[normName(name)] : null); if (!hit) continue; try { if (getComputedStyle(card).position === 'static') card.style.position = 'relative'; } catch (e) {} var pageUrl = site.modelUrl(location.origin, rid, href); var hasUrl = (hit.urls || []).some(function (u) { return normUrl(u).toLowerCase() === normUrl(pageUrl).toLowerCase(); }); var b = document.createElement('a'); b.className = MODEL_BADGE_CLASS; b.textContent = '\u2713 IN STASH'; b.href = STASH_ORIGIN + '/performers/' + hit.id; b.target = '_blank'; b.rel = 'noopener'; b.title = hit.name + ' (Stash id ' + hit.id + ')'; b.style.cssText = 'position:absolute;top:6px;left:6px;z-index:5;background:#16a34a;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;text-decoration:none;box-shadow:0 1px 4px rgba(0,0,0,.4);'; b.addEventListener('click', function (ev) { ev.stopPropagation(); }); card.appendChild(b); var ns = modelNameEl(card); if (ns && !ns.getAttribute('data-sml-name-green')) { ns.style.color = '#22c55e'; ns.style.fontWeight = '700'; ns.setAttribute('data-sml-name-green', '1'); } if (!hasUrl && !card.querySelector(':scope > .' + MODEL_ADD_CLASS)) { (function (h, url, c2) { var add = document.createElement('button'); add.className = MODEL_ADD_CLASS; add.textContent = '+ URL'; add.title = 'Save ' + url + ' on ' + h.name + ' in Stash'; add.style.cssText = 'position:absolute;top:6px;right:6px;z-index:5;background:#b45309;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;border:none;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.4);'; add.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); add.disabled = true; add.textContent = '...'; addPerformerUrl(h, url).then(function (nxt) { if (!nxt) { add.disabled = false; add.textContent = '+ URL'; return; } add.remove(); h.urls = nxt; }).catch(function (err) { add.disabled = false; add.textContent = '+ URL'; alert('Stash update failed: ' + err.message); }); }); c2.appendChild(add); })(hit, pageUrl, card); } } }
  function performerForLink(a, href) { var key = site.modelKey(href); if (!key) return null; var hit = performerKeyMapCache && performerKeyMapCache[key]; if (hit) return hit; var n = site.nameFromUrl ? site.nameFromUrl(href) : ''; if (!n) { n = (a.innerText || '').trim(); if (n.length > 80) n = ''; } return n ? (performerMapCache[normName(n)] || null) : null; }
  function unmarkModelLink(a) { var c = a.querySelector('[' + MODEL_LINK_CHECK + ']'); if (c) c.remove(); a.style.color = ''; a.style.fontWeight = ''; a.title = a.getAttribute('data-sml-prev-title') || ''; a.removeAttribute('data-sml-prev-title'); a.removeAttribute('data-sml-model'); }
  // Every model link with text outside model listings: green with a check when the performer is in Stash
  // (by the model id in a saved URL, else by name). Listings get card badges from markModelCards instead.
  function markModelLinks() { if (!performerMapCache || site.listing.test(location.pathname)) return; var links = document.querySelectorAll(site.modelLinkSel); for (var i = 0; i < links.length; i++) { var a = links[i]; if (a.closest('#' + PANEL_ID)) continue; var hit = performerForLink(a, a.getAttribute('href') || a.href || ''); var cur = a.getAttribute('data-sml-model'); if (cur && (!hit || cur !== String(hit.id))) unmarkModelLink(a); if (!hit || a.getAttribute('data-sml-model') || !(a.innerText || '').trim()) continue; a.setAttribute('data-sml-model', String(hit.id)); a.setAttribute('data-sml-prev-title', a.title || ''); a.title = 'In Stash: ' + hit.name + ' (Stash id ' + hit.id + ')'; a.style.color = '#22c55e'; a.style.fontWeight = '700'; var chk = document.createElement('span'); chk.setAttribute(MODEL_LINK_CHECK, '1'); chk.textContent = '\u2713 '; chk.style.cssText = 'color:#22c55e;font-weight:800;'; a.insertBefore(chk, a.firstChild); } }
  function runListing(force) { if (!force && location.pathname === lastPath && performerMapCache) { try { markModelCards(performerMapCache); } catch (e) {} return; } lastPath = location.pathname; removePanel(); resetHeading(); performerFound = false; fetchPerformerMap().then(function (map) { markModelCards(map); }).catch(function () {}); }
  function findAnchor() { return site.anchorSel ? (q(site.anchorSel) || q(site.headingFallbackSel)) : null; }
  function removePanel() { var old = document.getElementById(PANEL_ID); if (old) old.remove(); }
  function stylePanel(el) { el.style.cssText = 'margin:10px 0;padding:10px 12px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:10px;font-size:13px;line-height:1.55;max-width:680px;font-family:system-ui,sans-serif;'; }
  // After the anchor, or floating in the shared bottom-right dock when the adapter has none. A floating panel stays
  // small: capped height, and a toggle that folds it to its marked summary lines (remembered across pages).
  function panelCollapsed() { try { return !!GM_getValue('panelCollapsed', false); } catch (e) { return false; } }
  function applyCollapsed(div) { var c = panelCollapsed(); var kids = div.children; for (var i = 1; i < kids.length; i++) { if (kids[i].hasAttribute('data-sml-toggle')) continue; kids[i].style.display = c && !kids[i].hasAttribute('data-sml-keep') ? 'none' : ''; } var t = div.querySelector('[data-sml-toggle]'); if (t) { t.textContent = c ? '+' : '\u2013'; t.title = c ? 'Show details' : 'Fold to summary'; t.setAttribute('aria-expanded', c ? 'false' : 'true'); } }
  function placePanel(anchor, div) {
    if (anchor) { anchor.insertAdjacentElement('afterend', div); return; }
    div.style.position = 'relative'; div.style.maxWidth = '340px'; div.style.maxHeight = 'calc(100vh - 100px)'; div.style.overflowY = 'auto'; div.style.overscrollBehavior = 'contain'; div.style.margin = '0'; div.style.fontSize = '12px'; div.style.boxShadow = '0 4px 16px rgba(0,0,0,.5)';
    var t = document.createElement('button');
    t.type = 'button';
    t.setAttribute('data-sml-toggle', '1');
    t.style.cssText = 'position:absolute;top:4px;right:6px;width:22px;height:22px;padding:0;border:1px solid #475569;border-radius:5px;background:#1e293b;color:#e2e8f0;cursor:pointer;font:700 13px/1 system-ui,sans-serif;';
    t.addEventListener('click', function () { try { GM_setValue('panelCollapsed', !panelCollapsed()); } catch (e) {} applyCollapsed(div); });
    div.style.paddingRight = '34px';
    div.appendChild(t);
    dockPanel(div, 35);
    applyCollapsed(div);
  }
  function renderLoading(anchor, name) {
    removePanel();
    resetHeading();
    performerFound = false;
    performerTitleMapCache = null;
    performerTitleMapFor = null;
    var div = document.createElement('div');
    div.id = PANEL_ID;
    stylePanel(div);
    div.textContent = 'STASH: looking up "' + name + '" ...';
    placePanel(anchor, div);
  }
  function render(anchor, state) {
    removePanel();
    var div = document.createElement('div');
    div.id = PANEL_ID;
    stylePanel(div);
    var title = document.createElement('div');
    title.style.cssText = 'font-weight:700;margin-bottom:4px;';
    title.textContent = 'STASH';
    div.appendChild(title);
    function line(text, color) { var p = document.createElement('div'); if (color) p.style.color = color; p.textContent = text; div.appendChild(p); return p; }
    if (state.error) {
      resetHeading();
      performerFound = false;
      line('Cannot reach Stash at ' + STASH_ORIGIN + ': ' + state.error, '#fca5a5').setAttribute('data-sml-keep', '1');
      var retry = document.createElement('button');
      retry.textContent = 'Retry';
      retry.style.cssText = 'margin-top:8px;padding:4px 12px;border-radius:6px;border:1px solid #475569;background:#1e293b;color:#fff;cursor:pointer;';
      retry.addEventListener('click', function () { run(true); });
      div.appendChild(retry);
      placePanel(anchor, div);
      return;
    }
    if (!state.exact) {
      resetHeading();
      performerFound = false;
      line('Model "' + state.name + '" NOT found in Stash (' + state.count + ' fuzzy hit(s)).', '#fcd34d').setAttribute('data-sml-keep', '1');
      if (state.candidates.length) line('Closest: ' + state.candidates.map(function (p) { return p.name + ' (id ' + p.id + ')'; }).join(', '), '#94a3b8');
      placePanel(anchor, div);
      return;
    }
    var p = state.exact;
    highlightHeading(state.name);
    var hasUrl = !state.pageUrl || p.urls.some(function (u) { return normUrl(u).toLowerCase() === normUrl(state.pageUrl).toLowerCase(); });
    var foundLine = line('', null);
    foundLine.setAttribute('data-sml-keep', '1');
    var check = document.createElement('span');
    check.textContent = '\u2713 ';
    check.style.cssText = 'color:#22c55e;font-weight:800;';
    foundLine.appendChild(check);
    foundLine.appendChild(document.createTextNode('Found in Stash: '));
    var nameSpan = document.createElement('span');
    nameSpan.textContent = p.name;
    nameSpan.style.cssText = 'color:#22c55e;font-weight:700;';
    foundLine.appendChild(nameSpan);
    foundLine.appendChild(document.createTextNode(' (id ' + p.id + ')'));
    if (state.pageUrl) line(hasUrl ? 'This page URL is saved on the performer.' : 'This page URL is NOT saved on the performer.', hasUrl ? '#94a3b8' : '#fcd34d');
    if (!hasUrl && p.urls.length) {
      // Folded list: performers often carry dozens of URLs.
      var saved = document.createElement('details');
      saved.style.cssText = 'color:#94a3b8;';
      var sum = document.createElement('summary');
      sum.style.cssText = 'cursor:pointer;';
      sum.textContent = 'Saved URLs (' + p.urls.length + ')';
      saved.appendChild(sum);
      var list = document.createElement('div');
      list.style.cssText = 'max-height:140px;overflow:auto;word-break:break-all;font-size:11px;padding-left:12px;';
      for (var ui = 0; ui < p.urls.length; ui++) { var urlRow = document.createElement('div'); urlRow.textContent = p.urls[ui]; list.appendChild(urlRow); }
      saved.appendChild(list);
      div.appendChild(saved);
    }
    var row = document.createElement('div');
    row.style.cssText = 'margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;';
    div.appendChild(row);
    var view = document.createElement('a');
    view.href = STASH_ORIGIN + '/performers/' + p.id;
    view.target = '_blank';
    view.rel = 'noopener';
    view.textContent = 'View in Stash';
    view.style.cssText = 'padding:4px 12px;border-radius:6px;background:#2563eb;color:#fff;text-decoration:none;';
    row.appendChild(view);
    if (!hasUrl) {
      var btn = document.createElement('button');
      btn.textContent = 'Add this URL in Stash';
      btn.style.cssText = 'padding:4px 12px;border-radius:6px;border:1px solid #475569;background:#1e293b;color:#fff;cursor:pointer;';
      btn.addEventListener('click', function () {
        btn.disabled = true;
        btn.textContent = 'Adding...';
        addPerformerUrl(p, state.pageUrl).then(function (next) { if (next) { log('info', 'performer url added', '', { performerId: p.id }); run(true); } else { btn.disabled = false; btn.textContent = 'Add this URL in Stash'; } }).catch(function (e) { log('error', 'performer url add failed', e.message, { performerId: p.id }); btn.disabled = false; btn.textContent = 'Add this URL in Stash'; alert('Stash update failed: ' + e.message); });
      });
      row.appendChild(btn);
    }
    var vidLine = line('', '#94a3b8');
    // Marked before placing: a panel drawn while folded keeps its summary lines.
    vidLine.setAttribute('data-sml-video-count', '1');
    vidLine.setAttribute('data-sml-keep', '1');
    placePanel(anchor, div);
    performerFound = true;
    Promise.all([ensureSceneMap(), fetchPerformerTitleMap(p.id)]).then(function (maps) { markVideos(maps[0] || {}, maps[1] || {}); updateVideoCount(); }).catch(function (e) { log('warn', 'video check failed', e && e.message, { performerId: p.id }); vidLine.textContent = 'Video check failed.'; });
  }
  // Recounted on every re-check too, because single-page apps often render the video cards after the panel.
  function updateVideoCount(cards) { var vidLine = document.querySelector('#' + PANEL_ID + ' [data-sml-video-count]'); if (!vidLine) return; var urlMap = sceneMapCache || {}, titleMap = performerTitleMapCache; cards = cards || videoCards(); var total = 0, hit = 0; for (var k = 0; k < cards.length; k++) { var la = cards[k].querySelector(site.videoLinkSel); if (!la) continue; var mid = site.sceneKey(la.getAttribute('href') || la.href); if (!mid && !cardTitleForCard(cards[k])) continue; total++; if (matchSceneForCard(cards[k], urlMap, titleMap)) hit++; } vidLine.textContent = total ? ('Videos on this page in Stash: ' + hit + '/' + total) : 'No videos found on this page.'; vidLine.style.color = hit ? '#86efac' : '#94a3b8'; }
  function paramModelId() { return site.modelParam ? modelIdFromParam(location.search, site.modelParam) : null; }
  function paramModelName() { return site.modelNameParam ? modelNameFromParam(location.search, site.modelNameParam) : null; }
  function isDetailPage() { return site.detail.test(location.pathname) || !!paramModelId() || !!paramModelName(); }
  function pageKey() { var pid = paramModelId(), pn = paramModelName(); return location.pathname + (pid ? '?' + site.modelParam + '=' + pid : '') + (pn ? '?' + site.modelNameParam + '=' + pn : ''); }
  // Model pages remember name and URL by site id, so a page filtered to that id (?models=<id>) knows them later.
  function rememberModel(id, name, url) { try { GM_setValue('model:' + site.id + ':' + id, { name: name, url: url }); } catch (e) {} }
  function rememberedModel(id) { try { return GM_getValue('model:' + site.id + ':' + id, null); } catch (e) { return null; } }
  // A filtered page usually links the model itself (/model/<id>/<slug>) once its cards have loaded.
  function modelFromPageLinks(id) { if (!site.nameFromUrl) return null; var ls = document.querySelectorAll(site.modelLinkSel); for (var i = 0; i < ls.length; i++) { var h = ls[i].getAttribute('href') || ls[i].href; if (site.modelKey(h) !== id) continue; var n = site.nameFromUrl(h); if (n) return { name: n, url: site.modelUrl(location.origin, id, h) }; } return null; }
  var namelessPanel = false;
  // Performer by the site's model id in a saved URL; resolves to null when the adapter has no URL rule or nothing matches.
  function findPerformerById(id) {
    if (!id || !site.performerUrlParts) return Promise.resolve(null);
    var parts = site.performerUrlParts(id);
    return Promise.all(parts.map(function (part) { return gql('query($u:String!){ findPerformers(performer_filter:{url:{value:$u, modifier:INCLUDES}}, filter:{per_page:5}){ performers{ id name alias_list urls } } }', { u: part }); })).then(function (results) {
      for (var i = 0; i < results.length; i++) { var ps = (results[i] && results[i].findPerformers && results[i].findPerformers.performers) || []; if (ps.length) return ps[0]; }
      return null;
    });
  }
  var detailLookups = 0;
  function runDetail(force) {
    if (!isDetailPage()) { removePanel(); resetHeading(); performerFound = false; performerTitleMapCache = null; performerTitleMapFor = null; return; }
    // A panel drawn without a name is redrawn once the page links the model by name.
    if (!force && pageKey() === lastPath && document.getElementById(PANEL_ID) && !(namelessPanel && paramModelId() && modelFromPageLinks(paramModelId()))) return;
    lastPath = pageKey();
    var anchor = findAnchor();
    if (!anchor && site.anchorSel) return;
    var pid = paramModelId();
    var pname = pid ? null : paramModelName();
    var detailId = site.detail.test(location.pathname) ? site.modelKey(location.pathname) : null;
    var known = pid ? (rememberedModel(pid) || modelFromPageLinks(pid)) : pname ? rememberedModel('name:' + normName(pname)) : null;
    // A filtered list page has no URL of its own to save: use the remembered model page, else none (no add button).
    var name = pid ? ((known && known.name) || '') : pname || getModelName();
    var pageUrl = pid ? ((known && known.url) || site.modelUrl(location.origin, pid, '/model/' + pid)) : pname ? ((known && known.url) || '') : getPageUrl();
    var modelId = pid || detailId;
    if (!name && !modelId) return;
    // Picked sites wait for the picked name element; there is no title or id fallback to guess from.
    if (site.strictName && !name) return;
    if (name && (detailId || pid)) rememberModel(detailId || pid, name, pageUrl);
    if (name && detailId) rememberModel('name:' + normName(name), name, pageUrl);
    namelessPanel = !name;
    var label = name || ('model #' + modelId);
    renderLoading(anchor, label);
    // Only the newest lookup may draw: an older one that answers late would replace the current panel.
    var lookup = ++detailLookups;
    findPerformerById(modelId).then(function (byId) {
      if (byId) return { count: 1, performers: [byId], byId: true };
      if (!name) return { count: 0, performers: [] };
      return gql('query($q:String!){ findPerformers(filter:{q:$q, per_page:10}){ count performers{ id name alias_list urls } } }', { q: name }).then(function (data) { return (data && data.findPerformers) || { count: 0, performers: [] }; });
    }).then(function (fp) {
      if (lookup !== detailLookups) return;
      var exact = fp.byId ? fp.performers[0] : null;
      if (exact && pid && !name) rememberModel(pid, exact.name, pageUrl);
      // Names first, then aliases, so a performer called exactly this wins over one that only lists it as an alias.
      for (var i = 0; i < fp.performers.length && !exact && name; i++) { if (normName(fp.performers[i].name) === normName(name)) exact = fp.performers[i]; }
      for (var j = 0; j < fp.performers.length && !exact && name; j++) { if (performerNames(fp.performers[j]).some(function (n) { return normName(n) === normName(name); })) exact = fp.performers[j]; }
      log('info', 'performer lookup', '', { found: !!exact, performerId: exact ? exact.id : undefined, byId: !!fp.byId, hits: fp.count, modelId: modelId || undefined });
      var a2 = findAnchor();
      if (a2 || !site.anchorSel) render(a2, { name: label, pageUrl: pageUrl, count: fp.count, exact: exact, candidates: fp.performers.slice(0, 5) });
    }).catch(function (e) {
      if (lookup !== detailLookups) return;
      log('warn', 'stash unreachable', e.message, { view: 'model' });
      var a3 = findAnchor();
      if (a3 || !site.anchorSel) render(a3, { name: label, pageUrl: pageUrl, error: e.message });
    });
  }
  // Video page badge and card tags (adapters with scenePage/cardTags). Each video is looked up on its own by exact
  // title and canonical URL; results are cached per title + URL, failures are not.
  function postGql(query, variables) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: ENDPOINT,
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
    const fuzzy = !(opts && opts.fuzzy === false);
    const key = norm(title) + ' || ' + url + (fuzzy ? '' : ' || nofuzzy');
    if (lookupCache.has(key)) return lookupCache.get(key);
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
        // Neither matched: a file whose name holds the whole title (checked here too, not only by Stash's LIKE).
        let byFile = null;
        const pattern = !byTitle?.exact && !byUrl?.exact ? filePattern(title) : '';
        if (pattern) {
          try {
            const fd = await postGql(QP, { sf: { path: { value: pattern, modifier: 'INCLUDES' } } });
            const scenes = fd?.data?.findScenes?.scenes || [], nt = normTitle(title);
            byFile = { count: fd?.data?.findScenes?.count || 0, exact: scenes.find((s) => (s.files || []).some((f) => normTitle(String(f.basename || '').replace(/\.[^.]+$/, '')).includes(nt))) || null };
          } catch (e) {}
        }
        let similar = 0;
        if (fuzzy && !byTitle?.exact && !byUrl?.exact && !byFile?.exact && title) { try { const fb = await postGql(QF, { q: title }); similar = (fb?.data?.findScenes?.count) || 0; } catch (e) {} }
        const best = (byUrl && byUrl.exact) || (byTitle && byTitle.exact) || (byFile && byFile.exact) || null;
        const via = (byUrl?.exact && byTitle?.exact) ? 'url+title' : (byUrl?.exact ? 'url' : (byTitle?.exact ? 'title' : (byFile?.exact ? 'file' : '')));
        return { byTitle, byUrl, byFile, best, via, similar, cleanUrl: url, title };
      } catch (e) { return { error: String((e && e.message) || e).slice(0, 180) }; }
    })();
    lookupCache.set(key, p);
    p.then((v) => { if (v && v.error) lookupCache.delete(key); });
    return p;
  }
  // The model-page mark prepends a check to video titles; it is not part of the title.
  const videoTitle = (el) => (el ? el.innerText : '').replace(/^✓\s*/, '').trim();
  async function checkDetail() {
    if (!site.scenePage) return;
    if (!site.scenePage.test(location.pathname)) { document.getElementById('stash-exists-badge')?.remove(); return; }
    const h1 = q(site.sceneTitleSel);
    if (!h1) return;
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
    badge.href = STASH_ORIGIN + '/search?q=' + encodeURIComponent(title);
    h1.after(badge);
    // A scene id in the stored scene list answers without a request; otherwise exact title and canonical URL are asked.
    const pageKey = site.sceneKey(location.pathname);
    const listed = sceneMapCache && pageKey ? sceneMapCache[pageKey] : null;
    const res = listed ? { best: listed, via: 'url' } : await lookupVideo({ title, url: cleanUrl });
    if (!badge.isConnected || q(site.sceneTitleSel)?.innerText.trim() !== title) return;
    if (!res || res.error) log('warn', 'stash unreachable', res?.error || 'no result', { view: 'detail' });
    else log('info', 'detail checked', '', { inStash: !!res.best, sceneId: res.best?.id, via: res.via || undefined, byTitle: res.byTitle?.count || 0, byUrl: res.byUrl?.count || 0, similar: res.similar || 0 });
    if (!res || res.error) { badge.textContent = 'Stash unreachable'; badge.className = 'stash-err'; badge.title = (res?.error || 'fetch failed') + ' - is Stash running on ' + STASH_ORIGIN.replace(/^https?:\/\//, '') + '?'; return; }
    if (res.best) { badge.textContent = 'In Stash #' + res.best.id + ' (' + res.via + ')'; badge.className = 'stash-yes'; badge.href = STASH_ORIGIN + '/scenes/' + res.best.id; badge.title = 'Matched by ' + res.via + '\nTitle: ' + title + '\nURL: ' + cleanUrl + '\nStash: ' + (res.best.title || '') + '\n' + (res.best.urls || []).join('\n'); }
    else { const sim = res.similar || res.byTitle?.count || 0; badge.textContent = sim ? ('Not in Stash (' + sim + ' similar)') : 'Not in Stash'; badge.className = 'stash-no'; badge.title = 'No match\nTitle EQUALS: ' + (res.byTitle?.count || 0) + '\nURL INCLUDES ' + cleanUrl + ': ' + (res.byUrl?.count || 0) + (sim ? '\nFuzzy similar: ' + sim : ''); }
  }
  // Card tags go out four at a time with a 150 ms pause. A scene id already in the stored scene list answers at once,
  // so only cards Stash does not hold by URL cost a lookup: exact title, then file name (the URL query only while the
  // list is missing, since the list already holds every URL of the site's scenes).
  const cardQueue = [];
  let cardBusy = false;
  async function pumpCards() {
    if (cardBusy) return;
    cardBusy = true;
    const tally = { checked: 0, inStash: 0, fromList: 0, failed: 0 };
    try {
      await ensureSceneMap().catch(() => {});
      while (cardQueue.length) {
        const batch = cardQueue.splice(0, 4), sceneMap = sceneMapCache || {}, haveList = !!sceneMapCache;
        await Promise.all(batch.map(async (job) => {
          try {
            const listed = job.key ? sceneMap[job.key] : null;
            const res = listed ? { best: listed, via: 'url' } : await lookupVideo({ title: job.title, url: haveList ? '' : job.url, fuzzy: false });
            tally.checked++;
            if (listed) tally.fromList++;
            if (res?.best) tally.inStash++;
            if (res?.error) tally.failed++;
            showTag(job, res);
          } catch (e) { tally.failed++; }
        }));
        if (cardQueue.length) await new Promise((r) => setTimeout(r, 150));
      }
    } finally {
      cardBusy = false;
      log(tally.failed ? 'warn' : 'debug', 'cards checked', '', tally);
    }
  }
  // One tag per video card, in the card's top-left corner like the "IN STASH" badge and never inside the title: the card
  // is the videoCardSel match or the largest element around the link that holds only this video (carousels included).
  function checkCards() {
    if (!site.cardTags) return;
    document.querySelectorAll(site.videoLinkSel).forEach((a) => {
      const key = site.sceneKey(a.getAttribute('href') || '');
      if (!key) return;
      const card = cardFor(a);
      if (!card || card.dataset.stashQueued === key) return;
      // A single-page app reused the card for another video: its old tag goes, the new video is checked.
      if (card.dataset.stashQueued) { const old = card.querySelector('.stash-exists-tag'); if (old) old.remove(); }
      const title = site.videoTitleSel ? videoTitle(card.querySelector(site.videoTitleSel)) : (a.getAttribute('title') || videoTitle(a.querySelector('span')) || videoTitle(a)).trim();
      if (title.length < 3) return;
      card.dataset.stashQueued = key;
      cardQueue.push({ title, url: canonUrl(a.href), key, card });
    });
    if (cardQueue.length) pumpCards();
  }
  // Tag text and colour by how the video was found: URL (scene id), exact title, or file name; grey when it is not in
  // Stash. Nothing is shown when Stash did not answer, so an outage never reads as "not in Stash".
  const TAGS = { url: ['✓ IN STASH', '#16a34a'], title: ['✓ IN STASH · TITLE', '#0f766e'], file: ['✓ IN STASH · FILE', '#1d4ed8'], none: ['NOT IN STASH', 'rgba(63,63,70,.85)'] };
  function showTag(job, res) {
    const card = job.card;
    if (!card.isConnected || card.dataset.stashQueued !== job.key || !res || res.error) return;
    // The id badge of markVideos already says it; one corner, one tag.
    if (card.querySelector('.' + VIDEO_BADGE_CLASS + ', .stash-exists-tag')) return;
    const kind = res.best ? (/url/.test(res.via) ? 'url' : res.via) : 'none';
    const tag = document.createElement(res.best ? 'a' : 'span');
    tag.className = 'stash-exists-tag' + (res.best ? ' stash-yes' : '');
    tag.setAttribute('data-stash-via', kind);
    tag.textContent = TAGS[kind][0];
    tag.style.background = TAGS[kind][1];
    tag.title = res.best ? 'In Stash via ' + res.via + ': ' + (res.best.title || '') + ' (#' + res.best.id + ')' : 'Not in Stash (no URL, title or file name match)\n' + job.title + '\n' + job.url;
    if (res.best) {
      tag.href = STASH_ORIGIN + '/scenes/' + res.best.id;
      tag.target = '_blank';
      tag.rel = 'noopener';
      tag.addEventListener('click', (ev) => ev.stopPropagation());
    }
    try { if (getComputedStyle(card).position === 'static') card.style.position = 'relative'; } catch (e) {}
    card.appendChild(tag);
  }
  function run(force) { if (isDetailPage()) return runDetail(force); if (site.listing.test(location.pathname)) return runListing(force); removePanel(); resetHeading(); clearModelMarks(); performerFound = false; performerTitleMapCache = null; performerTitleMapFor = null; }
  // One scheduler follows the page: DOM changes (mutation observer), in-app navigation (pushState/popstate), arriving Stash
  // lists, and a 2-second heartbeat that also refreshes the lists (stored copies at once, refetched after 10 minutes).
  // A pass runs only when something changed, and the mutations a pass makes itself are dropped (takeRecords), so an idle
  // page costs nothing; structural card lookups are memoized for the length of a pass.
  var scenesResult = listResult('scenes'), performersResult = listResult('performers');
  function refreshLists() { ensureSceneMap().then(scenesResult[0], scenesResult[1]); fetchPerformerMap().then(performersResult[0], performersResult[1]); }
  var dirty = true, lastHref = '', tickTimer = 0, passMemo = null, lastPass = 0;
  var checks = !!(site.scenePage || site.cardTags);
  var observer = new MutationObserver(markDirty);
  // DOM changes run a pass at most once a second (a running player clock changes text all the time); navigation at once.
  function markDirty() { dirty = true; schedule(Math.max(300, lastPass + 1000 - Date.now())); }
  function markNavigation() { dirty = true; clearTimeout(tickTimer); tickTimer = 0; schedule(0); }
  function schedule(ms) { if (!tickTimer) tickTimer = setTimeout(tick, ms); }
  function tick() {
    tickTimer = 0;
    if (!dirty && location.href === lastHref) return;
    dirty = false;
    lastHref = location.href;
    lastPass = Date.now();
    passMemo = new Map();
    try {
      try { if (sceneMapCache) { var cards = videoCards(); markVideos(sceneMapCache, performerFound ? performerTitleMapCache : null, cards); updateVideoCount(cards); } } catch (e) {}
      try { if (performerMapCache) { if (site.listing.test(location.pathname)) markModelCards(performerMapCache); else markModelLinks(); } } catch (e2) {}
      try { run(false); } catch (e3) {}
      if (checks) { checkDetail(); checkCards(); }
    } finally { passMemo = null; observer.takeRecords(); }
  }
  // Video page badge and card tags (top left of the card, like the "IN STASH" badge).
  if (checks) GM_addStyle('#stash-exists-badge{display:inline-block;margin-left:12px;padding:4px 12px;border-radius:999px;font-size:13px;font-weight:800;vertical-align:middle;color:#fff;text-decoration:none;cursor:pointer}.stash-yes{background:#16a34a}.stash-no{background:#52525b}.stash-err{background:#b45309}.stash-exists-tag{position:absolute!important;top:6px;left:6px;z-index:5;padding:2px 8px;border-radius:6px;font:700 11px/1.4 system-ui,sans-serif;color:#fff!important;text-decoration:none!important;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.4)}');
  ['pushState', 'replaceState'].forEach(function (name) { var orig = history[name]; history[name] = function () { var r = orig.apply(this, arguments); markNavigation(); return r; }; });
  window.addEventListener('popstate', markNavigation);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href'] });
  refreshLists();
  schedule(0);
  setInterval(function () { refreshLists(); schedule(0); }, 2000);

  // Setup guide (Tampermonkey menu "Stash: set up this site", on every page). The user picks the performer name, a video
  // title in a list, the title on a video page and, optionally, a model name in a model list, on the site's own pages.
  // Each pick becomes one part of the site's profile and is logged with its page context (event "site onboarding": the
  // element, its ancestors, the derived selectors and URL rules, links found), so built-in support can be written from the
  // log. "Save and turn on" stores the profile and the site works at once. Guide and draft survive navigation (GM storage
  // per host). Only function declarations here (SETUP_ID and picking are above the module guard): on other sites the
  // script stops before any later var is assigned.
  function setupPicks() {
    return [
      { kind: 'model', label: 'Performer name', where: 'on a performer/model page', hint: 'Open a performer page, press Pick, then click the performer name.' },
      { kind: 'card', label: 'Video title in a list', where: 'on a page that lists videos', hint: 'Open a page with video cards, press Pick, then click the title of one video.' },
      { kind: 'video', label: 'Video page title', where: 'on a single video page', hint: 'Open one video, press Pick, then click its title.' },
      { kind: 'listing', label: 'Model name in a model list', where: 'on a page that lists models (optional)', hint: 'Open the list of models, press Pick, then click the name of one model.' }
    ];
  }
  function setupHost() { return location.hostname.toLowerCase(); }
  function setupKey() { return 'setup:v1:' + setupHost(); }
  function setupState() { try { var s = GM_getValue(setupKey(), null); return s && typeof s === 'object' ? s : {}; } catch (e) { return {}; } }
  function saveSetupState(s) { try { GM_setValue(setupKey(), s); } catch (e) {} }
  function loadProfiles() { try { var p = GM_getValue(PROFILES_KEY, null); return p && typeof p === 'object' ? p : {}; } catch (e) { return {}; } }
  function draftParts(d) { return d.stash && d.stash.sceneParts && d.stash.sceneParts.length ? d.stash.sceneParts : [registrableDomain(d.host)]; }
  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, '\\$&'); }
  // Class names that look generated (css-1x2y, e1vusg2z1, sc-AbC12) change with every build of a site, so they are skipped.
  function stableClasses(el) { return Array.prototype.filter.call(el.classList || [], function (c) { return /^[A-Za-z][\w-]{1,40}$/.test(c) && !/\d{3,}|^(?:css|sc|jsx|svelte|stash)-|^[a-z]+[0-9][a-z0-9]{4,}$/i.test(c) && !/^(?:active|hover|focus|selected|open|is-|has-)/.test(c); }).slice(0, 2); }
  function selectorPart(el) {
    if (el.id && /^[A-Za-z][\w-]{0,40}$/.test(el.id) && !/\d{3,}/.test(el.id) && !/^stash-/.test(el.id)) return '#' + cssEsc(el.id);
    return el.tagName.toLowerCase() + stableClasses(el).map(function (c) { return '.' + cssEsc(c); }).join('');
  }
  function firstMatchIs(root, sel, el) { try { return root.querySelector(sel) === el; } catch (e) { return false; } }
  // Shortest selector whose first match in root is el: the element itself, then with up to five ancestors, else an
  // :nth-of-type path (exact but fragile, so only the last resort).
  function selectorFor(el, root) {
    root = root || document;
    var sel = selectorPart(el), cur = el;
    for (var d = 0; d < 6; d++) {
      if (firstMatchIs(root, sel, el)) return sel;
      cur = cur.parentElement;
      if (!cur || cur === root || cur === document.documentElement) break;
      sel = selectorPart(cur) + ' ' + sel;
    }
    var path = [];
    for (cur = el; cur && cur !== root && cur !== document.documentElement; cur = cur.parentElement) {
      var n = 1;
      for (var s = cur.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === cur.tagName) n++;
      path.unshift(cur.tagName.toLowerCase() + ':nth-of-type(' + n + ')');
    }
    return (root === document ? '' : ':scope > ') + path.join(' > ');
  }
  function textOf(el) { return (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' '); }
  // What the log gets about a picked element: text, ancestor chain and markup, with query strings cut from every URL
  // (session tokens, referral ids, signed links).
  function describeElement(el) {
    var chain = [];
    for (var cur = el, d = 0; cur && cur !== document.body && d < 8; cur = cur.parentElement, d++) chain.push(cur.tagName.toLowerCase() + (cur.id ? '#' + cur.id : '') + Array.prototype.map.call(cur.classList, function (c) { return '.' + c; }).join(''));
    var html = el.outerHTML.replace(/\b(href|src|srcset|data-src|poster)="([^"]*)"/gi, function (m0, a, v) { return a + '="' + v.split(/[?#]/)[0] + '"'; }).replace(/\s+/g, ' ');
    return { text: textOf(el).slice(0, 120), chain: chain, html: html.slice(0, 1500) };
  }
  // The link of a picked title or name: its own link, else a link in the smallest ancestor that has one (one with a
  // numeric path segment first, since that is usually the video or model page).
  function linkNear(el) {
    var own = el.closest('a[href]');
    if (own) return own;
    for (var cur = el.parentElement, d = 0; cur && cur !== document.body && d < 6; cur = cur.parentElement, d++) {
      var ls = Array.prototype.filter.call(cur.querySelectorAll('a[href]'), function (a) { return pathSegments(new URL(a.href, location.href).pathname).length; });
      if (ls.length) return ls.filter(function (a) { return /\/\d+(?:[/?#]|$)/.test(new URL(a.href, location.href).pathname); })[0] || ls[0];
    }
    return null;
  }
  function derivePick(kind, el) {
    var text = textOf(el), page = location.pathname;
    if (!text) return { error: 'That element has no text; click the name or title itself.' };
    if (kind === 'model') { var mp = linkPrefixOf(page, text); return { path: pathPatternOf(page, text), nameSel: selectorFor(el), linkPrefix: mp, key: keyModeOf(page, mp), sample: { page: page, name: text.slice(0, 80) } }; }
    if (kind === 'video') { var vp = linkPrefixOf(page, ''); return { path: pathPatternOf(page, ''), titleSel: selectorFor(el), linkPrefix: vp, key: keyModeOf(page, vp), sample: { page: page, title: text.slice(0, 120) } }; }
    var a = linkNear(el);
    if (!a) return { error: 'No link next to that element; click the title of an entry that links to its own page.' };
    var u = new URL(a.href, location.href);
    if (u.host !== location.host) return { error: 'That link leads to another site (' + u.host + ').' };
    var prefix = linkPrefixOf(u.pathname, kind === 'listing' ? text : ''), key = keyModeOf(u.pathname, prefix);
    var card = structuralCard(a, selectorAttr(prefix), profileKey(setupHost(), prefix, key)) || a.parentElement;
    var rel = card.contains(el) ? selectorFor(el, card) : '';
    if (kind === 'card') return { linkPrefix: prefix, titleSel: rel, key: key, sample: { page: page, link: u.pathname, title: text.slice(0, 120) } };
    return { path: '^' + escapeRe(page.replace(/\/+$/, '')) + '/?$', nameSel: rel, linkPrefix: prefix, key: key, sample: { page: page, link: u.pathname, name: text.slice(0, 80) } };
  }
  // How many entries of the picked kind this page links, by the derived prefix and key rule.
  function pageContext(part) {
    var prefix = part.linkPrefix || '', keyFn = profileKey(setupHost(), prefix, part.key || 'id'), keys = {};
    var links = prefix ? document.querySelectorAll(selectorAttr(prefix)) : [];
    for (var i = 0; i < links.length; i++) { var k = keyFn(links[i].getAttribute('href') || ''); if (k) keys[k] = 1; }
    var ks = Object.keys(keys);
    return { title: document.title.slice(0, 120), links: links.length, keys: ks.length, sampleKeys: ks.slice(0, 5) };
  }
  function pickSummary(kind, p) {
    if (kind === 'model') return 'Name "' + p.sample.name + '" from ' + p.nameSel + '; performer pages: ' + p.path;
    if (kind === 'video') return 'Title "' + p.sample.title + '" from ' + p.titleSel + '; video pages: ' + p.path;
    if (kind === 'card') return 'Videos linked as ' + p.linkPrefix + '… (' + p.key + '), title from ' + (p.titleSel || 'the link') + ', e.g. "' + p.sample.title + '"';
    return 'Models linked as ' + p.linkPrefix + '… (' + p.key + ') on ' + p.path + ', name from ' + (p.nameSel || 'the link');
  }
  function stopPick() { if (picking) { var off = picking; picking = null; off(); } }
  function startPick(kind, label) {
    stopPick();
    var box = document.createElement('div');
    box.setAttribute('data-setup', 'box');
    box.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #f59e0b;background:rgba(245,158,11,.15);border-radius:3px;display:none;';
    document.documentElement.appendChild(box);
    function onPage(t) { return t && t.nodeType === 1 && !t.closest('#userscript-dock, #' + SETUP_ID); }
    function over(ev) { if (!onPage(ev.target)) { box.style.display = 'none'; return; } var r = ev.target.getBoundingClientRect(); box.style.cssText += 'display:block;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;'; }
    // Capture on window runs before the site's own handlers (single-page routers listen at their root), so a pick never
    // follows a link or opens a player.
    function block(ev) { if (!onPage(ev.target)) return; ev.preventDefault(); ev.stopImmediatePropagation(); if (ev.type === 'click') { var t = ev.target; stopPick(); finishPick(kind, t); } }
    function keys(ev) { if (ev.key === 'Escape') { ev.preventDefault(); stopPick(); renderSetup(setupState(), 'Pick cancelled.'); } }
    var types = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'auxclick', 'dblclick'];
    window.addEventListener('mouseover', over, true);
    types.forEach(function (t) { window.addEventListener(t, block, true); });
    window.addEventListener('keydown', keys, true);
    picking = function () { window.removeEventListener('mouseover', over, true); types.forEach(function (t) { window.removeEventListener(t, block, true); }); window.removeEventListener('keydown', keys, true); box.remove(); };
    renderSetup(setupState(), 'Click the ' + label.toLowerCase() + ' on the page (it lights up under the mouse). Esc cancels.');
  }
  function finishPick(kind, el) {
    var st = setupState();
    if (!st.draft) return;
    var part;
    try { part = derivePick(kind, el); } catch (e) { part = { error: e.message }; }
    if (part.error) { log('warn', 'site onboarding', 'pick failed: ' + part.error, { host: st.draft.host, kind: kind, element: describeElement(el) }); renderSetup(st, part.error); return; }
    st.draft[kind] = part;
    saveSetupState(st);
    var ctx = pageContext(part);
    log('info', 'site onboarding', kind + ' picked', { host: st.draft.host, kind: kind, part: part, element: describeElement(el), page: ctx });
    var msg = kind === 'card' || kind === 'listing' ? 'This page links ' + ctx.keys + ' ' + (kind === 'card' ? 'videos' : 'models') + ' that way' + (ctx.sampleKeys.length ? ' (keys ' + ctx.sampleKeys.join(', ') + ').' : '.') : 'Saved in the draft.';
    renderSetup(st, msg);
  }
  // What Stash already holds for this site: scene and performer counts per URL fragment and sample scene URLs with the key
  // the profile reads from them (it must match the key of the site's own links).
  function surveyStash(d) {
    var keyOf = profileSite(Object.assign({}, d, { card: d.card || d.video || { linkPrefix: '/' } }), null).sceneKey;
    return Promise.all(draftParts(d).map(function (part) {
      return Promise.all([
        gql('query($part:String!){ findScenes(scene_filter:{url:{value:$part, modifier:INCLUDES}}, filter:{per_page:5}){ count scenes{ urls } } }', { part: part }),
        gql('query($part:String!){ findPerformers(performer_filter:{url:{value:$part, modifier:INCLUDES}}, filter:{per_page:1}){ count } }', { part: part })
      ]).then(function (r) {
        var fs = (r[0] && r[0].findScenes) || {}, urls = [];
        (fs.scenes || []).forEach(function (s) { (s.urls || []).forEach(function (u) { if (u.indexOf(part) >= 0 && urls.length < 3) urls.push(u); }); });
        return { part: part, scenes: fs.count || 0, performers: (r[1] && r[1].findPerformers && r[1].findPerformers.count) || 0, samples: urls.map(function (u) { return { url: canonUrl(u), key: keyOf(u) }; }) };
      });
    }));
  }
  function openSetup(fromMenu) {
    var st = setupState();
    if (!st.draft || validProfile(st.draft)) st.draft = JSON.parse(JSON.stringify(profiles[setupHost()] || { v: 1, host: setupHost() }));
    st.open = true;
    saveSetupState(st);
    if (fromMenu) log('info', 'site onboarding', 'guide opened', { host: setupHost(), supported: !!site, builtIn: !!(site && !site.strictName) });
    renderSetup(st, '');
  }
  function closeSetup() { stopPick(); var p = document.getElementById(SETUP_ID); if (p) p.remove(); var st = setupState(); st.open = false; saveSetupState(st); }
  function saveProfile(st) {
    var d = st.draft, err = validProfile(d);
    if (!err && !d.model && !d.card && !d.video && !d.listing) err = 'pick at least one element first';
    if (err) { renderSetup(st, 'Not saved: ' + err + '.'); return; }
    d.v = 1;
    d.updatedAt = new Date().toISOString();
    var all = loadProfiles();
    all[d.host] = d;
    try { GM_setValue(PROFILES_KEY, all); } catch (e) {}
    log('info', 'site profile saved', '', { host: d.host, profile: d, survey: st.survey || null });
    sink.flush();
    st.open = false;
    saveSetupState(st);
    location.reload();
  }
  function renderSetup(st, msg) {
    var old = document.getElementById(SETUP_ID);
    if (old) old.remove();
    var d = st.draft, div = document.createElement('div');
    div.id = SETUP_ID;
    div.style.cssText = 'width:360px;max-width:calc(100vw - 24px);max-height:calc(100vh - 40px);overflow-y:auto;box-sizing:border-box;padding:10px 12px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:10px;font:12px/1.5 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.5);text-align:left;';
    function el(tag, text, css) { var e = document.createElement(tag); if (text) e.textContent = text; if (css) e.style.cssText = css; return e; }
    function button(text, name, fn, primary) { var b = el('button', text, 'margin:4px 4px 0 0;padding:3px 10px;border-radius:6px;border:1px solid #475569;background:' + (primary ? '#2563eb' : '#1e293b') + ';color:#fff;cursor:pointer;font:inherit;'); b.type = 'button'; b.setAttribute('data-setup', name); b.addEventListener('click', fn); return b; }
    function section() { return el('div', '', 'margin-top:8px;padding-top:6px;border-top:1px solid #1e293b;'); }
    div.appendChild(el('div', 'STASH SETUP · ' + d.host, 'font-weight:700;'));
    var builtIn = site && !site.strictName;
    div.appendChild(el('div', builtIn ? 'Built-in site: picks here only change the name, title and video page selectors.' : site ? 'Set up from your picks; pick again to change them.' : 'Not supported yet. Pick the elements below on this site\'s pages; every pick is logged for built-in support, and "Save and turn on" activates them here right away.', 'color:#94a3b8;'));
    setupPicks().forEach(function (p) {
      var part = d[p.kind], row = section();
      row.appendChild(el('div', (part ? '✓ ' : '• ') + p.label + ' – ' + p.where, 'font-weight:600;color:' + (part ? '#86efac' : '#e2e8f0') + ';'));
      row.appendChild(el('div', part ? pickSummary(p.kind, part) : p.hint, 'color:#94a3b8;word-break:break-all;'));
      row.appendChild(button(part ? 'Pick again' : 'Pick', 'pick-' + p.kind, function () { startPick(p.kind, p.label); }, !part));
      if (part) row.appendChild(button('Clear', 'clear-' + p.kind, function () { delete d[p.kind]; saveSetupState(st); renderSetup(st, ''); }));
      div.appendChild(row);
    });
    var stash = section();
    stash.appendChild(el('div', 'Stash URLs of this site contain', 'font-weight:600;'));
    var parts = el('input', '', 'width:100%;box-sizing:border-box;margin-top:2px;padding:3px 6px;border-radius:5px;border:1px solid #475569;background:#020617;color:#e2e8f0;font:inherit;');
    parts.setAttribute('data-setup', 'parts');
    parts.value = draftParts(d).join(', ');
    parts.title = 'Comma-separated URL fragments, e.g. example.com or example.com/video/';
    parts.addEventListener('change', function () { var list = parts.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean); if (list.length) d.stash = { sceneParts: list }; else delete d.stash; saveSetupState(st); });
    stash.appendChild(parts);
    stash.appendChild(button('Check Stash', 'survey', function () {
      renderSetup(st, 'Asking Stash ...');
      surveyStash(d).then(function (res) { st.survey = res; saveSetupState(st); log('info', 'site onboarding', 'stash survey', { host: d.host, survey: res }); renderSetup(st, ''); }, function (e) { renderSetup(st, 'Cannot reach Stash at ' + STASH_ORIGIN + ': ' + e.message); });
    }));
    (st.survey || []).forEach(function (s) {
      stash.appendChild(el('div', s.part + ': ' + s.scenes + ' scenes, ' + s.performers + ' performers in Stash', 'color:' + (s.scenes ? '#86efac' : '#fcd34d') + ';'));
      s.samples.forEach(function (x) { stash.appendChild(el('div', x.url + ' → key ' + (x.key || 'none'), 'color:' + (x.key ? '#94a3b8' : '#fca5a5') + ';font-size:11px;word-break:break-all;')); });
    });
    var tagsRow = el('label', '', 'display:block;margin-top:4px;cursor:pointer;');
    var tagsBox = el('input');
    tagsBox.type = 'checkbox';
    tagsBox.checked = typeof d.tags === 'boolean' ? d.tags : !!(site && site.cardTags);
    tagsBox.setAttribute('data-setup', 'tags');
    tagsBox.addEventListener('change', function () { d.tags = tagsBox.checked; saveSetupState(st); });
    tagsRow.appendChild(tagsBox);
    tagsRow.appendChild(document.createTextNode(' In-Stash tag on every video card (by URL, title or file name); cards Stash does not hold by URL cost a few lookups each'));
    stash.appendChild(tagsRow);
    div.appendChild(stash);
    var actions = section();
    actions.appendChild(button('Save and turn on', 'save', function () { saveProfile(st); }, true));
    actions.appendChild(button('Send to log + copy', 'export', function () {
      var text = JSON.stringify({ script: 'stash-exists-checker', version: VERSION, profile: d, survey: st.survey || null }, null, 2);
      try { GM_setClipboard(text, 'text'); } catch (e) {}
      log('info', 'site profile exported', '', { host: d.host, profile: d, survey: st.survey || null });
      sink.flush();
      st.json = text;
      renderSetup(st, 'Copied, and sent to the log collector (event "site profile exported").');
    }));
    actions.appendChild(button('Import', 'import', function () { st.json = st.json || ''; st.importing = true; renderSetup(st, 'Paste a profile (or an export) and press Apply.'); }));
    if (loadProfiles()[d.host]) {
      actions.appendChild(button('Delete', 'delete', function () {
        if (!confirm('Delete the Stash setup of ' + d.host + '?')) return;
        var all = loadProfiles();
        delete all[d.host];
        try { GM_setValue(PROFILES_KEY, all); } catch (e) {}
        log('info', 'site profile deleted', '', { host: d.host });
        sink.flush();
        st.open = false;
        st.draft = null;
        saveSetupState(st);
        location.reload();
      }));
    }
    actions.appendChild(button('Close', 'close', closeSetup));
    if (st.json !== undefined && st.json !== null && (st.importing || st.json)) {
      var ta = el('textarea', '', 'display:block;width:100%;height:140px;box-sizing:border-box;margin-top:6px;background:#020617;color:#e2e8f0;border:1px solid #475569;border-radius:5px;font:11px/1.4 ui-monospace,monospace;');
      ta.setAttribute('data-setup', 'json');
      ta.value = st.json;
      actions.appendChild(ta);
      if (st.importing) {
        actions.appendChild(button('Apply', 'apply', function () {
          var obj;
          try { obj = JSON.parse(ta.value); } catch (e) { renderSetup(st, 'Not JSON: ' + e.message); return; }
          if (obj && obj.profile) obj = obj.profile;
          var err = validProfile(obj);
          if (err) { st.json = ta.value; renderSetup(st, 'Not a profile: ' + err + '.'); return; }
          st.draft = obj;
          st.importing = false;
          st.json = null;
          saveSetupState(st);
          renderSetup(st, 'Imported for ' + obj.host + '; press "Save and turn on" to keep it.');
        }));
      }
    }
    var line = el('div', msg || '', 'margin-top:6px;color:#fcd34d;');
    line.setAttribute('data-setup', 'msg');
    actions.appendChild(line);
    div.appendChild(actions);
    dockPanel(div, 36);
  }
})();
