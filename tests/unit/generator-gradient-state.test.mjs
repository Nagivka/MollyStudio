import test from 'node:test';
import assert from 'node:assert/strict';
import ButtonGeneratorModal from '../../src/renderer/js/ui/ButtonGeneratorModal.js';

function generator() {
    return Object.assign(Object.create(ButtonGeneratorModal.prototype), {
        gradientColors: ['#112233', '#445566', '#778899', '#AABBCC'], activeGradientStopIndex: 2,
        renderGradientStopsUI() {}, updateView() {}
    });
}

test('removing an earlier gradient stop retains the selected color', () => {
    const model=generator(), selected=model.gradientColors[model.activeGradientStopIndex];
    model.removeGradientStop(0);
    assert.equal(model.gradientColors[model.activeGradientStopIndex], selected);
    assert.equal(model.activeGradientStopIndex, 1);
});

test('invalid gradient indexes and colors cannot remove or corrupt another stop', () => {
    const model=generator(), before=[...model.gradientColors];
    for(const index of [-1, 99, NaN, 1.5])model.removeGradientStop(index);
    for(const [index,color] of [[0,'invalid'],[1.5,'#123456'],[NaN,'#123456']])model.setGradientStopColor(index,color);
    assert.deepEqual(model.gradientColors,before);
});

test('gradient edits keep two to eight colors and choose the adjacent stop when deleting the active one', () => {
    const model=generator();model.activeGradientStopIndex=3;model.removeGradientStop(3);
    assert.equal(model.activeGradientStopIndex,2);
    model.removeGradientStop(2);model.removeGradientStop(1);assert.equal(model.gradientColors.length,2);
    for(let i=0;i<12;i++)model.addGradientStop();assert.equal(model.gradientColors.length,8);
    assert.equal(model.activeGradientStopIndex,7);model.setGradientStopColor(7,'#abcdef');assert.equal(model.gradientColors[7],'#ABCDEF');
});
