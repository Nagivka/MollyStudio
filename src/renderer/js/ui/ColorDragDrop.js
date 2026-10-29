const SOURCES = '.swatch-btn, .color-square-slot, .shading-ramp-slot, .mini-swatch';
const ROWS = '.grad-stop-row, .utility-color, .prefix-color-row, .color-picker-box';

export function normalizeDraggedColor(value) {
    const text=String(value||'').trim();
    if(/^#[\da-f]{6}$/i.test(text))return text.toUpperCase();
    const match=text.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*1)?\s*\)$/);
    return match&&match.slice(1).every(n=>Number(n)<=255)?'#'+match.slice(1).map(n=>Number(n).toString(16).padStart(2,'0')).join('').toUpperCase():null;
}

/** Native input events keep every editor's model, preview and undo flow intact. */
export function installColorDragDrop(root=document) {
    if(root.__mollyColorDragDrop)return;
    root.__mollyColorDragDrop=true;
    const enable=scope=>{if(scope.matches?.(SOURCES))scope.draggable=true;scope.querySelectorAll?.(SOURCES).forEach(node=>{node.draggable=true;});};
    enable(root);
    new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>enable(node)))).observe(root.documentElement,{childList:true,subtree:true});
    let hover=null;
    const clear=()=>{hover?.classList.remove('color-drop-target');hover=null;};
    const target=event=>{
        const node=event.target?.closest?.(`${ROWS}, input[type="color"]`);
        const row=node?.closest(ROWS);
        const input=row?.querySelector('input[type="text"],input:not([type])')||(node?.matches('input[type="color"]')?node:node?.querySelector('input[type="color"]'));
        return input&&!input.disabled?{input,element:input.closest(ROWS)||input}:null;
    };
    root.addEventListener('dragstart',event=>{
        const swatch=event.target.closest?.(SOURCES);if(!swatch)return;
        const color=normalizeDraggedColor(swatch.dataset.prefixSwatch||swatch.dataset.paletteColor||swatch.style.backgroundColor);
        if(!color)return;
        event.dataTransfer.setData('application/x-molly-color',color);
        event.dataTransfer.setData('text/plain',color);
        event.dataTransfer.effectAllowed='copy';
    },true);
    root.addEventListener('dragover',event=>{
        const drop=target(event),types=[...(event.dataTransfer?.types||[])];
        if(!drop||types.includes('Files')||!types.some(type=>['application/x-molly-color','text/plain'].includes(type)))return;
        event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';
        if(hover!==drop.element){clear();hover=drop.element;hover.classList.add('color-drop-target');}
    },true);
    root.addEventListener('dragleave',event=>{if(hover&&!hover.contains(event.relatedTarget))clear();},true);
    root.addEventListener('dragend',clear,true);
    root.addEventListener('drop',event=>{
        const drop=target(event),color=normalizeDraggedColor(event.dataTransfer?.getData('application/x-molly-color')||event.dataTransfer?.getData('text/plain'));
        clear();if(!drop||!color)return;
        event.preventDefault();event.stopImmediatePropagation();
        drop.input.value=color;
        drop.input.dispatchEvent(new Event('input',{bubbles:true}));
        drop.input.dispatchEvent(new Event('change',{bubbles:true}));
    },true);
}
