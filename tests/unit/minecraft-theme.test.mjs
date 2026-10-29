import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { minecraftIcon, minecraftIconNames } from '../../src/renderer/js/ui/MinecraftIcons.mjs';
import { minecraftRangeState, minecraftIconSize, minecraftRangeTicks } from '../../src/renderer/js/ui/MinecraftControls.mjs';

test('Minecraft range fill respects native defaults, bounds and fractional ranges', () => {
    assert.deepEqual(minecraftRangeState(), { fill: '0%', stepSize: null });
    assert.equal(minecraftRangeState({value: 50}).fill, '50%');
    assert.equal(minecraftRangeState({min: -10, max: 10, value: 0}).fill, '50%');
    assert.equal(minecraftRangeState({value: -5}).fill, '0%');
    assert.equal(minecraftRangeState({value: 105}).fill, '100%');
    for (const state of [{min: 5, max: 5}, {min: 10, max: 5}, {value: NaN}, {max: 'bad'}]) {
        assert.equal(minecraftRangeState(state).fill, '0%');
    }
    assert.equal(minecraftRangeState({min: 0, max: 1, step: .1, value: .5}).fill, '50%');
});

test('only a small, uniform, discrete range has tick marks', () => {
    assert.equal(minecraftRangeState({min: 0, max: 5, value: 3}).stepSize, '20%');
    assert.equal(minecraftRangeState({max: 16}).stepSize, '6.25%');
    for (const state of [{step: 'any'}, {step: 0}, {step: -1}, {max: 17}, {max: 1}, {max: 5, step: 2}]) {
        assert.equal(minecraftRangeState(state).stepSize, null);
    }
});

test('Minecraft tick marks include only exact interior steps and keep their positions when the value changes',()=>{
    const track={min:0,max:5,step:1,value:0},ticks=minecraftRangeTicks(track);
    assert.equal(minecraftRangeTicks({...track,value:5}),ticks);
    for(const point of [20,40,60,80])assert.ok(ticks.includes(`calc(${point}% - 1px)`));
    assert.equal((ticks.match(/var\(--mc-edge\)/g)||[]).length,8);
    assert.equal(minecraftRangeTicks({min:0,max:100,step:1}),null);
    assert.equal(minecraftRangeTicks({min:0,max:1,step:'any'}),null);
});

test('curated pixel icons use integer multiples of their 24px grid, safe local SVGs and cached aliases', () => {
    for (const size of [8, 12, 13]) assert.equal(minecraftIconSize(size), 12);
    for (const size of [0, 14, 16, 20, 24, 28, 32, 'bad']) assert.equal(minecraftIconSize(size), 24);
    for (const size of [40, 44, 48, 64]) assert.equal(minecraftIconSize(size), 48);
    assert.equal(minecraftIcon('unknown_icon'), null);
    assert.equal(minecraftIcon(null), null);
    assert.strictEqual(minecraftIcon(' settings '), minecraftIcon('gear'));
    assert.notStrictEqual(minecraftIcon('circle'), minecraftIcon('radio_button_unchecked'));
    assert.notStrictEqual(minecraftIcon('square'), minecraftIcon('crop_square'));
    assert.ok(minecraftIconNames.length > 150);
    for (const name of minecraftIconNames) {
        const icon = minecraftIcon(name);
        assert.ok(icon, name);
        assert.ok(Object.isFrozen(icon), name);
        assert.equal(icon.grid, 24);
        assert.match(icon.svg, /viewBox="0 0 24 24" shape-rendering="crispEdges"/);
        assert.match(icon.svg, /<(?:path|rect) /);
        assert.doesNotMatch(icon.svg, /script|foreignObject|href=|onload=|<image|<text|<circle/);
        assert.equal(icon.mask, `url("data:image/svg+xml,${encodeURIComponent(icon.svg)}")`);
    }
});

test('all statically declared interface icons have a pixel drawing', async () => {
    const names = new Set();
    async function visit(directory) {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
            if (entry.isDirectory()) await visit(url);
            else if (/\.(?:js|mjs|html)$/.test(entry.name)) {
                const source = await readFile(url, 'utf8');
                const patterns = [
                    /class=["'][^"']*material-symbols-rounded[^"']*["'][^>]*>\s*([a-z][a-z_0-9]*)\s*</g,
                    /["']?\bicon["']?\s*:\s*["']([a-z][a-z_0-9]*)["']/g,
                    /\bicon\s*=\s*["']([a-z][a-z_0-9]*)["']/g,
                    /new DrawCommand\([^;\n]*,\s*["']([a-z][a-z_0-9]*)["']\s*\)/g,
                    /(?:mkIcon|createIcon)\(\s*["']([a-z][a-z_0-9]*)["']/g
                ];
                for (const regex of patterns) for (const match of source.matchAll(regex)) names.add(match[1]);
            }
        }
    }
    await visit(new URL('../../src/renderer/', import.meta.url));
    assert.ok(names.size > 100);
    assert.deepEqual([...names].filter(name => !minecraftIcon(name)).sort(), []);
});

test('different editing operations have distinct, reproducible pixel symbols', async () => {
    for(const [a,b] of [['transform','open_with'],['fullscreen','fullscreen_exit'],['shadow','layers'],['deselect','close'],['unfold_more','expand_more'],['rotate_left','undo'],['folder_off','folder']]){
        assert.notStrictEqual(minecraftIcon(a),minecraftIcon(b),`${a} must not reuse ${b}`);
    }
    const manifest=JSON.parse(await readFile(new URL('../../scripts/data/minecraft-icon-map.json',import.meta.url),'utf8'));
    for(const [glyph,drawing]of Object.entries(manifest.custom)){
        assert.ok(!Object.hasOwn(manifest.sources,glyph),`${glyph}: vendoring would overwrite the custom drawing`);
        const alias=Object.keys(manifest.aliases).find(key=>manifest.aliases[key]===glyph);
        if(alias)assert.ok(minecraftIcon(alias).svg.includes(drawing),`${glyph}: manifest and bundle differ`);
    }
});

test('Minecraft UI loads the exact supplied replacement fonts', async () => {
    const css = await readFile(new URL('../../src/renderer/css/style.css', import.meta.url), 'utf8');
    const suppliedHashes = {
        'Minecraft1.ttf': '48232222f7546a99131ccbdefda47d5f1cbb918b80bae37f1e2cfd263da65edb',
        'minecraft-ten1.ttf': 'd6295143973235adfbf16a2d2d6e428f318c25a2fca1f10d223a480492c87372'
    };
    for (const [name, hash] of Object.entries(suppliedHashes)) {
        const bundled = await readFile(new URL(`../../src/renderer/assets/fonts/${name}`, import.meta.url));
        assert.equal(createHash('sha256').update(bundled).digest('hex'), hash);
        assert.equal(bundled.readUInt32BE(), 0x00010000, `${name} is a TrueType font`);
        assert.ok(css.includes(`../assets/fonts/${name}`));
    }
    assert.doesNotMatch(css, /minecraft-ten-font-cyrillic\.ttf|fonts\/minecraft\.ttf/);
});
