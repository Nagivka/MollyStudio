import { minecraftIcon } from './MinecraftIcons.mjs';
import { minecraftIconSize, minecraftRangeState, minecraftRangeTicks } from './MinecraftControls.mjs';

// Only decoration: never replace native controls or their values/events, and
// never patch DOM prototypes. Everything is restored on leaving this theme.
const root = document.documentElement;
const rangeSelector = 'input[type="range"]:not(.md-hue-slider)';
const iconSelector = '.material-symbols-rounded:not(.md-collapse-icon, .ui-disclosure-indicator)';
const ranges = new Set(), icons = new Set(), dirtyIcons = new Set();
const iconSizes = new WeakMap();
let active = false, frame = 0;

function style(node, property, value) {
    if (value == null) {
        if (node.style.getPropertyValue(property)) node.style.removeProperty(property);
    } else if (node.style.getPropertyValue(property) !== value) node.style.setProperty(property, value);
}
function clearRange(input) {
    style(input, '--mc-range-fill', null);
    style(input, '--mc-range-step-size', null);
    style(input, '--mc-range-ticks', null);
    style(input, '--mc-range-fill-offset', null);
    delete input.dataset.mcRange;
    delete input.dataset.mcStepped;
    ranges.delete(input);
}
function syncRange(input) {
    if (!active || !(input instanceof HTMLInputElement)) return;
    if (!input.matches(rangeSelector)) { if (ranges.has(input)) clearRange(input); return; }
    const state = minecraftRangeState(input);
    ranges.add(input);
    input.dataset.mcRange = 'true';
    input.dataset.mcStepped = String(state.stepSize !== null);
    style(input, '--mc-range-fill', state.fill);
    style(input, '--mc-range-step-size', state.stepSize);
    style(input, '--mc-range-ticks', minecraftRangeTicks(input));
    const fraction = Number.parseFloat(state.fill) / 100;
    // CSS owns the density (24px in the editor, 32px in settings). The same
    // size drives the native thumb, interior ticks and the fill end point.
    style(input, '--mc-range-fill-offset', `calc(var(--mc-range-thumb-size) * ${0.5 - fraction})`);
}
function clearIcon(icon) {
    delete icon.dataset.mcIcon;
    style(icon, '--mc-icon-image', null);
    style(icon, '--mc-icon-size', null);
    icons.delete(icon);
    dirtyIcons.delete(icon);
    iconSizes.delete(icon);
}
function syncIcon(icon) {
    if (!active || !(icon instanceof Element)) return;
    if (!icon.matches(iconSelector)) { if (icons.has(icon)) clearIcon(icon); return; }
    const drawing = minecraftIcon(icon.textContent);
    if (!drawing) { if (icons.has(icon)) clearIcon(icon); return; }
    const inlineSize = Number.parseFloat(icon.style.fontSize);
    if (!iconSizes.has(icon)) iconSizes.set(icon, minecraftIconSize(inlineSize || getComputedStyle(icon).fontSize));
    const size = Number.isFinite(inlineSize) ? minecraftIconSize(inlineSize) : iconSizes.get(icon);
    icons.add(icon);
    icon.dataset.mcIcon = drawing.glyph;
    style(icon, '--mc-icon-image', drawing.mask);
    style(icon, '--mc-icon-size', `${size}px`);
}
function visit(node) {
    if (!(node instanceof Element)) return;
    if (node.matches(rangeSelector)) syncRange(node);
    if (node.matches(iconSelector)) syncIcon(node);
    node.querySelectorAll(rangeSelector).forEach(syncRange);
    node.querySelectorAll(iconSelector).forEach(syncIcon);
}
function releaseRemoved(node) {
    if (!(node instanceof Element) || node.isConnected) return;
    if (ranges.has(node)) clearRange(node);
    if (icons.has(node)) clearIcon(node);
    node.querySelectorAll('[data-mc-range]').forEach(clearRange);
    node.querySelectorAll('[data-mc-icon]').forEach(clearIcon);
}
function queueRefresh() {
    if (!active || frame) return;
    frame = requestAnimationFrame(() => {
        frame = 0;
        if (!active) return;
        // UI controllers also assign .value programmatically; their label,
        // class and selection updates are batched into this one frame.
        for (const input of ranges) if (input.isConnected) syncRange(input); else clearRange(input);
        for (const icon of dirtyIcons) if (icon.isConnected) syncIcon(icon); else clearIcon(icon);
        dirtyIcons.clear();
    });
}

const contentObserver = new MutationObserver(records => {
    let refresh = false;
    for (const record of records) {
        const element = record.target instanceof Element ? record.target : record.target.parentElement;
        const icon = icons.has(element) ? element : element?.closest('.material-symbols-rounded');
        if (icon) dirtyIcons.add(icon);
        if (record.type === 'attributes') {
            if (element instanceof HTMLInputElement) syncRange(element);
            // Our guarded style writes produce at most one final observer pass.
            if (record.attributeName !== 'style') refresh = true;
        } else {
            refresh = true;
            if (record.type === 'childList') {
                record.removedNodes.forEach(releaseRemoved);
                record.addedNodes.forEach(visit);
            }
        }
    }
    if (refresh || dirtyIcons.size) queueRefresh();
});

function applyTheme() {
    const enabled = ['minecraft', 'light-minecraft'].includes(root.dataset.theme);
    if (enabled === active) return;
    active = enabled;
    contentObserver.disconnect();
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    if (active) {
        visit(document.body);
        contentObserver.observe(document.body, {
            childList: true, characterData: true, subtree: true, attributes: true,
            attributeFilter: ['value', 'min', 'max', 'step', 'type', 'class', 'style', 'aria-pressed', 'aria-selected']
        });
    } else {
        for (const input of [...ranges]) clearRange(input);
        for (const icon of [...icons]) clearIcon(icon);
        dirtyIcons.clear();
    }
}

for (const event of ['input', 'change', 'focusin', 'pointerover']) {
    document.addEventListener(event, e => { if (active) syncRange(e.target); }, { passive: true });
}
for (const event of ['click', 'keydown']) document.addEventListener(event, queueRefresh, { passive: true });
const themeObserver = new MutationObserver(applyTheme);
themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
applyTheme();
