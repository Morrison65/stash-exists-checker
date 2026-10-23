const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '..', 'stash-exists-checker.user.js');
const source = fs.readFileSync(file, 'utf8');
const pkg = require('../package.json');
const header = /==UserScript==([\s\S]*?)==\/UserScript==/.exec(source)[1];
const meta = {};
for (const [, key, value] of header.matchAll(/^\/\/ @(\S+)\s*(.*)$/gm)) (meta[key] ||= []).push(value.trim());

test('metadata is complete and versions agree', () => {
    for (const key of ['name', 'namespace', 'version', 'description', 'match', 'grant', 'connect']) assert.ok(meta[key], key + ' is missing');
    assert.equal(meta.version[0], pkg.version);
    assert.equal(require(file).VERSION, pkg.version);
    assert.equal(pkg.name + '.user.js', path.basename(file));
});
test('Sider runtime leftovers are gone', () => {
    assert.equal(meta['bound-url'], undefined);
    assert.equal(meta.changelog, undefined);
    assert.doesNotMatch(source, /siderRuntime|\?r=[0-9a-f]{8}/);
});
test('every GM API used is granted and every grant is used', () => {
    const code = source.replace(/^\/\/.*$/gm, '');
    for (const api of new Set(code.match(/\bGM_[A-Za-z]+/g) || [])) assert.ok(meta.grant.includes(api), api + ' is used but not granted');
    for (const api of meta.grant) assert.match(code, new RegExp('\\b' + api + '\\b'), api + ' is granted but unused');
});

const { norm, canonUrl, lookupVideo } = require('../stash-exists-checker.user.js');

test('match is limited to Reptyle and Stash is the only connect', () => {
    assert.deepEqual(meta.match, ['https://app.reptyle.com/*']);
    assert.deepEqual(meta.connect, ['localhost']);
});
test('norm collapses whitespace runs and case', () => {
    assert.equal(norm('  Foo   BAR\tbaz\n'), 'foo bar baz');
    assert.equal(norm(null), '');
});
test('canonUrl strips query, hash and whitespace', () => {
    assert.equal(canonUrl(' https://app.reptyle.com/movies/1?r=abc#x '), 'https://app.reptyle.com/movies/1');
    assert.equal(canonUrl(''), '');
    assert.equal(canonUrl(undefined), '');
});

// Stands in for Tampermonkey's GM_xmlhttpRequest; the handler gets the parsed GraphQL request body.
function stash(handler) {
    global.GM_xmlhttpRequest = (opts) => {
        const body = JSON.parse(opts.data);
        Promise.resolve(handler(body)).then((result) => {
            if (result instanceof Error) opts.onerror();
            else opts.onload({ status: result.status || 200, responseText: JSON.stringify(result.json) });
        });
    };
}
const scenes = (list) => ({ json: { data: { findScenes: { count: list.length, scenes: list } } } });

test('lookup matches by canonical URL and title and reports both', async () => {
    const scene = { id: '7', title: 'Some  Title', urls: ['https://app.reptyle.com/movies/10?x=1'] };
    stash(() => scenes([scene]));
    const res = await lookupVideo({ title: 'some title', url: 'https://app.reptyle.com/movies/10?r=zz' });
    assert.equal(res.best.id, '7');
    assert.equal(res.via, 'url+title');
});
test('lookup falls back to a fuzzy count when nothing matches', async () => {
    stash((body) => (body.variables.q ? scenes([{ id: '1', title: 'x', urls: [] }, { id: '2', title: 'y', urls: [] }]) : scenes([])));
    const res = await lookupVideo({ title: 'Unknown', url: 'https://app.reptyle.com/movies/11' });
    assert.equal(res.best, null);
    assert.equal(res.similar, 2);
});
test('unreachable Stash is an error, never a false "Not in Stash", and is retried', async () => {
    stash(() => new Error('down'));
    const failed = await lookupVideo({ title: 'Offline', url: 'https://app.reptyle.com/movies/12' });
    assert.ok(failed.error);
    stash(() => scenes([{ id: '9', title: 'Offline', urls: [] }]));
    const retried = await lookupVideo({ title: 'Offline', url: 'https://app.reptyle.com/movies/12' });
    assert.equal(retried.best.id, '9');
});
test('HTTP errors from Stash count as failures', async () => {
    stash(() => ({ status: 500, json: {} }));
    const res = await lookupVideo({ title: 'Broken', url: 'https://app.reptyle.com/movies/13' });
    assert.match(res.error, /Stash HTTP 500/);
});
