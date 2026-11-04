import {installLiquidGlassMotion} from './LiquidGlassMotion.js';
import { initRippleEffect } from './Ripple.js';
import {installVisualEffects} from './VisualEffects.js';
import {installUISounds} from './UISounds.js';
import { installKeyboardNavigation } from './KeyboardNavigation.js';
import { initIconDisclosures } from './IconDisclosure.js';
import { installColorDragDrop } from './ColorDragDrop.js';
import './MinecraftTheme.js';
import {installLocalization,bindAttribute,getLabelSource} from '../core/Locale.mjs';

// Keep actual HTML controls, IDs and events intact in every application window.
initRippleEffect();
installLiquidGlassMotion();
installVisualEffects();
installUISounds();
installKeyboardNavigation();
initIconDisclosures();
installColorDragDrop();
installLocalization();
window.desktopAPI?.onNativeMenuAction?.(action=>{
    const active=document.activeElement,editable=active?.matches('input,textarea,select,[contenteditable="true"]');
    const edits={'edit-undo':['KeyZ','z',false],'edit-redo':['KeyZ','z',true],'select-cut':['KeyX','x',false],'select-copy':['KeyC','c',false],'select-paste':['KeyV','v',false],'select-all':['KeyA','a',false]};
    if(edits[action]&&(editable||document.querySelector('dialog[open]')||!window.mollyEditor)){
        const [code,key,shiftKey]=edits[action],event=new KeyboardEvent('keydown',{code,key,shiftKey,metaKey:true,bubbles:true,cancelable:true});
        (active||document.body).dispatchEvent(event);
        if(!event.defaultPrevented)window.desktopAPI.nativeEdit(action).catch(console.error);
    }else window.mollyEditor?.menuBar.handleAction(action);
});
for(const button of document.querySelectorAll('.settings-win-sidebar .settings-tab-btn')){
    const label=button.querySelector('span');
    if(label){
        const source=getLabelSource(label)||label.textContent.trim();
        bindAttribute(button,'title',source);bindAttribute(button,'aria-label',source);
        button.querySelector('.material-symbols-rounded')?.setAttribute('aria-hidden','true');
    }
}
