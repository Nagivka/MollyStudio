import test from 'node:test';
import assert from 'node:assert/strict';
import {WeatherParticles} from '../../src/renderer/js/core/WeatherParticles.mjs';
import SettingsManager from '../../src/renderer/js/core/SettingsManager.js';
import {WeatherFrameBudget} from '../../src/renderer/js/core/WeatherFrameBudget.mjs';

test('weather stays bounded at 8K and resets falling particles above the window', () => {
    for (const effect of ['rain', 'snow', 'leaves']) {
        const field = new WeatherParticles(effect, 'dense', 7680, 4320, () => .5);
        assert.ok(field.particles.length > 0 && field.particles.length <= (effect === 'snow' ? 440 : 220));
        field.particles[0].y = field.height + 30;
        field.step(1 / 30);
        assert.ok(field.particles[0].y < 0);
        for (let i = 0; i < 5000; i++) field.step(1 / 30);
        for (const particle of field.particles) {
            assert.ok(Number.isFinite(particle.x) && Number.isFinite(particle.y));
            assert.ok(particle.x >= -48 && particle.x <= field.width + 48);
        }
    }
    assert.equal(new WeatherParticles('none', 'dense', 7680, 4320).particles.length, 0);
});

test('weather movement uses elapsed time and clamps resume gaps', () => {
    const create = () => new WeatherParticles('rain', 'normal', 1000, 2000, () => .5);
    const fast = create(), slow = create(), resumed = create();
    for (let i = 0; i < 60; i++) fast.step(1 / 60);
    for (let i = 0; i < 30; i++) slow.step(1 / 30);
    assert.ok(Math.abs(fast.particles[0].y - slow.particles[0].y) < 1e-7);
    const before = resumed.particles[0].y;
    resumed.step(600);
    assert.ok(resumed.particles[0].y - before <= resumed.particles[0].speed * .05 + 1e-7);
    const snapshot = JSON.stringify(resumed.particles);
    resumed.step(NaN);resumed.step(-1);
    assert.equal(JSON.stringify(resumed.particles), snapshot);
});

test('snow remains visibly denser at every window size and density setting', () => {
    for (const [width,height] of [[1280,720],[1920,1080],[3840,2160]]) {
        let previous = 0;
        for (const [density,multiplier] of [['light',.55],['normal',1],['dense',1.6]]) {
            const field = new WeatherParticles('snow',density,width,height,()=>.5);
            const oldCount = Math.min(220,Math.min(3,width*height/1e6)*48*multiplier);
            assert.ok(Math.abs(field.particles.length-oldCount*2)<=1);
            assert.ok(field.particles.length>previous);
            previous=field.particles.length;
            field.configure({weatherQuality:'economy',weatherDensity:density});
            assert.ok(Math.abs(field.particles.length-previous*.6)<=1);
        }
    }
});

test('weather settings persist with safe defaults and reject unknown effects', t => {
    const previous = globalThis.localStorage;
    const data = new Map();
    globalThis.localStorage = {getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value)};
    t.after(() => { if (previous === undefined) delete globalThis.localStorage;else globalThis.localStorage = previous; });
    class Settings extends SettingsManager { applyAll() {} apply() {} }
    const settings = new Settings();
    assert.equal(settings.get('weatherEffect'), 'none');
    assert.equal(settings.get('weatherSize'),200);
    settings.set('weatherEffect', 'leaves');settings.set('weatherDensity', 'dense');settings.set('weatherScope', 'all');settings.set('weatherLeaves','summer');
    const reopened = new Settings();
    assert.equal(reopened.get('weatherEffect'), 'leaves');
    assert.equal(reopened.get('weatherDensity'), 'dense');
    assert.equal(reopened.get('weatherScope'), 'all');
    assert.equal(reopened.get('weatherLeaves'), 'summer');
    reopened.set('weatherLeaves','unknown');assert.equal(reopened.get('weatherLeaves'),'all');
    assert.equal(reopened.importSettingsJSON('{"weatherEffect":"script","weatherDensity":{},"weatherScope":"unknown"}'), true);
    assert.equal(reopened.get('weatherEffect'), 'none');
    assert.equal(reopened.get('weatherDensity'), 'normal');
    assert.equal(reopened.get('weatherScope'), 'home');
    reopened.set('weatherSpeed', 500);reopened.set('weatherWind', -999);reopened.set('weatherOpacity', NaN);
    const normalized = new Settings();
    assert.equal(normalized.get('weatherSpeed'), 200);
    assert.equal(normalized.get('weatherWind'), -100);
    assert.equal(normalized.get('weatherOpacity'), 75);
    normalized.set('weatherQuality', 'invalid');
    assert.equal(normalized.get('weatherQuality'), 'auto');
    normalized.set('weatherSize',999);assert.equal(normalized.get('weatherSize'),400);
    normalized.set('weatherSize',-10);assert.equal(normalized.get('weatherSize'),25);
});

test('resize and live parameter edits preserve existing particle identities and positions', () => {
    const field = new WeatherParticles('leaves', 'normal', 1000, 1000, () => .5);
    const particles = field.particles;
    const first = particles[0], x = first.x, y = first.y;
    field.resize(2000, 1000);
    assert.equal(field.particles, particles);
    assert.ok(particles.includes(first));
    assert.equal(first.x, x * 2);assert.equal(first.y, y);
    field.configure({weatherSpeed: 150, weatherWind: 60, weatherDensity: 'dense'});
    assert.ok(particles.includes(first));
    assert.equal(first.x, x * 2);assert.equal(first.y, y);
    const before = JSON.stringify(particles);
    field.resize(2000, 1000);
    assert.equal(JSON.stringify(particles), before);
});

test('wind direction, motion speed and economy population have meaningful effects', () => {
    const left = new WeatherParticles('rain', 'dense', 7680, 4320, () => .5);
    const right = new WeatherParticles('rain', 'dense', 7680, 4320, () => .5);
    left.configure({weatherWind: -100, weatherSpeed: 50, weatherDensity: 'dense'});
    right.configure({weatherWind: 100, weatherSpeed: 200, weatherDensity: 'dense'});
    const x = left.particles[0].x, y = left.particles[0].y;
    left.step(.03);right.step(.03);
    assert.ok(left.particles[0].x < x && left.particles[0].vx < 0);
    assert.ok(right.particles[0].x > x && right.particles[0].vx > 0);
    assert.ok(Math.abs((right.particles[0].y - y) / (left.particles[0].y - y) - 4) < 1e-7);
    right.configure({weatherQuality: 'economy', weatherDensity: 'dense'});
    assert.equal(right.particles.length, 132);
    assert.equal(left.particles.length, 220);
});

test('automatic frame rate adapts with hysteresis and ignores isolated spikes', () => {
    const budget = new WeatherFrameBudget();
    for (let i = 0; i < 80; i++) budget.sample(1);
    budget.sample(1000);
    assert.equal(budget.fps('auto'), 60);
    for (let i = 0; i < 80; i++) budget.sample(12);
    assert.equal(budget.fps('auto'), 30);
    for (let i = 0; i < 60; i++) budget.sample(1);
    assert.equal(budget.fps('auto'), 30);
    for (let i = 0; i < 150; i++) budget.sample(1);
    assert.equal(budget.fps('auto'), 60);
    assert.equal(budget.fps('economy'), 30);
});

test('scroll parallax preserves particles, varies with depth and wraps large jumps',()=>{
    let seed=19;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);
    const field=new WeatherParticles('leaves','dense',1200,800,random),particles=[...field.particles];
    for(const p of particles){p.x=600;p.y=400;}
    field.scrollBy(20,100);
    for(const p of particles){assert.ok(field.particles.includes(p));assert.ok(Math.abs(p.y-(400-100*(.2+p.depth*.55)))<1e-9);}
    field.scrollBy(-1e6,1e6);
    for(const p of field.particles){assert.ok(p.x>=-48&&p.x<=1248);assert.ok(p.y>=-64&&p.y<=824);}
    assert.ok(new Set(particles.map(p=>p.variant)).size>12);
});
