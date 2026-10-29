import {bindText, bindAttribute} from '../core/Locale.mjs';
import {animateUI} from './Motion.mjs';
/** Shared inspector navigation. Moving nodes preserves their bound controls. */
export default class InspectorTabs {
    constructor(container, definitions, {id, before = null, canSwitch = () => true} = {}) {
        this.container = container;
        this.canSwitch = canSwitch;
        this.active = definitions[0].key;
        this.scroll = new Map();
        this.bar = document.createElement('div');
        this.bar.className = 'inspector-tabs';
        this.bar.setAttribute('role', 'tablist');
        bindAttribute(this.bar, 'aria-label', 'Разделы свойств');
        this.bar.addEventListener('keydown', event => {
            if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key) && this.canSwitch() === false) {
                event.preventDefault();event.stopPropagation();
            }
        });
        container.insertBefore(this.bar, before);
        this.tabs = definitions.map(definition => {
            const button = document.createElement('button');
            button.type = 'button';
            button.id = `${id}-tab-${definition.key}`;
            button.className = 'inspector-tab';
            button.setAttribute('role', 'tab');
            button.innerHTML = `<i class="material-symbols-rounded" aria-hidden="true">${definition.icon}</i><span>${definition.label}</span>`;
            bindText(button.querySelector('span'), definition.label);
            const panel = document.createElement('div');
            panel.id = `${id}-panel-${definition.key}`;
            panel.className = 'inspector-tab-panel';
            panel.setAttribute('role', 'tabpanel');
            panel.setAttribute('aria-labelledby', button.id);
            button.setAttribute('aria-controls', panel.id);
            panel.append(...definition.nodes.filter(Boolean));
            this.bar.append(button);
            container.append(panel);
            button.addEventListener('click', () => this.select(definition.key));
            return {...definition, button, panel};
        });
        this.sync();
        // Keep keyboard-focused fields below the pinned tabs, including taller
        // Minecraft labels and density changes, without a hard-coded header size.
        this.resizeObserver = new ResizeObserver(() => {
            container.style.scrollPaddingTop = `${Math.ceil(this.bar.getBoundingClientRect().height) + 8}px`;
        });
        this.resizeObserver.observe(this.bar);
    }

    select(key, {force = false, remember = true} = {}) {
        const target = this.tabs.find(tab => tab.key === key && !tab.button.disabled);
        if (!target || !force && this.active !== key && this.canSwitch() === false) return false;
        if(remember)this.scroll.set(this.active, this.container.scrollTop);
        const changed = this.active !== key;
        this.active = key;
        for (const tab of this.tabs) {
            const selected = tab === target;
            tab.panel.hidden = !selected;
            tab.button.setAttribute('aria-selected', String(selected));
            tab.button.tabIndex = selected ? 0 : -1;
            tab.button.classList.toggle('active', selected);
        }
        if (changed) {
            this.container.scrollTop = this.scroll.get(key) || 0;
            for(const tab of this.tabs)if(tab!==target)for(const animation of tab.panel.getAnimations())animation.cancel();
            const pixel=document.documentElement.dataset.theme?.includes('minecraft');
            animateUI(target.panel,pixel?[{opacity:.2},{opacity:1}]:[{opacity:.2,transform:'translateY(4px)'},{opacity:1,transform:'none'}],{duration:160,easing:'ease-out'});
        }
        return true;
    }

    sync() {
        for (const tab of this.tabs) {
            const available = tab.available?.() !== false;
            tab.button.disabled = !available;
            tab.button.hidden = !available;
        }
        const active = this.tabs.find(tab => tab.key === this.active && !tab.button.disabled) || this.tabs.find(tab => !tab.button.disabled);
        this.bar.hidden = this.tabs.filter(tab => !tab.button.disabled).length < 2;
        if (active) this.select(active.key, {force: true});
        else this.tabs.forEach(tab => {tab.panel.hidden = true;});
    }
}
