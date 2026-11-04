let installed = false;
const SHEEN = 'radial-gradient(ellipse at var(--glass-light-x,25%) var(--glass-light-y,0%),var(--glass-highlight),transparent 72%),linear-gradient(155deg,#ffffff12,transparent 38%,transparent 72%,#ffffff08)';

export function installLiquidGlassMotion() {
    if (installed || typeof window === 'undefined' || typeof document.addEventListener !== 'function') return;
    installed = true;
    let target = null, point = null, frame = 0;
    const preferences = ['prefers-reduced-motion: reduce', 'prefers-reduced-transparency: reduce', 'prefers-contrast: more'].map(query => matchMedia(`(${query})`));
    const allowed = () => document.documentElement.hasAttribute('data-liquid-glass')
        && !document.documentElement.dataset.theme?.includes('minecraft')
        && !document.documentElement.classList.contains('no-animations')
        && !preferences.some(preference => preference.matches);
    const clear = () => {
        cancelAnimationFrame(frame);
        frame = 0;
        point = null;
        if (target) {
            for (const property of ['--glass-light-x', '--glass-light-y', '--glass-sheen']) target.style.removeProperty(property);
            target = null;
        }
    };
    const update = () => {
        frame = 0;
        if (!allowed() || !target?.isConnected) { clear(); return; }
        const rect = target.getBoundingClientRect();
        target.style.setProperty('--glass-light-x', `${Math.round(Math.max(0, Math.min(rect.width, point.x - rect.left)))}px`);
        target.style.setProperty('--glass-light-y', `${Math.round(Math.max(0, Math.min(rect.height, point.y - rect.top)))}px`);
        // Resolve the light position on the element, rather than inheriting a
        // gradient whose custom properties were already resolved on the root.
        target.style.setProperty('--glass-sheen', SHEEN);
    };
    document.addEventListener('pointermove', event => {
        if (event.pointerType === 'touch' || event.buttons || !allowed()) { clear(); return; }
        const next = event.target.closest?.('.md-btn,.md-icon-btn,.doc-tab,.settings-tab-btn,.m3-recent-card');
        if (!next || next.disabled || next.closest('.studio-basement,[inert]')) { clear(); return; }
        if (next !== target) { clear(); target = next; }
        point = {x: event.clientX, y: event.clientY};
        if (!frame) frame = requestAnimationFrame(update);
    }, {passive: true});
    document.addEventListener('pointerout', event => { if (target && !target.contains(event.relatedTarget)) clear(); });
    document.addEventListener('scroll', clear, {capture: true, passive: true});
    window.addEventListener('blur', clear);
    window.addEventListener('pagehide', clear);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
    new MutationObserver(() => { if (!allowed()) clear(); }).observe(document.documentElement, {
        attributes: true, attributeFilter: ['class', 'data-theme', 'data-liquid-glass']
    });
    for (const preference of preferences) preference.addEventListener('change', clear);
}
