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
installVisualEffects();
installUISounds();
installKeyboardNavigation();
initIconDisclosures();
installColorDragDrop();
installLocalization();
for(const button of document.querySelectorAll('.settings-win-sidebar .settings-tab-btn')){
    const label=button.querySelector('span');
    if(label){
        const source=getLabelSource(label)||label.textContent.trim();
        bindAttribute(button,'title',source);bindAttribute(button,'aria-label',source);
        button.querySelector('.material-symbols-rounded')?.setAttribute('aria-hidden','true');
    }
}
