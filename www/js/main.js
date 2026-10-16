import { isControlFocused } from './ui/ControlFocus.js';
import './core/DesktopBridge.js';
import App from './core/App.js';
import { initRippleEffect } from './ui/Ripple.js';

function savePanelsState() {
    const panels = document.querySelectorAll('.md-panel[id], .ps-panel[id], .panel-section[id]');
    const state = {};
    panels.forEach(p => {
        state[p.id] = p.classList.contains('expanded');
    });
    try {
        localStorage.setItem('molly_panels_state', JSON.stringify(state));
    } catch (_) {}
}

function restorePanelsState() {
    try {
        const saved = localStorage.getItem('molly_panels_state');
        if (saved) {
            const state = JSON.parse(saved);
            Object.entries(state).forEach(([panelId, isExpanded]) => {
                const el = document.getElementById(panelId);
                if (el) {
                    el.classList.toggle('expanded', Boolean(isExpanded));
                }
            });
        }
    } catch (_) {}
}

function startApp() {
    restorePanelsState();
    window.mollyEditor = new App();
    window.mollyApp = window.mollyEditor;
    initRippleEffect();
    console.log('[MollyStudio] GUI Editor loaded successfully!');

    document.querySelectorAll('.md-panel-header.collapsable, .ps-panel-header.collapsable, .section-header.collapsable').forEach(header => {
        const panel = header.closest('.md-panel, .ps-panel, .panel-section');
        header.setAttribute('role', 'button'); header.tabIndex = 0;
        header.setAttribute('aria-expanded', String(panel?.classList.contains('expanded') || false));
        header.addEventListener('keydown', event => {
            if (event.target === header && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault(); header.click();
            }
        });
    });

    document.addEventListener('click', (e) => {
        const header = e.target.closest('.md-panel-header.collapsable, .ps-panel-header.collapsable, .section-header.collapsable');
        if (!header) return;
        if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return;
        const panel = header.closest('.md-panel, .ps-panel, .panel-section');
        if (panel) {
            panel.classList.toggle('expanded');
            header.setAttribute('aria-expanded', String(panel.classList.contains('expanded')));
            savePanelsState();
            if (panel.id === 'color-panel-section' && panel.classList.contains('expanded')) {
                window.mollyEditor?.colorPicker?.resizeSB();
            }
        }
    });

    document.addEventListener('wheel', (e) => {
        const numInput = e.target.closest('input[type="number"]');
        if (!numInput || !isControlFocused(numInput) || numInput.disabled || numInput.readOnly || !e.deltaY) return;
        e.preventDefault();
        const step = parseFloat(numInput.step) || 1;
        const min = numInput.min !== '' ? parseFloat(numInput.min) : -Infinity;
        const max = numInput.max !== '' ? parseFloat(numInput.max) : Infinity;
        let current = parseFloat(numInput.value) || 0;
        if (e.deltaY < 0) {
            current = Math.min(max, current + step);
        } else {
            current = Math.max(min, current - step);
        }
        numInput.value = current;
        numInput.dispatchEvent(new Event('input', { bubbles: true }));
        numInput.dispatchEvent(new Event('change', { bubbles: true }));
    }, { passive: false });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
} else {
    startApp();
}