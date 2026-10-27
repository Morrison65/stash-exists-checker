# Release workflow

The user requires every finished userscript version to be committed, and every completed commit to be pushed automatically.

- Keep the metadata `@version`, runtime `VERSION` and package version consistent (`npm run lint` asserts the first two match).
- Installs update themselves from the raw file on `master` (`@updateURL`/`@downloadURL`): bump `@version` with every script change that is pushed, and push only after `npm run check` passes. `npm run check` (and CI) fail when the userscript differs from `origin/master` without a higher `@version` (`tools/check-version-bump.cjs`).
- Update behavior documentation and run `npm run check` before committing.
- Inspect the scoped staged diff; preserve unrelated work. Do not commit captured pages, HAR files, signed URLs, browser profiles, logs or media.
- Include the version in the commit subject.
- Inspect the current branch and upstream, then perform a normal push after each completed commit. Never force-push. No further confirmation is needed.
- If authentication, upstream configuration or a non-fast-forward rejection blocks the push, preserve the local commit and report the actual blocker.
- Report version, commit, push outcome and validation limits. The unit tests cover the pure helpers and `lookupVideo` against a stubbed Stash; `npm run test:browser` covers each adapter on stub pages. Nothing here verifies an authenticated Tampermonkey install or the live sites/Stash.

# Tampermonkey rules

- The installable file is `stash-exists-checker.user.js`. There is no build step: the edited file is the installed file.
- Cross-origin requests go through `GM_xmlhttpRequest` with a matching `@connect`; never reintroduce `siderRuntime` (the original Sider code-agent runtime this code was ported from).
- Supported sites (Reptyle first) can be single-page apps: keep `@match` on whole sites, one per adapter host in `SITES`, and make every page-specific action idempotent.
- Put page-specific selectors and URL rules in the site's `SITES` adapter, never in the core.
- Build UI with DOM APIs, not HTML strings.
- Keep the pure helpers behind the `module.exports` guard near the top so `test/core.test.cjs` can import them without a DOM.
- Never commit session tokens, `?r=` referral parameters, cookies, signed CDN URLs or account names of any site.
