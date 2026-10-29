const test = require('node:test'), assert = require('node:assert/strict');
const {visualEnvironment, sameVisualEnvironment} = require('../../scripts/lib/visual-environment.cjs');
test('visual baselines cannot silently cross a Chromium version, platform or font replacement', () => {
    const first=visualEnvironment('win32','Chromium/1',{'a.ttf':Buffer.from('font a'),'b.woff2':Buffer.from('font b')});
    const reordered=visualEnvironment('win32','Chromium/1',{'b.woff2':Buffer.from('font b'),'a.ttf':Buffer.from('font a')});
    assert.equal(sameVisualEnvironment(first,reordered),true);
    for(const other of [null,{}, {...first,userAgent:'Chromium/2'}, {...first,platform:'other'}, visualEnvironment('win32','Chromium/1',{'a.ttf':Buffer.from('changed font'),'b.woff2':Buffer.from('font b')})])
        assert.equal(sameVisualEnvironment(first,other),false);
});
