import {labelHTML} from '../core/Locale.mjs';
/** Task-oriented swatches shared by all application color selectors. */
export const PaletteOptions = [
    ['minecraft', 'Minecraft — цвета чата'],
    ['accents', 'Яркие акценты'],
    ['text', 'Текст — светлый и тёмный'],
    ['backgrounds', 'Тёмные фоны GUI'],
    ['grayscale', 'Серые оттенки'],
    ['gold', 'Золото и бронза'],
    ['warm', 'Красный и оранжевый'],
    ['nature', 'Зелёный и мятный'],
    ['ocean', 'Синий и голубой'],
    ['purple', 'Фиолетовый и розовый'],
    ['earth', 'Дерево и камень']
];

// Each family has two dark-to-light rows for shading and gradient endpoints.
export const Palettes = {
    minecraft: ['#000000','#0000AA','#00AA00','#00AAAA','#AA0000','#AA00AA','#FFAA00','#AAAAAA','#555555','#5555FF','#55FF55','#55FFFF','#FF5555','#FF55FF','#FFFF55','#FFFFFF'],
    accents: ['#EF4444','#F97316','#F59E0B','#EAB308','#84CC16','#22C55E','#10B981','#14B8A6','#06B6D4','#0EA5E9','#3B82F6','#6366F1','#8B5CF6','#A855F7','#D946EF','#EC4899'],
    text: ['#FFFFFF','#F1F5F9','#FEF3C7','#FFEDD5','#FCE7F3','#EDE9FE','#DBEAFE','#D1FAE5','#111827','#1E293B','#422006','#431407','#500724','#2E1065','#172554','#052E16'],
    backgrounds: ['#0A0A0A','#111318','#171717','#1F1F1F','#0F172A','#172033','#172554','#1E1B4B','#241238','#30132A','#32161A','#302216','#20301C','#142D27','#123039','#263238'],
    grayscale: ['#000000','#111111','#222222','#333333','#444444','#555555','#666666','#777777','#888888','#999999','#AAAAAA','#BBBBBB','#CCCCCC','#DDDDDD','#EEEEEE','#FFFFFF'],
    gold: ['#3D1E0B','#5C2E12','#7A421D','#9A5B2D','#B77942','#CF9B64','#E5BD90','#F4DEC3','#422006','#713F12','#A16207','#CA8A04','#EAB308','#FACC15','#FDE047','#FEF3C7'],
    warm: ['#450A0A','#7F1D1D','#991B1B','#B91C1C','#DC2626','#EF4444','#F87171','#FECACA','#431407','#7C2D12','#9A3412','#C2410C','#EA580C','#F97316','#FB923C','#FFEDD5'],
    nature: ['#052E16','#14532D','#166534','#15803D','#16A34A','#22C55E','#86EFAC','#DCFCE7','#022C22','#064E3B','#065F46','#047857','#059669','#10B981','#6EE7B7','#D1FAE5'],
    ocean: ['#172554','#1E3A8A','#1E40AF','#1D4ED8','#2563EB','#3B82F6','#93C5FD','#DBEAFE','#083344','#164E63','#155E75','#0E7490','#0891B2','#06B6D4','#67E8F9','#CFFAFE'],
    purple: ['#2E1065','#4C1D95','#5B21B6','#6D28D9','#7C3AED','#8B5CF6','#C4B5FD','#EDE9FE','#500724','#831843','#9D174D','#BE185D','#DB2777','#EC4899','#F9A8D4','#FCE7F3'],
    earth: ['#26180F','#3D291B','#543825','#6B4931','#85603F','#A17D56','#BF9D75','#DDC6A0','#242629','#373A3E','#4D5155','#65696C','#7E8285','#989C9E','#B4B7B8','#D0D2D3']
};

export function paletteOptionsMarkup(custom = false) {
    return [...PaletteOptions,...(custom ? [['custom','Моя палитра']] : [])]
        .map(([id,label])=>`<option value="${id}">${labelHTML(label)}</option>`).join('');
}

export function populatePaletteSelect(select, {custom = false, selected = select?.value} = {}) {
    if (!select) return;
    select.innerHTML = paletteOptionsMarkup(custom);
    select.value = (selected === 'custom' && custom) || Object.hasOwn(Palettes,selected) ? selected : 'minecraft';
}
