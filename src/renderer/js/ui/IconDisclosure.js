import {labelHTML} from '../core/Locale.mjs';
import {motionEnabled} from './Motion.mjs';
export {motionEnabled} from './Motion.mjs';
let nextId = 0;
const installed = new WeakSet();
const active = new Map();
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

/** Labels stay visible; icons replace the browser's small disclosure triangle. */
export function iconDisclosure({ label, icon, content, className = '', open = false, hidden = false }) {
    const id = 'ui-disclosure-' + ++nextId;
    return `<section class="ui-disclosure ${escape(className)}"${hidden ? ' hidden' : ''}>
        <button type="button" class="ui-disclosure-trigger" id="${id}-button" aria-expanded="${open}" aria-controls="${id}">
            <i class="material-symbols-rounded ui-disclosure-icon" aria-hidden="true">${escape(icon)}</i><span>${labelHTML(label)}</span>
            <i class="material-symbols-rounded ui-disclosure-indicator" aria-hidden="true">expand_more</i>
        </button><div class="ui-disclosure-body" id="${id}" role="region" aria-labelledby="${id}-button"${open ? '' : ' hidden inert'}>${content}</div></section>`;
}

export function setDisclosureOpen(trigger, open) {
    const panel = document.getElementById(trigger.getAttribute('aria-controls'));
    if (!panel) return;
    const start = panel.hidden ? 0 : panel.getBoundingClientRect().height;
    const opacity = panel.hidden ? 0 : Number(getComputedStyle(panel).opacity);
    const previous = active.get(panel);previous?.animation.cancel();active.delete(panel);
    trigger.setAttribute('aria-expanded', String(open));
    if (!open && panel.contains(document.activeElement)) trigger.focus();
    panel.inert = !open;panel.setAttribute('aria-hidden', String(!open));
    panel.hidden = false;
    const finish = () => { panel.hidden = !open;panel.style.overflow = '';active.delete(panel); };
    if (!motionEnabled() || !panel.animate) { finish();return; }
    panel.style.overflow = 'hidden';
    const animation = panel.animate([{ height: start + 'px', opacity }, { height: (open ? panel.scrollHeight : 0) + 'px', opacity: open ? 1 : 0 }],
        { duration: open ? 300 : 220, easing: 'cubic-bezier(.2,0,0,1)' });
    active.set(panel, { animation, finish });
    animation.finished.then(() => { if (active.get(panel)?.animation === animation) finish(); }).catch(() => {});
}

export function initIconDisclosures(root = document) {
    if (installed.has(root)) return;
    installed.add(root);
    root.addEventListener('click', event => {
        const trigger = event.target.closest?.('.ui-disclosure-trigger');
        if (trigger && !trigger.disabled) setDisclosureOpen(trigger, trigger.getAttribute('aria-expanded') !== 'true');
    });
    const finishMotion = () => {
        if (motionEnabled()) return;
        for (const { animation, finish } of [...active.values()]) { animation.cancel();finish(); }
    };
    new MutationObserver(finishMotion).observe(root.documentElement, { attributes: true, attributeFilter: ['class'] });
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', finishMotion);
}
