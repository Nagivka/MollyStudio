import test from 'node:test';
import assert from 'node:assert/strict';
import { prefixInspectorMarkup } from '../../src/renderer/js/ui/PrefixInspector.js';

const markup = prefixInspectorMarkup();
const group = id => {
    const start=markup.indexOf(`<section class="prefix-section" id="prefix-section-${id}"`);
    const next=markup.indexOf('<section class="prefix-section"',start+1);
    return start<0?'':markup.slice(start,next<0?undefined:next);
};

test('prefix inspector keeps text settings and background settings in two complete groups', () => {
    assert.doesNotMatch(markup, /data-prefix-target|<details|<summary/);
    for (const key of ['text', 'font', 'letterSpacing', 'textAngle', 'textShadow', 'textShadowColor', 'textShadowAngle', 'textShadowDarkness', 'textShadowX', 'textShadowY', 'textShadowOpacity']) assert.ok(group('text').includes(`data-prefix-field="${key}"`), key);
    assert.ok(group('text').includes('data-prefix-colors="textColors"'));
    for (const key of ['paddingX', 'paddingY', 'radiusTopLeft', 'radiusTopRight', 'radiusBottomLeft', 'radiusBottomRight', 'borderWidth', 'borderColor', 'bevel', 'tintedBorder', 'highlightColor', 'bevelShadowColor', 'shadow', 'shadowColor', 'shadowX', 'shadowY', 'shadowOpacity']) assert.ok(group('background').includes(`data-prefix-field="${key}"`), key);
    assert.doesNotMatch(markup, /data-prefix-field="radius"/);
    assert.ok(group('background').includes('data-prefix-colors="backgroundColors"'));
    assert.doesNotMatch(markup, /data-prefix-field="document\./);
    assert.equal((markup.match(/<section class="prefix-section" /g) || []).length, 2);
});

test('each color editor owns its palette and all label IDs are unique', () => {
    for (const key of ['textColors', 'backgroundColors', 'textShadowColors']) {
        assert.equal((markup.match(new RegExp(`data-prefix-palette="${key}"`, 'g')) || []).length, 1);
        assert.ok(markup.includes(`data-prefix-palette-select="${key}"`));
        assert.ok(markup.includes(`data-prefix-palette-swatches="${key}"`));
    }
    const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(ids.length, new Set(ids).size);
    assert.equal((markup.match(/data-prefix-field="textShadowColor"/g) || []).length, 2);
    assert.equal((markup.match(/data-prefix-field="paddingX"/g) || []).length, 1);
});

test('removed preset, result and block management sections are absent', () => {
    assert.doesNotMatch(markup, /prefix-section-(?:presets|composition|result)|prefix-block-list|class="prefix-heading"|prefix-style|data-prefix-preset|prefix-dimensions/);
    for (const action of ['fit','export','copy','raster-copy','add','duplicate','left','right','delete','batch-export']) assert.ok(!markup.includes(`data-prefix-action="${action}"`));
    assert.ok(markup.includes('data-prefix-existing-block'));
});

test('text shadow exposes three color modes next to its offsets and opacity', () => {
    for (const mode of ['auto', 'solid', 'gradient']) assert.ok(group('text').includes(`data-prefix-mode="textShadowMode:${mode}"`));
    assert.ok(group('text').includes('data-prefix-text-shadow-auto'));
    assert.ok(group('text').includes('data-prefix-text-shadow-solid'));
    assert.ok(group('text').includes('data-prefix-text-shadow-gradient'));
});
