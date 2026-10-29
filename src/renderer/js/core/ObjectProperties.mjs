/** An object's editable data determines its settings; names are user content. */
export function describeObject(layer) {
    if(!layer)return {kind:'none',label:'Объект не выбран'};
    if(layer.isBase)return {kind:'template',label:'Фон GUI'};
    if(layer.isGroup||layer.type==='group')return {kind:'group',label:'Группа'};
    if(layer.type==='text'&&layer.textData)return {kind:'text',label:'Текст'};
    const type=layer.shapeData?.type;
    const filled=layer.shapeData?.filled??type?.endsWith('-filled');
    if(['rect-filled','rect-empty'].includes(type))return {kind:'rectangle',label:'Прямоугольник',shape:true,radius:true,fill:true,filled,stroke:!filled};
    if(['circle-filled','circle-empty'].includes(type))return {kind:'ellipse',label:'Эллипс',shape:true,fill:true,filled,stroke:!filled};
    if(type==='line')return {kind:'line',label:'Линия',shape:true,stroke:true};
    return {kind:'bitmap',label:layer.objectType==='button'?'Кнопка':layer.objectType==='item'?'Предмет':'Изображение'};
}

export function isObjectLocked(layer,layers) {
    const byId=new Map(layers.map(item=>[String(item.id),item])),seen=new Set();
    for(let item=layer;item;item=byId.get(String(item.groupId))){
        if(seen.has(item)||item.locked)return true;seen.add(item);
        if(item.groupId==null)break;
    }
    return false;
}
