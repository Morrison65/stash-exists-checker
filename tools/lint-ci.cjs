'use strict';
// CI-friendly stand-in for tools/lint-tampermonkey.cjs: the same pinned rule set
// (tampermonkey-5.5.1.eslint.json) on ESLint 8.32.0 with the open-source userscripts
// plugin, so no Tampermonkey install or browser profile is needed.
// Install first: npm ci --prefix tools/lint-ci
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const deps = path.join(__dirname, 'lint-ci');
try {
    const { Linter } = require(path.join(deps, 'node_modules/eslint'));
    const plugin = require(path.join(deps, 'node_modules/eslint-plugin-userscripts'));
    assert.equal(Linter.version, '8.32.0');
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'tampermonkey-5.5.1.eslint.json'), 'utf8'));
    const linter = new Linter();
    const skipped = [];
    for (const name of Object.keys(config.rules)) {
        if (!name.startsWith('userscripts/')) continue;
        const rule = plugin.rules[name.slice('userscripts/'.length)];
        if (rule) linter.defineRule(name, rule);
        else { skipped.push(name); delete config.rules[name]; }
    }
    const source = fs.readFileSync(path.join(root, require(path.join(root, 'package.json')).name + '.user.js'), 'utf8');
    assert.equal(/@version\s+(\S+)/.exec(source)?.[1], /const VERSION = '([^']+)'/.exec(source)?.[1], 'Version mismatch');
    // Fail closed if the plugin rules or core rules are not actually running.
    const probe = linter.verify('// ==UserScript==\n// @name Probe\n// @grant InvalidGrant\n// ==/UserScript==\nunknownProbe();', config);
    assert(probe.some(item => item.ruleId === 'userscripts/no-invalid-grant'));
    assert(probe.some(item => item.ruleId === 'no-undef'));
    const results = linter.verify(source, config);
    for (const item of results) console.log(`${item.line}:${item.column} ${item.severity === 2 ? 'error' : 'warning'} ${item.ruleId}: ${item.message}`);
    console.log(`ESLint ${Linter.version} + eslint-plugin-userscripts: ${results.length} findings (Tampermonkey 5.5.1 rule set${skipped.length ? `; not in the plugin: ${skipped.join(', ')}` : ''}).`);
    process.exitCode = results.length ? 1 : 0;
} catch (error) {
    console.error(`Lint failed: ${error.message}\nRun npm ci --prefix tools/lint-ci first.`);
    process.exitCode = 1;
}
