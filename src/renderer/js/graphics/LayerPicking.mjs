import {layerState} from './LayerCompositing.js';

/** Match the hierarchy used by drawLayers, including children stored after later roots. */
export function layerPaintOrder(layers) {
    const byId=new Map(layers.map(layer=>[String(layer.id),layer])),children=new Map();
    for(const layer of layers){
        const parent=byId.get(String(layer.groupId));
        const key=parent&&(parent.isGroup||parent.type==='group')?String(parent.id):null;
        if(!children.has(key))children.set(key,[]);
        children.get(key).push(layer);
    }
    const result=[],visited=new Set();
    const visit=layer=>{
        if(visited.has(layer))return;visited.add(layer);
        if(layer.isGroup||layer.type==='group')for(const child of children.get(String(layer.id))||[])visit(child);
        else result.push(layer);
    };
    for(const layer of children.get(null)||[])visit(layer);
    return result;
}

/** Pick actual painted pixels, letting transparent pixels and noneditable branches pass through. */
function* matchingLayers(layers,x,y,{canPick=()=>true}={}) {
    if(!Number.isFinite(x)||!Number.isFinite(y))return;
    const px=Math.floor(x),py=Math.floor(y),byId=new Map(layers.map(layer=>[String(layer.id),layer]));
    for(const layer of layerPaintOrder(layers).reverse()){
        if(layer.isBase||!layer.ctx||px<0||py<0||px>=layer.width||py>=layer.height)continue;
        const state=layerState(layer,byId);
        if(!state.visible||state.locked)continue;
        const context=layer.hasFX?.()?layer.getRenderCanvas().getContext('2d'):layer.ctx;
        if(context.getImageData(px,py,1,1).data[3]>0&&canPick(layer))yield layer;
    }
}

export function layersAtPoint(layers,x,y,options) { return [...matchingLayers(layers,x,y,options)]; }
export function pickLayerAt(layers,x,y,options) { for(const layer of matchingLayers(layers,x,y,options))return layer;return null; }
