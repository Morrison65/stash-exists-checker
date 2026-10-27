# stash-exists-checker

Tampermonkey userscript for **desktop Chrome** that shows, on supported sites, what is already in your local [Stash](https://stashapp.cc) (`http://localhost:9999`). Version **3.0.0**. Supported so far: Reptyle (`app.reptyle.com`), Adult Time members (`members.adulttime.com`) and Brazzers members (`site-ma.brazzers.com`); more sites follow as adapters.

**v3.0.0** merges [`reptyle-stash-model-link`](https://github.com/Morrison65/reptyle-stash-model-link) 8.5.0 into this script, so one script now does both jobs: the video badge and card dots of the checker, and the model-link's performer panel, add-URL buttons, in-Stash marks and the Adult Time and Brazzers adapters (its history is below). Changes against the two separate scripts:
- **Disable or remove "Reptyle Stash Model Link" in Tampermonkey** after installing this version. Both scripts use the same element ids and would fight over the same panel and marks.
- The card dot moved from the top left to the top right of a card, so it no longer covers the green `IN STASH` badge.
- A card whose scene id is already in the stored Stash scene list gets its dot from that list; only the other cards are looked up one by one (before, every card cost two or three Stash requests).
- The floating panel (Adult Time, Brazzers) sits at dock order 35 instead of 30, and its log entries now come from `stash-exists-checker`.
- New grants `GM_getValue`/`GM_setValue` (Tampermonkey asks to confirm them once) and `@updateURL`/`@downloadURL`: from now on the script updates itself from `master`.
- The video badge and the card dots still run on Reptyle only; the Adult Time and Brazzers video pages were not available to find their title element.

**v2.1.0** sends structured logs (start, every movie-page result, per-batch card counts, an unreachable Stash) to the local userscript log collector on `http://localhost:7790` (see `docker-workspace/docs/userscripts.md`). When the collector is not running, up to 500 entries wait in the tab's memory and are retried with backoff, and the badges work as before.

**v2.0.0** is the first release in its own repository. The code was supplied as a Sider code-agent preview (`siderRuntime`), not as a Tampermonkey script, and was ported: `siderRuntime.fetch`/`addStyle` were replaced by `GM_xmlhttpRequest`/`GM_addStyle` with explicit `@connect`/`@grant`; the Sider-only `@bound-url` and `@changelog` headers were dropped. Two latent bugs were fixed: the whitespace normaliser used `/\\s+/` (a literal backslash) so runs of spaces never collapsed, and an unreachable Stash was reported as "Not in Stash" (and cached) instead of "Stash unreachable". Original v2 behavior: lookup by canonical URL plus exact title, badge shows which matched.

### History of the merged model link (reptyle-stash-model-link)

- **8.5.0**: the floating panel (Adult Time, Brazzers) moved into the shared bottom-right dock `#userscript-dock`; structured logs (start, each performer lookup, add-URL results, Stash lists that start or stop failing) go to the local log collector.
- **8.4.1**: both add-URL buttons read the performer's current URLs from Stash right before the update and append to those (the update replaces the whole list), so URLs added elsewhere in the meantime are kept.
- **8.4.0**: the two bulk Stash lists, all performers and each site's scenes, are kept in Tampermonkey storage, shared by every site and tab, refetched in the background after 10 minutes and ignored after a day. Adding a URL drops the stored performer list.
- **8.3.0**: every page of a supported site marks what Stash has, not only model pages: video cards by the site's scene id and model links by the model id in a saved performer URL (`performerUrlRe` limits which saved URLs count per site); marks are dropped from cards the single-page app reuses for other scenes.
- **8.2.0/8.2.1**: Brazzers adapter (performer found first by the model id in a saved Stash URL; cards found by structure because class names are build hashes), pages filtered to one model (Brazzers `?models=<id>`, Adult Time "See all") count as that model's page, model pages remembered in Tampermonkey storage; a small floating panel with folded saved URLs and a remembered fold toggle.
- **8.1.0/8.1.1**: Adult Time adapter: name from the pornstar URL, floating panel, videos matched by the Gamma scene id shared across all Gamma sites, titles from the card's `h2.Title`.
- **8.0.0**: generic core plus one adapter per site; add-URL buttons confirm before writing; performers also match by alias; the scene lookup pages through all scenes of the site.
- **7.0.0**: ported from a Sider code-agent preview; `@match` widened to the whole site because Reptyle is a single-page app. Original v7 behavior: also mark in-Stash video titles green with a checkmark.

## Install

1. In Chrome/Edge, turn on **Allow User Scripts** for Tampermonkey (extension details → right-click the icon → Manage extension), otherwise no userscript runs.
2. Open the [raw userscript on `master`](https://raw.githubusercontent.com/Morrison65/stash-exists-checker/master/stash-exists-checker.user.js); Tampermonkey shows its install page, click **Install** (or **Update** over an earlier version). A copy imported from a file before v3.0.0 has no update URL; install it once from this link.
3. Disable or remove **Reptyle Stash Model Link** in Tampermonkey (its features are part of this script now).
4. Reload the tab of the supported site. When Tampermonkey asks about cross-origin requests, review the `@connect` entries below and choose **Always allow**.

Runs only on the hosts of its adapters, currently `https://app.reptyle.com/*`, `https://members.adulttime.com/*` and `https://site-ma.brazzers.com/*` (top frame only).

## Updates

The script carries `@updateURL`/`@downloadURL` pointing at the raw file on `master`. Tampermonkey checks that URL on its update interval (default daily; **Utilities → Check for userscript updates** or the script's *Last updated* column forces it) and installs a pushed version when its `@version` is higher. A push without a version bump is not picked up, so `npm run check` and CI refuse a changed userscript whose `@version` is not higher than on `origin/master` (`tools/check-version-bump.cjs`).

## What it does

- **Video page** (Reptyle `/movies/<id>`): a badge after the title. Green `In Stash #<id> (url|title|url+title)` links to the scene; grey `Not in Stash` (with a fuzzy-hit count) otherwise; orange `Stash unreachable` when Stash does not answer. Scenes are looked up by canonical URL (query string and `#fragment` removed, Stash `url INCLUDES`) and by exact title (`title EQUALS`, whitespace and case normalised). If neither matches, a free-text search only supplies the "similar" count.
- **Card dots** (Reptyle): a small dot at the top right of every video card with a title, `#<id>` when the video is in Stash and `x` when it is not, checked four cards at a time. A scene id in the stored Stash scene list answers at once; other cards use the same lookup as the video page.
- **Model page** (Reptyle `/models/<id>`, Adult Time `/en/pornstar/view/<Name>/<id>`, Brazzers `/model/<id>/<slug>`, and pages filtered to one model): a panel under the name (floating in the bottom-right dock on Adult Time and Brazzers). If a performer with exactly that name (or alias, or on Brazzers the model id in a saved URL) exists in Stash, the name turns green with a checkbox and the panel shows **View in Stash**; if the page URL is not saved on the performer, **Add this URL in Stash** appends it after a confirmation (a `performerUpdate` mutation, the only write the script makes). Otherwise it lists the closest fuzzy matches. A **Retry** button appears when Stash is unreachable. The floating panel is at most 340px wide, scrolls on its own, folds saved URLs into a "Saved URLs (n)" list, and has a toggle that folds it to its summary lines (remembered).
- **Videos on a model page**: titles already in Stash (matched by the site's scene id in a stored URL, or by normalised title among the performer's scenes) get a green `✓ IN STASH` badge at the top left and a green title with a check, and the panel counts them.
- **Model listing** (Reptyle and Brazzers `/models`, Adult Time `/en/pornstars`): every model that exists in Stash gets an `IN STASH` badge, and a `+ URL` button (with confirmation) when its page URL is not saved yet.
- **Every other page** of a supported site: video cards and model links already in Stash are marked too (by id only).
- Follows in-app navigation (a 2-second re-check, plus a mutation observer and `pushState`/`popstate` for the video badge and dots), so infinite scrolling and late-rendering cards are covered.

## Adding a site

Add an object to `SITES` and an `@match https://<host>/*` per host (a test checks that both agree). The fields are commented at the top of the script: page path patterns for model detail and listing pages, CSS selectors for the name, video cards and model cards, URL fragments that select that site's scenes in Stash (`sceneUrlParts`, a host or a path such as `/en/video/`), an `anchorSel` for the panel (empty for a floating panel), an optional `nameFromUrl`, and `sceneKey`/`modelKey`, which reduce a URL to the id or slug that the site's links and the URLs in Stash have in common. Members areas often use other hosts than the public URLs the Stash scrapers save, which is why the key, not the full URL, is compared. The URL patterns in the Stash community scrapers (`stash/config`, `scrapers/community/`) show which hosts and paths each network uses. Set `scenePage`/`sceneTitleSel` and `cardDots` only once the site's video page and card titles are known.

## Permissions

- `@connect localhost`: GraphQL calls to `http://localhost:9999/graphql` and log batches to the collector on `http://localhost:7790/v1/logs`. Tampermonkey asks once; choose **Always allow**. If your Stash runs elsewhere, change `STASH_ORIGIN` and add a matching `@connect`.
- `@grant GM_xmlhttpRequest` for Stash and the log collector (so the sites' CSP/CORS and mixed-content rules do not apply), `GM_addStyle` for the badge and dot styles, `GM_getValue`/`GM_setValue` to remember model pages (name and URL per site id), the panel fold state, and the shared Stash lists (`cache:v1:performers`, `cache:v1:scenes:<url part>`: ids, names, aliases, titles and URLs from your Stash, kept only in Tampermonkey's local extension storage). To clear the lists, delete those keys in the script's **Storage** tab in Tampermonkey (shown in the advanced config mode); they are refetched on the next page. Storage is per script, so lists and remembered model pages from Reptyle Stash Model Link are not carried over; they are fetched again on the first page.

## Checks

```bash
npm run check      # lint (Tampermonkey 5.5.1 rule set) + unit tests + browser test + version bump check
```

`npm run lint` needs desktop Chrome with Tampermonkey 5.5.1 installed (set `TAMPERMONKEY_EXTENSION_DIR` to override); `npm run check:ci` uses the pinned stand-in after `npm ci --prefix tools/lint-ci`. Unit tests cover metadata/grant consistency, the update URL, adapter completeness and host selection, the `@match`/adapter agreement, the pure helpers, the shared Stash lists, `lookupVideo` against a stubbed `GM_xmlhttpRequest` (URL+title match, fuzzy fallback, unreachable Stash, HTTP errors) and the shared log sink. `npm run test:browser` (part of `npm run check`, not of CI) runs every adapter in headless Chrome on stub pages with stubbed Tampermonkey APIs and Stash: panel, matches by id and title, confirm before writes, filtered model pages, late-rendering cards, the 2-second re-check, the shared Stash lists, the docked panel, the Reptyle video badge (match, in-app navigation, unreachable Stash) and card dots (from the stored list and by lookup, not overlapping the card badge). It needs desktop Chrome (`CHROME_PATH` overrides the path). Stub pages are not the live sites: real selectors are only confirmed where a page capture or report was available.
