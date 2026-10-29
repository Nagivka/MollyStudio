import {bindText,labelHTML,attributeHTML} from '../core/Locale.mjs';
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function actionButtonHTML({action,label,icon='add',attribute='data-action',className='md-btn outlined'}){
    if(!/^data-[a-z-]+$/.test(attribute))throw Error('Invalid action attribute');
    return '<button type="button" class="'+escape(className)+'" '+attribute+'="'+escape(action)+'"'+attributeHTML('aria-label',label)+attributeHTML('title',label)+'><i class="material-symbols-rounded" aria-hidden="true">'+escape(icon)+'</i><span>'+labelHTML(label)+'</span></button>';
}
export function numberFieldHTML({label,attribute,attributeValue,min,max,step=1,value=''}){
    if(!/^data-[a-z-]+$/.test(attribute))throw Error('Invalid input attribute');
    return '<label class="prop-field-block"><span>'+labelHTML(label)+'</span><input class="md-input" type="number" '+attribute+(attributeValue===undefined?'':'="'+escape(attributeValue)+'"')+' min="'+escape(min)+'" max="'+escape(max)+'" step="'+escape(step)+'" value="'+escape(value)+'"></label>';
}
export function switchHTML(attribute,label,checked=false,value){
    if(!/^data-[a-z-]+$/.test(attribute))throw Error('Invalid switch attribute');
    return '<label class="md-switch"><input type="checkbox" '+attribute+(value===undefined?'':'="'+escape(value)+'"')+(checked?' checked':'')+'><span class="md-switch-track"><span class="md-switch-thumb"></span></span><span class="md-switch-label">'+labelHTML(label)+'</span></label>';
}
/** Validation reads native constraints; invalid edits never become a numeric NaN. */
export function numberValue(input){
    const value=input.valueAsNumber;
    const min=input.min===''||input.min==null?-Infinity:Number(input.min),max=input.max===''||input.max==null?Infinity:Number(input.max);
    const step=input.step==='any'?0:Number(input.step)||1,base=Number.isFinite(min)?min:Number(input.defaultValue)||0;
    const steps=(value-base)/step;
    // Disabled controls bypass native constraint validation, but an export may
    // still read them after disabling its form. Enforce bounds and step here too.
    const valid=input.value.trim()!==''&&Number.isFinite(value)&&value>=min&&value<=max&&(!step||Math.abs(steps-Math.round(steps))<1e-7)&&input.checkValidity();input.setAttribute('aria-invalid',String(!valid));return valid?value:null;
}
export function setControlLabel(control,label){bindText(control,label);}
export function createGradientRow(index,selected=false){
    const row=document.createElement('div');row.className='grad-stop-row';row.dataset.gradientIndex=String(index);
    Object.assign(row.style,{display:'flex',alignItems:'center',gap:'8px',padding:'4px 6px',borderRadius:'var(--md-shape-corner-small, 8px)',backgroundColor:'var(--md-surface-container-high)',border:'1px solid '+(selected?'var(--md-primary)':'var(--md-outline-variant)'),transition:'background-color 150ms ease, border-color 150ms ease'});return row;
}
export function createColorPreview(color,size=28){
    const circle=document.createElement('div');circle.className='color-preview-circle';circle.style.width=circle.style.height=size+'px';
    const input=document.createElement('input');input.type='color';input.value=color;circle.append(input);return {circle,input};
}
export function createHexInput(color){
    const input=document.createElement('input');input.type='text';input.className='m3-text-field';input.maxLength=7;input.value=color;input.spellcheck=false;input.autocomplete='off';return input;
}
