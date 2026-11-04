import {currentPlatform,shortcutLabel} from './Platform.mjs';
const entry=(id,label,category,key,...aliases)=>Object.freeze({id,label,category,keys:[key,...aliases]});
export const SHORTCUT_COMMANDS=Object.freeze([
    entry('file-new','Новый проект','Файл','Ctrl+KeyN'),entry('file-open','Открыть проект','Файл','Ctrl+KeyO'),
    entry('file-save','Сохранить','Файл','Ctrl+KeyS'),entry('file-save-as','Сохранить как','Файл','Ctrl+Shift+KeyS'),
    entry('file-export-png','Экспорт','Файл','Ctrl+Shift+KeyE'),entry('file-home','Главное меню','Файл','Home'),
    entry('edit-undo','Отменить','Правка','Ctrl+KeyZ'),entry('edit-redo','Повторить','Правка','Ctrl+KeyY','Ctrl+Shift+KeyZ'),
    entry('select-copy','Копировать выделение','Выделение','Ctrl+KeyC'),entry('select-cut','Вырезать выделение','Выделение','Ctrl+KeyX'),
    entry('select-paste','Вставить','Выделение','Ctrl+KeyV'),entry('select-all','Выделить всё','Выделение','Ctrl+KeyA'),
    entry('select-deselect','Снять выделение','Выделение','Ctrl+KeyD'),entry('select-invert','Инвертировать выделение','Выделение','Ctrl+Shift+KeyI'),
    entry('layer-new','Новый слой','Слои','Ctrl+Shift+KeyN'),entry('layer-duplicate','Дублировать слой','Слои','Ctrl+KeyJ'),
    entry('layer-mergedown','Объединить со слоем ниже','Слои','Ctrl+KeyE'),entry('layer-isolate','Изолировать слой или группу','Слои',''),
    entry('transform-invert','Инвертировать цвета','Правка','Ctrl+KeyI'),entry('image-canvas-size','Размер холста','Изображение','Ctrl+Alt+KeyC'),
    entry('view-grid','Пиксельная сетка','Вид','Ctrl+Quote'),entry('view-guides','Направляющие','Вид','Ctrl+Semicolon'),
    entry('view-rulers','Линейки','Вид','Ctrl+KeyR'),entry('view-tiling','Бесшовный тайлинг','Вид','KeyW'),
    entry('image-load-ref','Загрузить подложку','Изображение','Ctrl+Shift+KeyR'),
    entry('view-zoom-fit','Вписать холст','Вид','KeyF'),entry('view-zoom-reset','Масштаб 100%','Вид','Ctrl+Digit0','Ctrl+Numpad0'),
    entry('view-zoom-in','Увеличить масштаб','Вид','Ctrl+Equal','Ctrl+NumpadAdd'),entry('view-zoom-out','Уменьшить масштаб','Вид','Ctrl+Minus','Ctrl+NumpadSubtract'),
    entry('settings-open','Настройки программы','Окно','Ctrl+Comma'),entry('tools-button-generator','Генератор кнопок','Инструменты','Ctrl+Shift+KeyB'),
    entry('color-swap','Поменять основной и фоновый цвета','Цвет','KeyX'),entry('color-default','Чёрный и белый цвета','Цвет','KeyD'),
    entry('color-replace','Замена цвета','Цвет','Shift+KeyR'),entry('symmetry-x','Зеркальная симметрия X','Рисование','Shift+KeyX'),entry('symmetry-y','Зеркальная симметрия Y','Рисование','Shift+KeyY'),
    entry('brush-smaller','Уменьшить кисть','Рисование','BracketLeft'),entry('brush-larger','Увеличить кисть','Рисование','BracketRight'),
    entry('color-darker','Оттенок темнее','Цвет','Shift+BracketLeft'),entry('color-lighter','Оттенок светлее','Цвет','Shift+BracketRight'),
    ...[['move','Перемещение','KeyV','KeyK'],['marquee','Выделение','KeyM'],['brush','Кисть','KeyB'],['pencil','Карандаш','KeyP'],
        ['eraser','Ластик','KeyE'],['bucket','Заливка','KeyG'],['gradient','Градиент','Shift+KeyG'],['pipette','Пипетка','KeyI'],
        ['line','Линия','KeyL'],['lasso','Лассо','Shift+KeyL'],['wand','Волшебная палочка','Shift+KeyW'],['text','Текст','KeyT'],['hand','Панорамирование','KeyH'],['rect-empty','Контур прямоугольника','KeyU'],
        ['rect-filled','Залитый прямоугольник','Shift+KeyU'],['circle-empty','Контур эллипса','KeyO','KeyC'],
        ['circle-filled','Залитый эллипс','Shift+KeyO','Shift+KeyC']].map(([id,label,...keys])=>entry(`tool:${id}`,label,'Инструменты',...keys))
]);
const modifiers=['Ctrl','Alt','Shift','Meta'];
const keyPattern=/^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Comma|Period|Quote|Semicolon|BracketLeft|BracketRight|Backslash|Slash|Minus|Equal|Backquote|Home|End|PageUp|PageDown|Insert|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal))$/;
export function normalizeChord(value){
    if(value==='')return '';
    if(typeof value!=='string'||value.length>70)return null;
    const parts=value.split('+'),key=parts.pop();
    if(!keyPattern.test(key)||new Set(parts).size!==parts.length||parts.some(part=>!modifiers.includes(part)))return null;
    const chord=[...modifiers.filter(part=>parts.includes(part)),key].join('+');
    return ['Alt+F4','Ctrl+Alt+F4'].includes(chord)?null:chord;
}
export function eventChord(event,platform=currentPlatform()){
    const mac=platform==='darwin';
    return normalizeChord([...((mac?event.metaKey:event.ctrlKey)?['Ctrl']:[]),...(event.altKey?['Alt']:[]),...(event.shiftKey?['Shift']:[]),...((mac?event.ctrlKey:event.metaKey)?['Meta']:[]),event.code].join('+'));
}
export function shortcutKeys(command,overrides={}){return Object.hasOwn(overrides,command.id)?(overrides[command.id]?[overrides[command.id]]:[]):command.keys.filter(Boolean);}
export function normalizeShortcutBindings(value){
    const result={};
    if(!value||typeof value!=='object'||Array.isArray(value))return result;
    for(const command of SHORTCUT_COMMANDS)if(Object.hasOwn(value,command.id)){
        const chord=normalizeChord(value[command.id]);if(chord!==null)result[command.id]=chord;
    }
    const used=new Set(SHORTCUT_COMMANDS.filter(command=>!Object.hasOwn(result,command.id)).flatMap(command=>command.keys.filter(Boolean)));
    for(const command of SHORTCUT_COMMANDS)if(result[command.id]){
        if(used.has(result[command.id]))result[command.id]='';else used.add(result[command.id]);
    }
    return result;
}
export function shortcutConflict(id,chord,overrides={}){
    return SHORTCUT_COMMANDS.find(command=>command.id!==id&&shortcutKeys(command,overrides).includes(chord))||null;
}
export function displayChord(chord,platform=currentPlatform()){
    if(!chord)return 'Не назначено';
    const label=chord.replace(/Key([A-Z])/g,'$1').replace(/Digit([0-9])/g,'$1').replace('Comma',',').replace('Period','.').replace('Quote',"'").replace('Semicolon',';').replace('Equal','=').replace('Minus','−').replace('BracketLeft','[').replace('BracketRight',']');
    return shortcutLabel(label,platform).replace('Meta',platform==='darwin'?'Ctrl':platform==='linux'?'Super':'Win');
}
