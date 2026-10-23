# Release workflow

The user requires every finished userscript version to be committed, and every completed commit to be pushed automatically.

- Keep the metadata `@version`, runtime `VERSION` and package version consistent (`npm run lint` asserts the first two match).
- Update behavior documentation and run `npm run check` before committing.
- Inspect the scoped staged diff; preserve unrelated work. Do not commit captured pages, HAR files, signed URLs, browser profiles, logs or media.
- Include the version in the commit subject.
- Inspect the current branch and upstream, then perform a normal push after each completed commit. Never force-push. No further confirmation is needed.
- If authentication, upstream configuration or a non-fast-forward rejection blocks the push, preserve the local commit and report the actual blocker.
- Report version, commit, push outcome and validation limits. The unit tests cover the pure helpers only; nothing here verifies an authenticated Tampermonkey install or the live Reptyle/Stash pages.

# Tampermonkey rules

- The installable file is `stash-exists-checker.user.js`. There is no build step: the edited file is the installed file.
- Cross-origin requests go through `GM_xmlhttpRequest` with a matching `@connect`; never reintroduce `siderRuntime` (the original Sider code-agent runtime this code was ported from).
- Reptyle is a single-page app: keep `@match` on the whole site and make every page-specific action idempotent.
- Build UI with DOM APIs, not HTML strings.
- Keep the pure helpers behind the `module.exports` guard near the top so `test/core.test.cjs` can import them without a DOM.
- Never commit Reptyle session tokens, `?r=` referral parameters, cookies or signed CDN URLs.
