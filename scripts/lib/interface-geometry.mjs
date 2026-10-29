// Read-only DOM checks. Keep the function self-contained so browser and native
// Chromium scenarios can serialize the same checks without importing app code.
export function inspectInterfaceGeometry() {
    const label = element => element.id || element.getAttribute('aria-label')
        || element.textContent.trim().replace(/\s+/g, ' ').slice(0, 70) || element.className;
    const shown = element => element.getClientRects().length && !element.closest('[hidden]')
        && getComputedStyle(element).visibility !== 'hidden';
    const overlays = [...document.querySelectorAll('dialog[open],.modal-overlay.show,[popover]:popover-open')].filter(shown);
    const root = overlays.at(-1) || document.querySelector('.menu-dropdown.show,.m3-layer-context-menu.show') || document;
    function bounds(element) {
        if (!shown(element)) return null;
        const box = element.getBoundingClientRect();
        const result = { left: Math.max(0, box.left), top: Math.max(0, box.top), right: Math.min(innerWidth, box.right), bottom: Math.min(innerHeight, box.bottom) };
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent), outer = parent.getBoundingClientRect();
            if (/hidden|auto|scroll|clip/.test(style.overflowX)) {
                result.left = Math.max(result.left, outer.left); result.right = Math.min(result.right, outer.right);
            }
            if (/hidden|auto|scroll|clip/.test(style.overflowY)) {
                result.top = Math.max(result.top, outer.top); result.bottom = Math.min(result.bottom, outer.bottom);
            }
            const tabs = parent.querySelector(':scope > .inspector-tabs');
            if (tabs && !tabs.contains(element) && getComputedStyle(tabs).position === 'sticky') {
                // Content scrolling behind an opaque pinned tab bar is occluded.
                result.top = Math.max(result.top, tabs.getBoundingClientRect().bottom);
            }
        }
        return result.right - result.left > 4 && result.bottom - result.top > 4 ? result : null;
    }
    const selector = 'button,[role="button"],[role="tab"],[role="menuitem"],input:not([type="file"]),select,textarea';
    const controls = [...root.querySelectorAll(selector)].map(element => ({ element, box: bounds(element) })).filter(item => item.box);
    const overlaps = [], touching = [];
    for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
        const a = controls[i], b = controls[j];
        if (a.element.contains(b.element) || b.element.contains(a.element)) continue;
        // The foreground/background swatches deliberately overlap as one compound picker.
        if ([a.element.id, b.element.id].sort().join(',') === 'swatch-bg,swatch-fg') continue;
        const x = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
        const y = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
        if (x > 1.5 && y > 1.5) overlaps.push({ a: label(a.element), b: label(b.element), width: Math.round(x), height: Math.round(y) });
        else if (a.element.parentElement === b.element.parentElement && !a.element.parentElement.matches('.settings-win-sidebar,.settings-tabs-sidebar')
            && ((y > 8 && x >= -.5) || (x > 8 && y >= -.5))) touching.push({ a: label(a.element), b: label(b.element) });
    }
    const clipped = controls.filter(({ element }) => element.clientWidth > 0 && !element.matches('input,textarea')
        && (element.scrollWidth > element.clientWidth + 3 || element.scrollHeight > element.clientHeight + 3))
        .map(({ element }) => ({ element: label(element), width: element.clientWidth, scrollWidth: element.scrollWidth, height: element.clientHeight, scrollHeight: element.scrollHeight }));
    const overflow = [...root.querySelectorAll('.top-menu,.opt-group.visible,.bottom-status-bar,.zoom-controls,.md-panel-props,#color-panel-section,.control-label-row,.buttons-sidebar-scroll-area,.prefix-scroll,.settings-win-content-scroll,.new-win-card')]
        .filter(element => shown(element) && element.scrollWidth > element.clientWidth + 3)
        .map(element => ({ element: label(element), width: element.clientWidth, scrollWidth: element.scrollWidth }));
    const pixelFallbacks = document.documentElement.dataset.theme?.includes('minecraft')
        ? [...root.querySelectorAll('.material-symbols-rounded')].filter(element => bounds(element)
            && !element.dataset.mcIcon && getComputedStyle(element).maskImage === 'none').map(element => element.textContent.trim()) : [];
    const dialogsOutside = overlays.filter(element => {
        const box = element.getBoundingClientRect();
        return box.left < -2 || box.top < -2 || box.right > innerWidth + 2 || box.bottom > innerHeight + 2;
    }).map(label);
    return {
        theme: document.documentElement.dataset.theme, viewport: [innerWidth, innerHeight], fonts: document.fonts.status,
        density: getComputedStyle(document.documentElement).getPropertyValue('--md-ui-scale').trim(),
        rootOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        rootScroll: [typeof scrollX === 'number' ? scrollX : 0, typeof scrollY === 'number' ? scrollY : 0],
        controls: controls.length, overlaps, touching, clipped, overflow, pixelFallbacks, dialogsOutside
    };
}

