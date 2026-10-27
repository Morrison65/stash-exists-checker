'use strict';
// Installs update themselves from the raw userscript on master (@updateURL), and Tampermonkey only
// takes a higher @version. Fail if the userscript differs from the base ref without a version bump.
// Base: first argument, else BASE_REF, else origin/master. A missing base (first push, shallow clone) passes.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const file = require(path.join(root, 'package.json')).name + '.user.js';
const base = process.argv[2] || process.env.BASE_REF || 'origin/master';
const version = source => /@version\s+(\S+)/.exec(source)?.[1] || '';
const newer = (a, b) => {
    const x = a.split('.').map(Number), y = b.split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
};
const current = fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
let previous;
try {
    previous = execFileSync('git', ['show', `${base}:${file}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n');
} catch {
    console.log(`Version check skipped: ${file} not found at ${base}.`);
    process.exit(0);
}
if (current === previous) console.log(`Version check: ${file} unchanged against ${base} (${version(current)}).`);
else if (newer(version(current), version(previous))) console.log(`Version check: ${version(previous)} -> ${version(current)} against ${base}.`);
else {
    console.error(`Version check failed: ${file} differs from ${base} but @version ${version(current)} is not higher than ${version(previous)}. Installed copies would not update; raise @version, VERSION and package.json.`);
    process.exitCode = 1;
}
