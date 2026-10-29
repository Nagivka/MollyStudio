import {bindAttribute} from '../core/Locale.mjs';
/** Native light-dismiss surface; moving existing controls keeps their bindings. */
export default class AnchoredPopover {
    constructor(trigger, label, { side = 'bottom' } = {}) {
        this.trigger = trigger;
        this.side = side;
        this.element = document.createElement('div');
        this.element.id = `${trigger.id}-popup`;
        this.element.className = 'tool-popover';
        this.element.setAttribute('popover', 'auto');
        this.element.setAttribute('role', 'dialog');
        bindAttribute(this.element, 'aria-label', label);
        trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.setAttribute('aria-controls', this.element.id);
        trigger.setAttribute('aria-expanded', 'false');
        document.body.append(this.element);
        trigger.addEventListener('click', () => {
            if (this.open) this.close();
            else {
                this.element.showPopover();
                this.position();
                this.element.querySelector('button:not(:disabled),input:not(:disabled),select:not(:disabled)')?.focus();
            }
        });
        this.element.addEventListener('beforetoggle', event => {
            if (event.newState === 'closed') this.restoreFocus = this.element.contains(document.activeElement);
        });
        this.element.addEventListener('toggle', () => {
            trigger.setAttribute('aria-expanded', String(this.open));
            if (!this.open && this.restoreFocus && trigger.getClientRects().length
                && (document.activeElement === document.body || this.element.contains(document.activeElement))) trigger.focus({ preventScroll: true });
            this.restoreFocus = false;
        });
        window.addEventListener('resize', () => { if (this.open) this.position(); });
    }

    get open() { return this.element.matches(':popover-open'); }
    close() { if (this.open) this.element.hidePopover(); }

    position() {
        const anchor = this.trigger.getBoundingClientRect(), box = this.element.getBoundingClientRect();
        const left = this.side === 'right' ? anchor.right + 6 : anchor.right - box.width;
        let top = this.side === 'right' ? anchor.top : anchor.bottom + 6;
        if (top + box.height > innerHeight - 8) top = Math.max(8, anchor.top - box.height - 6);
        this.element.style.left = `${Math.max(8, Math.min(innerWidth - box.width - 8, left))}px`;
        this.element.style.top = `${top}px`;
    }
}
