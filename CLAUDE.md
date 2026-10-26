# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Stash Exists Checker - Reptyle

Tampermonkey userscript for desktop Chrome that shows, on [app.reptyle.com](https://app.reptyle.com), whether a video is already in your local [Stash](https://stashapp.cc) (`http://localhost:9999`). Independent of the other userscripts in the docker-stuff workspace; it is set up like `colum-manager` (one dependency-free userscript, no build step).

@AGENTS.md

## Project map

- `stash-exists-checker.user.js` is the installable userscript. `lookupVideo` (Stash queries and matching), `norm`/`canonUrl` and the shared log sink (`logPage`, `createLogSink`; `docker-workspace/docs/userscripts.md`) are exported through the `module.exports` guard for tests.
- Listing cards are queued and checked in batches of four with a 150 ms pause (`pumpCards`); results are cached per title + URL.
- `test/core.test.cjs` is the only test file (Node's built-in runner). `tools/` holds the two lint entry points copied from `colum-manager`; both read `<package name>.user.js`.

## Validation

- `npm run check` = `lint` + `test`. `lint` runs the Tampermonkey 5.5.1 ESLint worker from the Windows Chrome profile and fails if that extension version is not installed; it also asserts `@version` equals the runtime `VERSION`.
- `npm run check:ci` = `lint:ci` + `test` (needs `npm ci --prefix tools/lint-ci` once). `.github/workflows/ci.yml` runs it.
- Single test file: `node --test test/core.test.cjs`.
- Releasing: bump `@version`, `VERSION` and `package.json` together (currently 2.1.0), then follow AGENTS.md.

## Architecture

- One IIFE; Reptyle is a single-page app, so the script matches the whole site and acts on the current path. Keep page changes idempotent and never rely on a load event per page.
- Network access is only through `GM_xmlhttpRequest` and the matching `@connect` entries; `siderRuntime` (the runtime the code was originally written for) must not come back.
- Never store session tokens, `?r=` parameters, cookies, HAR data or signed URLs in this repository.
- Running it for real needs Tampermonkey in desktop Chrome, a logged-in Reptyle session and, except for the downloader, a running local Stash; none of that is available to the tests.
