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
- The script matches every site (`@match *://*/*`) so the setup guide is in the Tampermonkey menu everywhere. On a site that is neither built in nor set up it must stay inert: no Stash request, no log entry, no observer, nothing drawn until the user opens the guide (the browser test asserts this). Supported sites can be single-page apps: make every page-specific action idempotent.
- **Every site set up by hand must be built in (user rule).** A profile from the setup guide lives only in that browser's Tampermonkey storage; a new install must support every such site out of the box. At the start of every task or workflow in this repository, run `npm run sites` (reads the local userscript logs, `tools/onboarded-sites.cjs`) and build in every host it lists as "not built in", together with the task at hand, from its `site onboarding` / `site profile exported` / `started` entries (`userscript-logs` skill), plus the live page and the URL shapes Stash holds for the site where they help. `npm run check` runs it first and fails while one is missing; without local logs (CI, another machine) it passes with a note. Logs are kept 30 days, so a site not visited in that time drops out of the check: build new sites in promptly. Give the new adapter `profileSince` (the release that builds it in), so the hand-made profile stops overriding it.
- Put page-specific selectors and URL rules in the site's `SITES` adapter or its profile, never in the core. The setup guide logs everything needed for a built-in adapter (event `site onboarding`/`site profile exported`); read it with the `userscript-logs` skill before writing one.
- Build UI with DOM APIs, not HTML strings.
- Keep the pure helpers behind the `module.exports` guard near the top so `test/core.test.cjs` can import them without a DOM.
- Never commit session tokens, `?r=` referral parameters, cookies, signed CDN URLs or account names of any site.
