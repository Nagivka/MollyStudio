import AnchoredPopover from './AnchoredPopover.js';
import {bindText, bindAttribute} from '../core/Locale.mjs';

const SELECTION_ACTIONS = {
    copy: 'Копировать', cut: 'Вырезать', paste: 'Вставить', fill: 'Залить цветом', stroke: 'Обвести контур',
    delete: 'Очистить пиксели', fliph: 'Отразить по горизонтали', flipv: 'Отразить по вертикали',
    rotcw: 'Повернуть на 90°', rotccw: 'Повернуть на −90°', deselect: 'Снять выделение'
};

export default class ToolOptionsBar {
    constructor(app) {
        this.app = app;
        this.root = document.querySelector('.options-bar');
        if (!this.root) return;
        this.prepareSelectionActions();
        document.getElementById('btn-selection-edit')?.addEventListener('click', () => {
            app.tools.setTool('marquee');
            document.getElementById('canvas-wrapper')?.focus({preventScroll: true});
        });
        this.groups = [...this.root.querySelectorAll('.opt-group')].map(group => {
            const chunks = [];
            let chunk;
            for (const node of [...group.childNodes]) {
                if (node.nodeType === 3 && !node.textContent.trim()) { node.remove(); continue; }
                if (node.nodeType === 1 && node.matches('.opt-sep')) { node.remove(); chunk = null; continue; }
                if (node.nodeType === 1 && node.matches('[data-selection-action]')) { chunks.push(node); chunk = null; continue; }
                if (!chunk) {
                    chunk = document.createElement('div'); chunk.className = 'tool-option';
                    chunks.push(chunk);
                }
                chunk.append(node);
            }
            if (chunks[0]) chunks[0].dataset.pinned = 'true';
            group.append(...chunks);
            const more = this.makeButton(`${group.id}-more`, 'Дополнительные параметры', 'Ещё');
            group.append(more);
            const popup = new AnchoredPopover(more, 'Дополнительные параметры инструмента');
            popup.element.addEventListener('click', event => {
                const action = event.target.closest('[id^="btn-marquee-"]');
                if (!action || action.disabled) return;
                requestAnimationFrame(() => {
                    popup.close();
                    const target = !action.hidden && group.contains(action) ? action
                        : !more.hidden ? more : document.getElementById('canvas-wrapper');
                    target?.focus({ preventScroll: true });
                });
            }, true);
            return { group, chunks, more, popup };
        });
        const schedule = () => {
            if (this.frame) cancelAnimationFrame(this.frame);
            this.frame = requestAnimationFrame(() => { this.frame = null; this.fit(); });
        };
        this.observer = new ResizeObserver(schedule); this.observer.observe(this.root);
        this.groups.forEach(({ popup }) => popup.element.addEventListener('toggle', () => { if (!popup.open) schedule(); }));
        app.bus.on('TOOL_CHANGED', () => { this.close(); schedule(); });
        app.bus.on('LAYER_ACTIVE_CHANGED', schedule);
        app.bus.on('PROJECT_SWITCHED', () => { this.close(); schedule(); });
        app.bus.on('SETTINGS_CHANGED', schedule);
        const selectionChanged = () => { if (this.syncSelectionActions()) schedule(); };
        app.bus.on('CANVAS_UPDATED', selectionChanged);
        app.bus.on('SELECTION_CLIPBOARD_CHANGED', selectionChanged);
        document.fonts.ready.then(schedule);
        this.fit();
    }

    makeButton(id, name, text) {
        const button = document.createElement('button'); button.id = id; button.type = 'button';
        button.className = 'md-chip-btn tool-options-more'; bindAttribute(button, 'aria-label', name); bindAttribute(button, 'title', name);
        button.innerHTML = '<i class="material-symbols-rounded" aria-hidden="true">more_horiz</i>';
        const label = document.createElement('span'); bindText(label, text); button.append(label);
        return button;
    }

    prepareSelectionActions() {
        const group = document.getElementById('opt-bar-marquee');
        const actions = group.querySelector('[data-selection-actions]');
        for (const [key, label] of Object.entries(SELECTION_ACTIONS)) {
            const action = document.getElementById(`btn-marquee-${key}`);
            const icon = action.querySelector('i'); icon.setAttribute('aria-hidden', 'true');
            const text = document.createElement('span'); text.className = 'selection-action-label'; bindText(text, label);
            action.replaceChildren(icon, text);
            bindAttribute(action, 'aria-label', label); bindAttribute(action, 'title', label);
            const chunk = document.createElement('div'); chunk.className = 'tool-option selection-action';
            chunk.dataset.selectionAction = key; chunk.dataset.priority = '1'; chunk.append(action);
            if (['copy', 'cut', 'paste'].includes(key)) chunk.dataset.caption = 'true';
            actions.before(chunk);
            action.addEventListener('click', () => requestAnimationFrame(() => {
                if (action.hidden && document.activeElement === document.body) document.getElementById('canvas-wrapper')?.focus({ preventScroll: true });
            }));
        }
        actions.remove();
    }

    close() {
        this.groups?.forEach(({ popup }) => popup.close());
    }

    syncSelectionActions() {
        const m = this.app.tools.tools.marquee, layer = this.app.layerManager.getActiveLayer();
        const selected = Boolean(m.selection), raster = Boolean(layer && !['text', 'group'].includes(layer.type) && !layer.isBase && !layer.isGroup);
        const editable = raster && this.app.layerManager.isEditable(layer), alphaLocked = layer?.alphaLocked;
        const available = selected || Boolean(m.clipboard);
        let changed = this.hadSelection !== selected || this.hadSelectionActions !== available;
        this.hadSelection = selected; this.hadSelectionActions = available;
        const drag = document.getElementById('selection-drag-options');
        const drawingSelection = ['lasso', 'wand'].includes(this.app.tools.currentToolId);
        if (drag.hidden !== (!selected || drawingSelection)) {drag.hidden = !selected || drawingSelection; changed = true;}
        const edit = document.getElementById('btn-selection-edit');
        if (edit && edit.hidden !== (!selected || !drawingSelection)) {edit.hidden = !selected || !drawingSelection; changed = true;}
        for (const key of Object.keys(SELECTION_ACTIONS)) {
            let enabled = selected && editable;
            if (key === 'copy') enabled = selected && Boolean(layer && !layer.isGroup);
            else if (key === 'paste') enabled = Boolean(m.clipboard && (!layer?.isGroup || this.app.layerManager.isEditable(layer)));
            else if (key === 'deselect') enabled = selected;
            else if (['cut', 'delete', 'fliph', 'flipv', 'rotcw', 'rotccw'].includes(key)) enabled &&= !alphaLocked;
            const button = document.getElementById(`btn-marquee-${key}`);
            if (button.disabled !== !enabled) button.disabled = !enabled;
            if (button.hidden !== !enabled) { button.hidden = !enabled; changed = true; }
        }
        return changed;
    }

    fit() {
        this.syncSelectionActions();
        const style = getComputedStyle(this.root);
        const available = this.root.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        for (const { group, chunks, more, popup } of this.groups) {
            if (!group.classList.contains('visible') || !this.root.clientHeight) { popup.close(); continue; }
            if (popup.open) { popup.position(); continue; }
            const focused = document.activeElement;
            for (let index = chunks.length - 1; index >= 0; index--) {
                const chunk = chunks[index], next = chunks[index + 1] || more;
                chunk.hidden = false;
                if (chunk.parentElement !== group || chunk.nextElementSibling !== next) group.insertBefore(chunk, next);
            }
            more.hidden = true;
            const gap = parseFloat(getComputedStyle(group).columnGap) || 8;
            const shown = chunks.filter(chunk => [...chunk.children].some(node => node.getClientRects().length));
            chunks.forEach(chunk => { chunk.hidden = !shown.includes(chunk); });
            const widths = new Map(shown.map(chunk => [chunk, chunk.getBoundingClientRect().width]));
            let width = shown.reduce((sum, chunk) => sum + widths.get(chunk), 0) + Math.max(0, shown.length - 1) * gap;
            if (width > available) {
                more.hidden = false;
                width += more.getBoundingClientRect().width + gap;
                const candidates = [...shown].reverse().sort((a, b) => Number(a.dataset.priority || 0) - Number(b.dataset.priority || 0));
                for (const chunk of candidates) {
                    if (width <= available) break;
                    if (chunk.dataset.pinned || chunk.querySelector('[data-pinned]')) continue;
                    width -= widths.get(chunk) + gap; popup.element.append(chunk);
                }
                // Priority determines what leaves the bar; the menu retains the original reading order.
                chunks.filter(chunk => chunk.parentElement === popup.element).forEach(chunk => popup.element.append(chunk));
            }
            const overflow = popup.element.children.length > 0;
            more.hidden = !overflow;
            if (!overflow) popup.close();
            if (focused && popup.element.contains(focused) && !popup.open) more.focus({ preventScroll: true });
            else if (focused && group.contains(focused) && document.activeElement !== focused) focused.focus({ preventScroll: true });
            if (popup.open) popup.position();
        }
    }
}
