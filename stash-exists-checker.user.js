// ==UserScript==
// @name         Stash Exists Checker - Reptyle
// @namespace    local.stash-exists-checker
// @version      3.0.0
// @description  Shows what is already in local Stash (localhost:9999) on supported sites (one adapter per site: Reptyle, Adult Time, Brazzers): a badge on video pages and cards, the Stash performer match with an add-URL button and Stash link on model pages, and in-Stash marks on models and videos.
// @match        https://app.reptyle.com/*
// @match        https://members.adulttime.com/*
// @match        https://site-ma.brazzers.com/*
// @updateURL    https://raw.githubusercontent.com/Morrison65/stash-exists-checker/master/stash-exists-checker.user.js
// @downloadURL  https://raw.githubusercontent.com/Morrison65/stash-exists-checker/master/stash-exists-checker.user.js
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      localhost
// @noframes
// ==/UserScript==

/* global module:readonly */

(function () {
  'use strict';
  const VERSION = '3.0.0';
  // One adapter per site or network: everything page-specific lives here, the core below is generic.
  // hosts: page hosts the adapter runs on (each needs an @match). detail/listing: model page paths.
  // anchorSel: the panel goes after it; empty means a floating panel. nameFromUrl (optional): model name from a path, tried first.
  // videoTitleSel (optional): the title element in a video card when the title is not the text of a scene link.
  // videoCardSel/modelCardSel empty: a card is the largest ancestor of a link that still holds only that one scene or model.
  // modelParam / modelNameParam (optional): a query parameter that filters a page to one model by id (?models=<id>) or by name;
  // such a page counts as that model's page.
  // performerUrlParts(id) (optional): URL fragments that find the performer in Stash by the site's model id, before any name search.
  // performerUrlRe (optional): which saved performer URLs carry this site's model ids (modelKey is applied only to those).
  // sceneUrlParts: URL fragments that select this site's scenes in Stash; sceneKey/modelKey reduce a URL to the id both sides share.
  // scenePage/sceneTitleSel (optional): video page path and its title element; the page gets a badge from lookupVideo.
  // cardDots (optional): every videoLinkSel link with a title (title attribute or a span) gets a dot: #<Stash id> or x.
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
    cardDots: true
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
    performerUrlRe: /^https?:\/\/(?:[a-z0-9-]+\.)?adulttime\.com\//i
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
    performerUrlParts: function (id) { return ['brazzers.com/model/' + id + '/', 'brazzers.com/pornstar/' + id + '/', 'brazzersnetwork.com/pornstar/' + id + '/']; }
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
  var STASH_ORIGIN = 'http://localhost:9999';
  var ENDPOINT = STASH_ORIGIN + '/graphql';
  // Single-video lookups (video pages and card dots): exact title and canonical URL; a free-text search only counts similar scenes.
  const QT = 'query($sf:SceneFilterType){findScenes(filter:{per_page:5},scene_filter:$sf){count scenes{id title urls}}}';
  const QF = 'query($q:String!){findScenes(filter:{q:$q,per_page:10}){count scenes{id title urls}}}';
  const lookupCache = new Map();
  const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const canonUrl = (u) => (u || '').split('?')[0].split('#')[0].trim();
  // Node unit tests load the pure helpers only (function declarations are hoisted); nothing else touches the page.
  if (typeof module === 'object' && module.exports) {
    module.exports = { logPage: logPage, createLogSink: createLogSink, VERSION: VERSION, SITES: SITES, siteFor: siteFor, cachedList: cachedList, normUrl: normUrl, normTitle: normTitle, normName: normName, extractMovieId: extractMovieId, extractModelId: extractModelId, extractGammaSceneId: extractGammaSceneId, extractGammaActorId: extractGammaActorId, gammaNameFromUrl: gammaNameFromUrl, ayloId: ayloId, ayloNameFromUrl: ayloNameFromUrl, modelIdFromParam: modelIdFromParam, modelNameFromParam: modelNameFromParam, norm: norm, canonUrl: canonUrl, lookupVideo: lookupVideo };
    return;
  }
  var site = siteFor(location.hostname);
  if (!site) return;
  var sink = createLogSink({ script: 'stash-exists-checker', version: VERSION });
  var log = sink.log;
  window.addEventListener('pagehide', function () { sink.flush(); });
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
  function siteFor(host) { host = String(host || '').toLowerCase(); for (var i = 0; i < SITES.length; i++) { for (var j = 0; j < SITES[i].hosts.length; j++) { var h = SITES[i].hosts[j]; if (host === h || host.slice(-h.length - 1) === '.' + h) return SITES[i]; } } return null; }
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
  function keyCount(el, linkSel, keyFn) { var keys = {}, n = 0; var ls = el ? el.querySelectorAll(linkSel) : []; for (var i = 0; i < ls.length; i++) { var k = keyFn(ls[i].getAttribute('href') || ls[i].href); if (k && !keys[k]) { keys[k] = 1; n++; } } return n; }
  // Largest ancestor of the link that holds only this one key: its parent is the list holding several.
  function structuralCard(link, linkSel, keyFn) { for (var el = link.parentElement, d = 0; el && el !== document.body && d < 8; el = el.parentElement, d++) { if (keyCount(el.parentElement, linkSel, keyFn) > 1) return el; } return link.parentElement; }
  function videoCards() { if (!site.videoCardSel) { var seen = [], links = document.querySelectorAll(site.videoLinkSel); for (var li = 0; li < links.length; li++) { if (!site.sceneKey(links[li].getAttribute('href') || links[li].href)) continue; var c = structuralCard(links[li], site.videoLinkSel, site.sceneKey); if (c && seen.indexOf(c) < 0) seen.push(c); } return seen.filter(function (c) { return !seen.some(function (o) { return o !== c && o.contains(c); }); }); } var all = Array.prototype.filter.call(document.querySelectorAll(site.videoCardSel), function (c) { var keys = {}, n = 0; var ls = c.querySelectorAll(site.videoLinkSel); for (var i = 0; i < ls.length; i++) { var k = site.sceneKey(ls[i].getAttribute('href') || ls[i].href); if (k && !keys[k]) { keys[k] = 1; n++; } } return ls.length > 0 && n <= 1; }); return all.filter(function (c) { return !all.some(function (o) { return o !== c && o.contains(c); }); }); }
  function cardTitleForCard(card) { if (site.videoTitleSel) { var te = card.querySelector(site.videoTitleSel); return te ? (te.innerText || te.textContent || '').trim() : ''; } var links = card.querySelectorAll(site.videoLinkSel); for (var ti = 0; ti < links.length; ti++) { var t = (links[ti].innerText || '').trim(); if (t) return t; } return ''; }
  function matchSceneForCard(card, urlMap, titleMap) { var as = card.querySelectorAll(site.videoLinkSel), id = null; for (var ai = 0; ai < as.length && !id; ai++) id = site.sceneKey(as[ai].getAttribute('href') || as[ai].href); if (!as.length) return null; if (id && urlMap && urlMap[id]) return urlMap[id]; if (titleMap) { var nt = normTitle(cardTitleForCard(card)); if (nt && titleMap[nt]) return titleMap[nt]; } return null; }
  function fetchScenesForUrlPart(part) { return (function next(page, acc) { return gql('query($h:String!,$p:Int!){ findScenes(scene_filter:{url:{value:$h, modifier:INCLUDES}}, filter:{per_page:500, page:$p}){ scenes{ id title urls } } }', { h: part, p: page }).then(function (data) { var ss = (data && data.findScenes && data.findScenes.scenes) || []; var all = acc.concat(ss); return (ss.length < 500 || page >= 20) ? all : next(page + 1, all); }); })(1, []); }
  function buildSceneMap() { var map = {}; for (var l = 0; l < site.sceneUrlParts.length; l++) { var scenes = sceneRows[site.sceneUrlParts[l]] || []; for (var i = 0; i < scenes.length; i++) { var s = scenes[i]; for (var j = 0; j < ((s.urls) || []).length; j++) { var id = site.sceneKey(s.urls[j]); if (id && !map[id]) map[id] = s; } } } sceneMapCache = map; }
  // One stored list per URL part, so adapters that share a part (Gamma's /en/video/) share its scenes.
  var sceneLists = site.sceneUrlParts.map(function (part) { return cachedList(stashStore, 'scenes:' + part, function () { return fetchScenesForUrlPart(part); }, function (items) { sceneRows[part] = items; buildSceneMap(); }); });
  function ensureSceneMap() { return Promise.all(sceneLists.map(function (get) { return get(); })).then(function () { return sceneMapCache; }); }
  function fetchPerformerTitleMap(pid) { if (performerTitleMapCache && performerTitleMapFor === String(pid)) return Promise.resolve(performerTitleMapCache); var num = parseInt(pid, 10); return gql('query{ findScenes(scene_filter:{performers:{value:[' + num + '], modifier:INCLUDES}}, filter:{per_page:200}){ count scenes{ id title urls } } }').then(function (data) { var map = {}; var scenes = ((data && data.findScenes && data.findScenes.scenes) || []); for (var i = 0; i < scenes.length; i++) { var k = normTitle(scenes[i].title); if (k && !map[k]) map[k] = scenes[i]; } performerTitleMapCache = map; performerTitleMapFor = String(pid); return map; }); }
  function titleLinkForCard(card) { if (site.videoTitleSel) return card.querySelector(site.videoTitleSel); var links = card.querySelectorAll(site.videoLinkSel); for (var li = 0; li < links.length; li++) { if ((links[li].innerText || '').trim()) return links[li]; } return null; }
  function styleVideoTitle(card, hit) { var link = titleLinkForCard(card); if (!link) return; var t = link.querySelector('span') || link; if (t.getAttribute && t.getAttribute('data-sml-video-green') === '1') return; t.style.color = '#22c55e'; t.style.fontWeight = '700'; t.setAttribute('data-sml-video-green', '1'); try { t.title = (hit.title || '') + ' (Stash id ' + hit.id + ')'; } catch (e) {} var chk = document.createElement('span'); chk.setAttribute('data-sml-video-check', '1'); chk.textContent = '\u2713 '; chk.style.cssText = 'color:#22c55e;font-weight:800;'; try { t.insertBefore(chk, t.firstChild); } catch (e2) {} }
  function unmarkVideoCard(card) { var b = card.querySelector('.' + VIDEO_BADGE_CLASS); if (b) b.remove(); var marked = card.querySelectorAll('[data-sml-video-green="1"]'); for (var cj = 0; cj < marked.length; cj++) { var m = marked[cj]; var chk = m.querySelector('[data-sml-video-check]'); if (chk) chk.remove(); m.style.color = ''; m.style.fontWeight = ''; m.removeAttribute('data-sml-video-green'); m.removeAttribute('title'); } }
  // Runs on every page and every re-check: marks cards whose scene is in Stash and drops marks that no longer fit
  // (single-page apps reuse card elements for other scenes). Titles only count when a performer's scenes are given.
  function markVideos(urlMap, titleMap) { var cards = videoCards(); for (var i = 0; i < cards.length; i++) { var card = cards[i]; var hit = matchSceneForCard(card, urlMap || {}, titleMap || null); var old = card.querySelector('.' + VIDEO_BADGE_CLASS); if (old && (!hit || old.getAttribute('data-sml-key') !== String(hit.id))) { unmarkVideoCard(card); old = null; } if (!hit) continue; if (!old) { try { if (getComputedStyle(card).position === 'static') card.style.position = 'relative'; } catch (e) {} var b = document.createElement('a'); b.className = VIDEO_BADGE_CLASS; b.setAttribute('data-sml-key', String(hit.id)); b.textContent = '\u2713 IN STASH'; b.href = STASH_ORIGIN + '/scenes/' + hit.id; b.target = '_blank'; b.rel = 'noopener'; b.title = (hit.title || '') + ' (Stash id ' + hit.id + ')'; b.style.cssText = 'position:absolute;top:6px;left:6px;z-index:5;background:#16a34a;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;text-decoration:none;box-shadow:0 1px 4px rgba(0,0,0,.4);'; b.addEventListener('click', function (ev) { ev.stopPropagation(); }); card.appendChild(b); } try { styleVideoTitle(card, hit); } catch (e2) {} } }
  function extractModelId(href) { var m = String(href || '').match(/\/models\/(\d+)/); return m ? m[1] : null; }
  function modelCardForLink(a) { if (!site.modelCardSel) return structuralCard(a, site.modelLinkSel, site.modelKey) || a; try { var card = a.closest(site.modelCardSel); if (card) return card; } catch (e) {} var el = a; for (var mi = 0; mi < 4 && el; mi++) { el = el.parentElement; if (el && el.matches && site.modelEntrySel && el.matches(site.modelEntrySel)) return el; } return a.parentElement || a; }
  function modelNameEl(card) { return (site.modelNameSel && card.querySelector(site.modelNameSel)) || card.querySelector('span'); }
  function modelNameForLink(a, card) { var fromUrl = site.nameFromUrl ? site.nameFromUrl(a.getAttribute('href') || a.href) : ''; if (fromUrl) return fromUrl; var s = modelNameEl(card); if (s && s.textContent.trim()) return s.textContent.trim(); var t = (a.innerText || '').trim(); if (t && t.length < 80) return t; return ''; }
  // Names compare like titles: case, accents and punctuation do not count ("Anna-Belle" = "anna belle").
  function normName(s) { return normTitle(s); }
  function performerNames(p) { return [p.name].concat(p.alias_list || []); }
  function fetchPerformerList() { return (function next(page, acc) { return gql('query($p:Int!){ findPerformers(filter:{per_page:500, page:$p}){ count performers{ id name alias_list urls } } }', { p: page }).then(function (data) { var ps = (data && data.findPerformers && data.findPerformers.performers) || []; var all = acc.concat(ps); return (ps.length < 500 || page >= 10) ? all : next(page + 1, all); }); })(1, []); }
  function buildPerformerMaps(all) { var map = {}; for (var i = 0; i < all.length; i++) { var k = normName(all[i].name); if (k && !map[k]) map[k] = all[i]; } for (var ai = 0; ai < all.length; ai++) { var al = all[ai].alias_list || []; for (var aj = 0; aj < al.length; aj++) { var ak = normName(al[aj]); if (ak && !map[ak]) map[ak] = all[ai]; } } var keys = {}; for (var ki = 0; ki < all.length; ki++) { var us = all[ki].urls || []; for (var kj = 0; kj < us.length; kj++) { if (site.performerUrlRe && !site.performerUrlRe.test(us[kj])) continue; var kk = site.modelKey(us[kj]); if (kk && !keys[kk]) keys[kk] = all[ki]; } } performerKeyMapCache = keys; performerMapCache = map; }
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
    placePanel(anchor, div);
    performerFound = true;
    vidLine.setAttribute('data-sml-video-count', '1');
    vidLine.setAttribute('data-sml-keep', '1');
    Promise.all([ensureSceneMap(), fetchPerformerTitleMap(p.id)]).then(function (maps) { markVideos(maps[0] || {}, maps[1] || {}); updateVideoCount(); }).catch(function (e) { log('warn', 'video check failed', e && e.message, { performerId: p.id }); vidLine.textContent = 'Video check failed.'; });
  }
  // Recounted on every re-check too, because single-page apps often render the video cards after the panel.
  function updateVideoCount() { var vidLine = document.querySelector('#' + PANEL_ID + ' [data-sml-video-count]'); if (!vidLine) return; var urlMap = sceneMapCache || {}, titleMap = performerTitleMapCache; var cards = videoCards(); var total = 0, hit = 0; for (var k = 0; k < cards.length; k++) { var la = cards[k].querySelector(site.videoLinkSel); if (!la) continue; var mid = site.sceneKey(la.getAttribute('href') || la.href); if (!mid && !cardTitleForCard(cards[k])) continue; total++; if (matchSceneForCard(cards[k], urlMap, titleMap)) hit++; } vidLine.textContent = total ? ('Videos on this page in Stash: ' + hit + '/' + total) : 'No videos found on this page.'; vidLine.style.color = hit ? '#86efac' : '#94a3b8'; }
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
    if (name && (detailId || pid)) rememberModel(detailId || pid, name, pageUrl);
    if (name && detailId) rememberModel('name:' + normName(name), name, pageUrl);
    namelessPanel = !name;
    var label = name || ('model #' + modelId);
    renderLoading(anchor, label);
    findPerformerById(modelId).then(function (byId) {
      if (byId) return { count: 1, performers: [byId], byId: true };
      if (!name) return { count: 0, performers: [] };
      return gql('query($q:String!){ findPerformers(filter:{q:$q, per_page:10}){ count performers{ id name alias_list urls } } }', { q: name }).then(function (data) { return (data && data.findPerformers) || { count: 0, performers: [] }; });
    }).then(function (fp) {
      var exact = fp.byId ? fp.performers[0] : null;
      if (exact && pid && !name) rememberModel(pid, exact.name, pageUrl);
      // Names first, then aliases, so a performer called exactly this wins over one that only lists it as an alias.
      for (var i = 0; i < fp.performers.length && !exact && name; i++) { if (normName(fp.performers[i].name) === normName(name)) exact = fp.performers[i]; }
      for (var j = 0; j < fp.performers.length && !exact && name; j++) { if (performerNames(fp.performers[j]).some(function (n) { return normName(n) === normName(name); })) exact = fp.performers[j]; }
      log('info', 'performer lookup', '', { found: !!exact, performerId: exact ? exact.id : undefined, byId: !!fp.byId, hits: fp.count, modelId: modelId || undefined });
      var a2 = findAnchor();
      if (a2 || !site.anchorSel) render(a2, { name: label, pageUrl: pageUrl, count: fp.count, exact: exact, candidates: fp.performers.slice(0, 5) });
    }).catch(function (e) {
      log('warn', 'stash unreachable', e.message, { view: 'model' });
      var a3 = findAnchor();
      if (a3 || !site.anchorSel) render(a3, { name: label, pageUrl: pageUrl, error: e.message });
    });
  }
  // Video page badge and card dots (adapters with scenePage/cardDots). Each video is looked up on its own by exact
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
    const key = norm(title) + ' || ' + url;
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
        let similar = 0;
        if (!byTitle?.exact && !byUrl?.exact && title) { try { const fb = await postGql(QF, { q: title }); similar = (fb?.data?.findScenes?.count) || 0; } catch (e) {} }
        const best = (byUrl && byUrl.exact) || (byTitle && byTitle.exact) || null;
        const via = (byUrl?.exact && byTitle?.exact) ? 'url+title' : (byUrl?.exact ? 'url' : (byTitle?.exact ? 'title' : ''));
        return { byTitle, byUrl, best, via, similar, cleanUrl: url, title };
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
    const res = await lookupVideo({ title, url: cleanUrl });
    if (!badge.isConnected || q(site.sceneTitleSel)?.innerText.trim() !== title) return;
    if (!res || res.error) log('warn', 'stash unreachable', res?.error || 'no result', { view: 'detail' });
    else log('info', 'detail checked', '', { inStash: !!res.best, sceneId: res.best?.id, via: res.via || undefined, byTitle: res.byTitle?.count || 0, byUrl: res.byUrl?.count || 0, similar: res.similar || 0 });
    if (!res || res.error) { badge.textContent = 'Stash unreachable'; badge.className = 'stash-err'; badge.title = (res?.error || 'fetch failed') + ' - is Stash running on ' + STASH_ORIGIN.replace(/^https?:\/\//, '') + '?'; return; }
    if (res.best) { badge.textContent = 'In Stash #' + res.best.id + ' (' + res.via + ')'; badge.className = 'stash-yes'; badge.href = STASH_ORIGIN + '/scenes/' + res.best.id; badge.title = 'Matched by ' + res.via + '\nTitle: ' + title + '\nURL: ' + cleanUrl + '\nStash: ' + (res.best.title || '') + '\n' + (res.best.urls || []).join('\n'); }
    else { const sim = res.similar || res.byTitle?.count || 0; badge.textContent = sim ? ('Not in Stash (' + sim + ' similar)') : 'Not in Stash'; badge.className = 'stash-no'; badge.title = 'No match\nTitle EQUALS: ' + (res.byTitle?.count || 0) + '\nURL INCLUDES ' + cleanUrl + ': ' + (res.byUrl?.count || 0) + (sim ? '\nFuzzy similar: ' + sim : ''); }
  }
  // Card dots go out four at a time with a 150 ms pause. A scene id already in the stored scene list answers at once,
  // so only cards Stash does not hold by URL cost a lookup.
  const cardQueue = [];
  let cardBusy = false;
  async function pumpCards() {
    if (cardBusy) return;
    cardBusy = true;
    const tally = { checked: 0, inStash: 0, fromList: 0, failed: 0 };
    try {
      await ensureSceneMap().catch(() => {});
      while (cardQueue.length) {
        const batch = cardQueue.splice(0, 4), sceneMap = sceneMapCache || {};
        await Promise.all(batch.map(async (job) => {
          try {
            const listed = job.key ? sceneMap[job.key] : null;
            const res = listed ? { best: listed, via: 'url' } : await lookupVideo({ title: job.title, url: job.url });
            tally.checked++;
            if (listed) tally.fromList++;
            if (res?.best) tally.inStash++;
            if (res?.error) tally.failed++;
            if (!job.el.isConnected) return;
            job.el.textContent = res?.best ? '#' + res.best.id : 'x';
            job.el.classList.toggle('stash-yes', !!res?.best);
            job.el.title = res?.best ? ('In Stash via ' + res.via + ': ' + res.best.title + ' (#' + res.best.id + ')') : ('Not in Stash\n' + job.title + '\n' + (job.url || ''));
          } catch (e) { tally.failed++; }
        }));
        if (cardQueue.length) await new Promise((r) => setTimeout(r, 150));
      }
    } finally {
      cardBusy = false;
      log(tally.failed ? 'warn' : 'debug', 'cards checked', '', tally);
    }
  }
  function checkCards() {
    if (!site.cardDots) return;
    document.querySelectorAll(site.videoLinkSel).forEach((a) => {
      const key = site.sceneKey(a.getAttribute('href') || '');
      if (!key) return;
      const title = (a.getAttribute('title') || videoTitle(a.querySelector('span')) || '').trim();
      if (title.length < 3) return;
      const wrap = a.parentElement || a;
      if (wrap.querySelector(':scope > .stash-card-dot')) return;
      if (a.dataset.stashQueued) return;
      a.dataset.stashQueued = '1';
      const dot = document.createElement('span');
      dot.className = 'stash-card-dot';
      dot.textContent = '?';
      dot.title = 'Checking Stash: ' + title + '\n' + canonUrl(a.href);
      wrap.style.position = wrap.style.position || 'relative';
      wrap.prepend(dot);
      cardQueue.push({ title, url: canonUrl(a.href), key, el: dot });
    });
    if (cardQueue.length) pumpCards();
  }
  function run(force) { if (isDetailPage()) return runDetail(force); if (site.listing.test(location.pathname)) return runListing(force); removePanel(); resetHeading(); clearModelMarks(); performerFound = false; performerTitleMapCache = null; performerTitleMapFor = null; }
  var tries = 0;
  var boot = setInterval(function () { tries++; if (findAnchor() || !site.anchorSel || q(site.modelEntrySel)) { clearInterval(boot); run(true); } else if (tries > 40) clearInterval(boot); }, 500);
  // Every page: use the stored Stash lists at once (refetched when older than 10 minutes), then re-check marks every two seconds.
  var scenesResult = listResult('scenes'), performersResult = listResult('performers');
  function refreshLists() { ensureSceneMap().then(scenesResult[0], scenesResult[1]); fetchPerformerMap().then(performersResult[0], performersResult[1]); }
  refreshLists();
  setInterval(function () { refreshLists(); try { if (sceneMapCache) { markVideos(sceneMapCache, performerFound ? performerTitleMapCache : null); updateVideoCount(); } } catch (e) {} try { if (performerMapCache) { if (site.listing.test(location.pathname)) markModelCards(performerMapCache); else markModelLinks(); } } catch (e2) {} run(false); }, 2000);
  // Video page badge and card dots follow in-app navigation; the dot sits top right, the "IN STASH" card badge top left.
  if (site.scenePage || site.cardDots) {
    GM_addStyle('#stash-exists-badge{display:inline-block;margin-left:12px;padding:4px 12px;border-radius:999px;font-size:13px;font-weight:800;vertical-align:middle;color:#fff;text-decoration:none;cursor:pointer}.stash-yes{background:#16a34a}.stash-no{background:#52525b}.stash-err{background:#b45309}.stash-card-dot{position:absolute;top:6px;right:6px;z-index:5;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:800;color:#fff;background:#52525b;pointer-events:none}.stash-card-dot.stash-yes{background:#16a34a}');
    let t = 0;
    const schedule = () => { clearTimeout(t); t = setTimeout(() => { checkDetail(); checkCards(); }, 400); };
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    const _push = history.pushState;
    history.pushState = function (...args) { const r = _push.apply(this, args); schedule(); return r; };
    window.addEventListener('popstate', schedule);
    checkDetail();
    checkCards();
  }
})();
