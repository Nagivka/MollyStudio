/**
 * Material Design 3 State Layer & Ripple Effect
 * Provides smooth, organic tactile feedback on user clicks across interactive elements.
 */
const installedDocuments = new WeakSet();

export function initRippleEffect() {
    if (installedDocuments.has(document)) return;
    installedDocuments.add(document);
    document.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('input, select, textarea')) return;
        const target = e.target.closest('button, [role="button"], [role="tab"], .tool-btn, .menu-btn, .doc-tab, .md-item-card, .m3-recent-card, .color-square-slot');
        if (!target || target.disabled || target.closest('[inert], [aria-disabled="true"]')) return;

        const rect = target.getBoundingClientRect();
        const diameter = Math.max(rect.width, rect.height) * 1.5;
        const radius = diameter / 2;

        const ripple = document.createElement('span');
        ripple.className = 'md-ripple-wave';
        ripple.setAttribute('aria-hidden', 'true');
        ripple.style.width = `${diameter}px`;
        ripple.style.height = `${diameter}px`;
        ripple.style.left = `${e.clientX - rect.left - radius}px`;
        ripple.style.top = `${e.clientY - rect.top - radius}px`;

        const comp = window.getComputedStyle(target);
        if (comp.position === 'static') {
            target.style.position = 'relative';
        }
        if (comp.overflow !== 'hidden') {
            target.style.overflow = 'hidden';
        }

        target.appendChild(ripple);

        let cleaned = false;
        const cleanUp = () => {
            if (cleaned) return;
            cleaned = true;
            ripple.style.transition = 'opacity 200ms ease';
            ripple.style.opacity = '0';
            setTimeout(() => {
                try { ripple.remove(); } catch (_) {}
            }, 200);
            window.removeEventListener('pointerup', cleanUp);
            window.removeEventListener('pointercancel', cleanUp);
        };

        window.addEventListener('pointerup', cleanUp, { once: true });
        window.addEventListener('pointercancel', cleanUp, { once: true });
        // Fail-safe cleanup so ripple never stays stuck on screen if pointerup is swallowed
        setTimeout(cleanUp, 450);
    });
}
