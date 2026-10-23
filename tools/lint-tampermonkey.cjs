'use strict';
// Uses installed extension code only; never reads browser settings, cookies or scripts.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const extension = process.env.TAMPERMONKEY_EXTENSION_DIR || path.join(process.env.LOCALAPPDATA || '',
    'Google/Chrome/User Data/Default/Extensions/dhdgffkkebhmkfjojejmpbldmpobfkfo/5.5.1_0');
try {
    const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
    assert.equal(manifest.version, '5.5.1', 'Re-audit the default config before using another Tampermonkey version');
    const engine = require(path.join(extension, 'vendor/eslint/eslint.js'));
    assert.equal(engine.Linter.version, '8.32.0');
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'tampermonkey-5.5.1.eslint.json'), 'utf8'));
    let reply;
    const worker = { eslint: engine, postMessage(value) { reply = value; } };
    vm.runInNewContext(fs.readFileSync(path.join(extension, 'lint.js'), 'utf8'), { self: worker }, { timeout: 5000 });
    function lint(text) {
        reply = undefined;
        worker.onmessage({ data: { method: 'lint', id: 1, config, text } });
        if (!reply || reply.error) throw new Error(String(reply?.error || 'No lint response'));
        return reply.results;
    }
    // Fail closed if either the engine or the userscript metadata checks are missing.
    const probe = lint('// ==UserScript==\n// @name Probe\n// @grant InvalidGrant\n// ==/UserScript==\nunknownProbe();');
    assert(probe.some(item => item.ruleId === 'userscripts/no-invalid-grant'));
    assert(probe.some(item => item.ruleId === 'no-undef'));
    const source = fs.readFileSync(path.join(root, require(path.join(root, 'package.json')).name + '.user.js'), 'utf8');
    assert.equal(/@version\s+(\S+)/.exec(source)?.[1], /const VERSION = '([^']+)'/.exec(source)?.[1], 'Version mismatch');
    const results = lint(source);
    for (const item of results) console.log(`${item.line}:${item.column} ${item.severity === 2 ? 'error' : 'warning'} ${item.ruleId}: ${item.message}`);
    console.log(`Tampermonkey ${manifest.version}, ESLint ${engine.Linter.version}: ${results.length} findings (default modern-Chrome config).`);
    process.exitCode = results.length ? 1 : 0;
} catch (error) {
    console.error(`Tampermonkey lint failed: ${error.message}\nSet TAMPERMONKEY_EXTENSION_DIR to the installed 5.5.1 extension directory if needed.`);
    process.exitCode = 1;
}

