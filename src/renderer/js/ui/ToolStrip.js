import {bindAttribute, bindText, getAttributeSource} from '../core/Locale.mjs';
import AnchoredPopover from './AnchoredPopover.js';
import { toolbarLayout, visibleToolIndices } from './ToolbarLayout.mjs';

export default class ToolStrip {
    constructor(root, bus) {
        this.root = root;
        if (!root) return;
        this.group = root.querySelector('.tools-group');
        this.buttons = [...this.group.querySelectorAll('.tool-btn')];
        this.group.querySelectorAll('.toolbar-divider').forEach(divider => divider.remove());
        this.more = document.createElement('button');
        this.more.type = 'button';
        this.more.id = 'btn-more-tools';
        this.more.className = 'md-icon-btn tool-overflow-toggle';
        bindAttribute(this.more, "title", 'Ещё инструменты');
        bindAttribute(this.more, "aria-label", 'Ещё инструменты');
        this.more.innerHTML = '<i class="material-symbols-rounded" aria-hidden="true">more_horiz</i>';
        this.group.after(this.more);
        this.popup = new AnchoredPopover(this.more, 'Другие инструменты', { side: 'right' });
        this.popup.element.classList.add('tool-overflow-list');
        for (const button of this.buttons) {
            const label = document.createElement('span');
            label.className = 'tool-overflow-label';
            bindText(label,getAttributeSource(button,'aria-label') || getAttributeSource(button,'title'));
            button.append(label);
        }
        this.popup.element.addEventListener('click', event => {
            const button = event.target.closest('.tool-btn');
            if (!button) return;
            this.popup.close();
            requestAnimationFrame(() => {
                this.fit();
                if (!document.querySelector('dialog[open],.modal-overlay.show')) button.focus({ preventScroll: true });
            });
        });
        bus?.on('TOOL_CHANGED', () => this.fit());
        bus?.on('PROJECT_SWITCHED', () => this.popup.close());
    }

    fit() {
        if (!this.root?.clientHeight) { this.popup?.close(); return; }
        const pixel = document.documentElement.dataset.theme?.includes('minecraft');
        const preferred = pixel ? 36 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tool-btn-size')) || 34;
        const layout = toolbarLayout(this.root.clientHeight, this.buttons.length, preferred, pixel ? 32 : 28);
        const active = this.buttons.findIndex(button => button.classList.contains('active'));
        const visible = visibleToolIndices(this.buttons.length, layout.visible, active);
        const focused = document.activeElement;
        for (const [parent, selected] of [[this.group, true], [this.popup.element, false]]) {
            const ordered = this.buttons.filter((button, index) => visible.has(index) === selected);
            let cursor = parent.firstElementChild;
            for (const button of ordered) {
                if (button === cursor) cursor = cursor.nextElementSibling;
                else parent.insertBefore(button, cursor);
            }
        }
        this.more.hidden = !layout.overflow;
        if (!layout.overflow) this.popup.close();
        if (this.buttons.includes(focused)) {
            if (focused.parentElement === this.popup.element && !this.popup.open) this.more.focus({ preventScroll: true });
            else if (document.activeElement !== focused) focused.focus({ preventScroll: true });
        }
        this.root.classList.add('adaptive-toolbar');
        this.root.style.setProperty('--toolbar-button-size', `${layout.size}px`);
        this.root.style.setProperty('--toolbar-button-gap', `${layout.gap}px`);
    }
}
