import {SHORTCUT_COMMANDS,shortcutKeys,eventChord,displayChord} from '../core/Shortcuts.mjs';
import {isShortcutTarget} from './KeyboardNavigation.js';

export default class ShortcutManager{
    constructor(app){
        this.app=app;this.refresh();
        app.bus.on('SETTINGS_CHANGED',()=>this.refresh());
        document.addEventListener('keydown',event=>this.onKeyDown(event),true);
    }
    refresh(){
        const overrides=this.app.settingsManager.get('shortcutBindings')||{};
        this.bindings=new Map();this.retired=new Set();
        for(const command of SHORTCUT_COMMANDS){
            for(const key of shortcutKeys(command,overrides))this.bindings.set(key,command.id);
            if(Object.hasOwn(overrides,command.id))for(const key of command.keys){this.retired.add(key);if(command.id.startsWith('tool:')&&!key.includes('+')&&!['KeyG','KeyU','KeyO','KeyC'].includes(key))this.retired.add('Shift+'+key);}
            const label=shortcutKeys(command,overrides).map(displayChord).join(' / ');
            for(const node of document.querySelectorAll('[data-action]'))if(node.dataset.action===command.id){
                const hint=node.querySelector('.shortcut');if(hint)hint.textContent=label;
            }
        }
    }
    onKeyDown(event){
        if(event.defaultPrevented||event.isComposing||event.getModifierState?.('AltGraph')||isShortcutTarget(event.target,event))return;
        if(document.querySelector('dialog[open],.modal-overlay.show,[role="alertdialog"][aria-modal="true"]'))return;
        const chord=eventChord(event);if(!chord)return;
        const action=this.bindings.get(chord);
        if(!action&&!this.retired.has(chord))return;
        event.preventDefault();event.stopImmediatePropagation();
        if(!action||event.repeat&&!/^(?:view-zoom-|tool:|brush-|color-(?:darker|lighter))/.test(action))return;
        this.app.menuBar.handleAction(action);
    }
}
