import test from 'node:test';
import assert from 'node:assert/strict';
import ColorPicker from '../../src/renderer/js/ui/ColorPicker.js';
import EventBus from '../../src/renderer/js/core/EventBus.js';

function picker(target) {
    const value = Object.create(ColorPicker.prototype);
    Object.assign(value, { activeTarget: target, fgColor: '#112233', bgColor: '#445566', hue: 180, sat: 100, val: 100,
        bus: new EventBus(), updateSwatches() {}, drawSB() {}, updateCursorPosition() {}, renderShadingRamp() {} });
    return value;
}

test('background HEX and HSV choices never emit foreground recoloring events', () => {
    const value = picker('bg');
    let recolors = 0;
    value.bus.on('COLOR_CHANGED', () => recolors++);
    value.setColorFromHex('#aabbcc');
    assert.equal(value.bgColor, '#AABBCC');
    assert.equal(value.fgColor, '#112233');
    Object.assign(value, { hue: 180, sat: 100, val: 100 });
    value.updateColor();
    assert.equal(value.bgColor, '#00FFFF');
    assert.equal(value.fgColor, '#112233');
    assert.equal(recolors, 0);
});

test('foreground choices still update drawing and recolor listeners and can be synchronized silently', () => {
    const value = picker('fg'), events = [];
    value.bus.on('COLOR_CHANGED', color => events.push(color));
    value.setColorFromHex('#aabbcc');
    Object.assign(value, { hue: 180, sat: 100, val: 100 });
    value.updateColor();
    value.setColorFromHex('#000000', false);
    assert.deepEqual(events, ['#AABBCC', '#00FFFF']);
    assert.equal(value.bgColor, '#445566');
    assert.equal(value.fgColor, '#000000');
});

test('HEX colors survive entering and leaving the HSV controls without rounding drift', () => {
    const value = picker('fg');
    for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 17) {
        const color = '#' + [r, g, b].map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase();
        const hsv = value.hexToHSV(color);
        assert.equal(value.hsvToHex(hsv.h, hsv.s, hsv.v), color);
    }
    value.setColorFromHex('#AABBCC');
    value.updateColor();
    assert.equal(value.fgColor, '#AABBCC');
});

test('adding the current color to a custom palette follows the selected foreground or background', () => {
    for (const target of ['fg', 'bg']) {
        const value = picker(target), appended = [];
        value.appendPaletteColors = colors => { appended.push(...colors); return colors.length; };
        value.saveCustomPalette = () => {};
        value.renderPalette = () => {};
        value.addCurrentColorToCustomPalette();
        assert.deepEqual(appended, [target === 'bg' ? '#445566' : '#112233']);
        assert.equal(value.activePalette, 'custom');
    }
});

test('HEX editing applies complete colors live, commits shorthand, and restores invalid input without duplicate recoloring', () => {
    for (const target of ['fg', 'bg']) {
        const value = picker(target), events = [], history = [];
        const input = new EventTarget();
        Object.assign(input, { value: '', selectionStart: 3, selectionEnd: 3,
            setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } });
        value.inputHex = input;
        value.addToHistory = color => history.push(color);
        value.bus.on('COLOR_CHANGED', color => events.push(color));
        value.bindHexInput();
        input.value = '#aabbcc';
        input.dispatchEvent(new Event('input'));
        assert.equal(target === 'bg' ? value.bgColor : value.fgColor, '#AABBCC');
        assert.equal(input.selectionStart, 3);
        input.dispatchEvent(new Event('change'));
        input.dispatchEvent(new Event('blur'));
        assert.deepEqual(events, target === 'fg' ? ['#AABBCC'] : []);
        input.value = 'f80';
        input.dispatchEvent(new Event('input'));
        assert.equal(target === 'bg' ? value.bgColor : value.fgColor, '#AABBCC');
        const enter = new Event('keydown', { cancelable: true });
        Object.defineProperty(enter, 'key', { value: 'Enter' });
        input.dispatchEvent(enter);
        assert.equal(enter.defaultPrevented, true);
        assert.equal(input.value, '#FF8800');
        input.value = '#oops';
        input.dispatchEvent(new Event('blur'));
        assert.equal(input.value, '#FF8800');
        assert.equal(history.at(-1), '#FF8800');
        assert.deepEqual(events, target === 'fg' ? ['#AABBCC', '#FF8800'] : []);
    }
});
