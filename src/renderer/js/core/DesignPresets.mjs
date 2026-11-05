import {normalizePrefixBlock} from './PrefixDocument.mjs';

const design=(id,name,category,backgroundColors,textColor,extras={})=>Object.freeze({id,name,category,fields:{background:'gradient',backgroundColors,backgroundAngle:90,textMode:'solid',textColors:[textColor],autoShade:true,tintedBorder:true,bevel:true,borderWidth:1,radiusTopLeft:1,radiusTopRight:1,radiusBottomLeft:1,radiusBottomRight:1,paddingX:3,paddingY:2,textShadow:true,textShadowMode:'auto',textShadowDarkness:75,textShadowX:1,textShadowY:1,textShadowOpacity:100,shadow:false,...extras}});
export const PREFIX_DESIGNS=Object.freeze([
    design('gold','Королевское золото','Объёмные',['#A94E0C','#FFD85C'],'#FFF8D9'),
    design('diamond','Алмаз','Объёмные',['#087C9A','#8BF4FF'],'#EDFFFF'),
    design('emerald','Изумруд','Объёмные',['#12643E','#74DE87'],'#F1FFE4'),
    design('ruby','Рубин','Объёмные',['#78182F','#F06171'],'#FFF0E7'),
    design('amethyst','Аметист','Объёмные',['#452681','#BB8CED'],'#F8EFFF'),
    design('copper','Медь','Объёмные',['#8C472E','#E5A17A'],'#FFF2DA'),
    design('ice','Ледяной','Объёмные',['#457BB8','#D0EAF5'],'#FFFFFF'),
    design('sunset','Закат','Объёмные',['#8E3C91','#E98A50'],'#FFF0CE',{backgroundAngle:0}),
    design('obsidian','Обсидиан','Тёмные',['#17121F','#42334E'],'#D2ABFF',{borderColor:'#A17CD2',autoShade:false,highlightColor:'#78618A',bevelShadowColor:'#100D18'}),
    design('nether','Незер','Тёмные',['#251216','#6B2024'],'#FFB99A',{borderColor:'#A84839',autoShade:false,highlightColor:'#C55E45',bevelShadowColor:'#1B0D13'}),
    design('midnight','Полночь','Тёмные',['#101F32','#29415B'],'#91D8FF'),
    design('ender','Эндер','Тёмные',['#162A29','#31564C'],'#BEF5A8'),
    design('flat-blue','Синий контур','Плоские',['#152F4B'],'#B9E7FF',{background:'solid',bevel:false,autoShade:false,borderColor:'#63B4EA',paddingX:4}),
    design('flat-red','Красный контур','Плоские',['#401F28'],'#FFB5C1',{background:'solid',bevel:false,autoShade:false,borderColor:'#ED7088',paddingX:4}),
    design('parchment','Пергамент','Плоские',['#D7C49D','#EEDCB7'],'#4A3526',{bevel:false,textShadow:false,radiusTopLeft:0,radiusTopRight:0,radiusBottomLeft:0,radiusBottomRight:0}),
    design('minimal','Без рамки','Плоские',['#FFFFFF'],'#F2E9CB',{background:'none',borderWidth:0,bevel:false,textShadowMode:'solid',textShadowColor:'#352C43',paddingX:1,paddingY:1}),
    design('banner','Знамя','Фигурные',['#284273','#5B80BB'],'#F6F1DF',{radiusTopLeft:4,radiusBottomRight:4,radiusTopRight:0,radiusBottomLeft:0,paddingX:5}),
    design('capsule','Капсула','Фигурные',['#427B68','#76BD93'],'#F3FFE7',{radiusTopLeft:8,radiusTopRight:8,radiusBottomLeft:8,radiusBottomRight:8,paddingX:6}),
    design('ticket','Билет','Фигурные',['#A66321','#EAC06C'],'#FFF5DD',{radiusTopLeft:0,radiusTopRight:4,radiusBottomLeft:4,radiusBottomRight:0,paddingX:5}),
    design('steel','Сталь','Объёмные',['#454F5B','#AEB8C4'],'#FFFFFF'),
    ...[
        ['aurora','Северное сияние',['#274576','#6AD9B8'],'#EDFFF6'],
        ['sakura','Сакура',['#863F69','#EBA4BE'],'#FFF2EE'],
        ['tempest-rank','Гроза',['#30384C','#8295BC'],'#F1EFFF'],
        ['honey','Мёд',['#9D521D','#F5BF56'],'#FFF8DD'],
        ['lagoon','Лагуна',['#175267','#48BDB5'],'#E8FFFF'],
        ['molten-rank','Вулкан',['#54282D','#C95C39'],'#FFE1A4'],
        ['moon','Лунный свет',['#494772','#B6BBDD'],'#FFFFFF'],
        ['forest','Лесной страж',['#234E39','#83AD62'],'#F3F5D9'],
        ['royal','Королевский пурпур',['#4A2C67','#A461B4'],'#FFE2AC'],
        ['ocean','Морская глубина',['#152E54','#387DA5'],'#C1ECFF'],
        ['candy','Карамельное небо',['#AF5D93','#E7AECA'],'#FFF3DC'],
        ['ember','Угли',['#47282A','#9F4C3B'],'#FFC794']
    ].map(([id,name,colors,ink])=>design(id,name,'Самоцветы',colors,ink)),
    ...[
        ['neon-mint','Мятный неон','#142D2B','#81E8C8'],
        ['neon-violet','Фиолетовый неон','#2A203D','#C8A2FF'],
        ['neon-amber','Янтарный неон','#332A1C','#F4C86D'],
        ['neon-coral','Коралловый неон','#382127','#FF9EAE'],
        ['neon-blue','Голубой неон','#192B43','#8BCFFF'],
        ['neon-lime','Лаймовый неон','#27331E','#C5E68D']
    ].map(([id,name,base,ink])=>design(id,name,'Контурные',[base],ink,{background:'solid',autoShade:false,bevel:false,borderColor:ink,paddingX:4,textShadow:false})),
    ...[
        ['paper-blue','Синяя бумага','#BCD6E7','#304C68'],
        ['paper-rose','Розовая бумага','#E8C7D1','#6A3549'],
        ['paper-sage','Бумага шалфей','#C6D7BD','#3C5738'],
        ['paper-lilac','Сиреневая бумага','#D4C7E6','#503C6C'],
        ['paper-sand','Песочная бумага','#E6D7B2','#65502E'],
        ['paper-peach','Персиковая бумага','#EBCDB9','#704B38']
    ].map(([id,name,base,ink])=>design(id,name,'Бумажные',[base],ink,{background:'solid',autoShade:false,bevel:false,borderColor:ink,textShadow:false,paddingX:4,radiusTopLeft:2,radiusTopRight:2,radiusBottomLeft:2,radiusBottomRight:2}))
]);
export function applyPrefixDesign(block,id){
    const preset=PREFIX_DESIGNS.find(item=>item.id===id);if(!preset)throw Error('Неизвестное оформление префикса.');
    return normalizePrefixBlock({...block,...structuredClone(preset.fields),id:block.id,text:block.text,font:block.font});
}
export {GUI_DESIGNS,recolorGuiPixels} from './GuiDesignPresets.mjs';
