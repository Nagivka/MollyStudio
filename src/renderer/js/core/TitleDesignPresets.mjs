import {normalizeTitleAppearance} from './TitleAppearance.mjs';
export const TITLE_DESIGNS=Object.freeze([
    {name:'Классика',texture:'stone',originalColors:true,swatch:['#BEB9AA','#77736A']},
    {name:'Золото',texture:'gold',originalColors:true,swatch:['#FFE880','#BC790E']},
    ...[
        ['Алмаз','#D8FFFF','#34C7DC','#155D83'],
        ['Изумруд','#D6FFBF','#39B765','#155037'],
        ['Незерит','#D4C5D4','#6D6172','#29212E'],
        ['Лава','#FFF589','#F25A23','#621D26','stone'],
        ['Аметист','#EEDBFF','#9562CB','#45315F'],
        ['Рубин','#FFE0DC','#CC405D','#642334'],
        ['Медь','#FFE0B6','#BE8053','#60402F'],
        ['Серебро','#F5FAFF','#A0B3C9','#455568'],
        ['Северное сияние','#BEFFE2','#5488BC','#263E68'],
        ['Сакура','#FFF1F2','#DB92B6','#6D3A58'],
        ['Океан','#B3EDFF','#337CA9','#193854'],
        ['Мёд','#FFF3B7','#E4A33E','#785023'],
        ['Обсидиан','#BAA6D0','#50415E','#221B2B'],
        ['Песчаник','#FFF3C8','#C4A36B','#6D5035'],
        ['Хвоя','#DEEDAF','#64956F','#294C3B'],
        ['Коралл','#FFE3CA','#DD8077','#75444E'],
        ['Полночь','#AFC4EB','#465E8F','#202C4A'],
        ['Феникс','#FFE9A5','#DF6940','#742C35'],
        ['Лунный камень','#FAEFFF','#A19BC9','#4E4A72'],
        ['Лайм','#F0FFC5','#99BA47','#4F642C'],
        ['Графит','#D7E0E8','#687989','#2E3945'],
        ['Фарфор','#FFFFFF','#DEE5E9','#7E8C9C']
    ].map(([name,top,bottom,side,texture='none'])=>({name,texture,originalColors:false,top,bottom,side}))
].map(Object.freeze));
export function applyTitleDesign(settings,preset){
    const {name,swatch,...fields}=preset;
    return {...settings,...fields,appearance:normalizeTitleAppearance()};
}
