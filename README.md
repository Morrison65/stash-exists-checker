# stash-exists-checker

Tampermonkey userscript for **desktop Chrome** that shows, on [app.reptyle.com](https://app.reptyle.com), whether a video is already in your local [Stash](https://stashapp.cc) (`http://localhost:9999`). Version **2.0.0**.

**v2.0.0** is the first release in its own repository. The code was supplied as a Sider code-agent preview (`siderRuntime`), not as a Tampermonkey script, and was ported: `siderRuntime.fetch`/`addStyle` were replaced by `GM_xmlhttpRequest`/`GM_addStyle` with explicit `@connect`/`@grant`; the Sider-only `@bound-url` and `@changelog` headers were dropped. Two latent bugs were fixed: the whitespace normaliser used `/\\s+/` (a literal backslash) so runs of spaces never collapsed, and an unreachable Stash was reported as "Not in Stash" (and cached) instead of "Stash unreachable".

Original v2 behavior: lookup by canonical URL plus exact title, badge shows which matched.

## Install

1. In Chrome/Edge, turn on **Allow User Scripts** for Tampermonkey (extension details → right-click the icon → Manage extension), otherwise no userscript runs.
2. Open Tampermonkey's dashboard → **Utilities → Import from file** and select [`stash-exists-checker.user.js`](stash-exists-checker.user.js). Alternatively create a new script and replace its contents with this file, including the metadata header.
3. Reload the Reptyle tab. When Tampermonkey asks about cross-origin requests, review the `@connect` entries below and choose **Always allow**.

Runs on `https://app.reptyle.com/*` (top frame only).

## What it does

- **Movie pages** (`/movies/<id>`): a badge after the title. Green `In Stash #<id> (url|title|url+title)` links to the scene; grey `Not in Stash` (with a fuzzy-hit count) otherwise; orange `Stash unreachable` when Stash does not answer.
- **Listings**: a small dot on every card, `#<id>` when the video is in Stash and `x` when it is not, checked four cards at a time.
- **Matching**: scenes are looked up by canonical URL (query string and `#fragment` removed, Stash `url INCLUDES`) and by exact title (`title EQUALS`, whitespace and case normalised). If neither matches, a free-text search only supplies the "similar" count.
- Follows in-app navigation (mutation observer plus `pushState`/`popstate`).

## Permissions

- `@connect localhost`: GraphQL calls to `http://localhost:9999/graphql`. Tampermonkey asks once; choose **Always allow**. If your Stash runs elsewhere, change `STASH` in the script and add a matching `@connect`.
- `@grant GM_xmlhttpRequest` (Stash requests, so Reptyle's CSP/CORS and mixed-content rules do not apply) and `GM_addStyle`.

## Checks

```bash
npm run check      # lint (Tampermonkey 5.5.1 rule set) + unit tests
```

`npm run lint` needs desktop Chrome with Tampermonkey 5.5.1 installed (set `TAMPERMONKEY_EXTENSION_DIR` to override); `npm run check:ci` uses the pinned stand-in after `npm ci --prefix tools/lint-ci`. Unit tests cover metadata/grant consistency, the helpers and `lookupVideo` against a stubbed `GM_xmlhttpRequest` (URL+title match, fuzzy fallback, unreachable Stash, HTTP errors).
