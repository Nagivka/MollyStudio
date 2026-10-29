const usesDefaultSigns = fontId => fontId === 'square' || fontId === 'smallcaps';

/** Square uses its own signs; SmallCaps and missing Square signs use Default. */
export function resolveBitmapGlyph(character,fontId) {
    const sign=/^[\p{P}\p{S}]$/u.test(character);
    if(fontId==='smallcaps'&&sign)return {fontId:'minecraft',index:fontMaps.minecraft.indexOf(character)};
    let index=fontMaps[fontId]?.indexOf(character)??-1;
    if(index>=0)return {fontId,index};
    if(fontId==='square'&&sign)return {fontId:'minecraft',index:fontMaps.minecraft.indexOf(character)};
    index=fontMaps['minecraft-ten'].indexOf(character);
    return {fontId:'minecraft-ten',index};
}

export const fontMaps = {
    'square':
        " !\"#$%&'()*+,-./" +
        "0123456789:;<=>?" +
        "@ABCDEFGHIJKLMNO" +
        "PQRSTUVWXYZ[\\]^_" +
        "`{|}~АБВГДЕЖЗИКЛ" +
        "МНОПРСТУФХЦЧШЩЪЫ" +
        "ЬЭЮЯЁЙ          " +
        "«»              ",
    'minecraft': 
        " !\"#$%&'()*+,-./" +
        "0123456789:;<=>?" +
        "@ABCDEFGHIJKLMNO" +
        "PQRSTUVWXYZ[\\]^_" +
        " abcdefghijklmno" +
        "pqrstuvwxyz{|}~ " +
        "«»    АБВГДЕЖЗИК" +
        "ЛМНОПРСТУФХЦЧШЩЪ" +
        "ЫЬЭЮЯабвгдежзикл" +
        "мнопрстуфхцчшщъы" +
        "ьэюяёй          ",

    'minecraft-ten':
        " !\"#$%&'()*+,-./" +
        "0123456789:;<=>?" +
        "@ABCDEFGHIJKLMNO" +
        "PQRSTUVWXYZ[\\]^_" +
        "`abcdefghijklmno" +
        "pqrstuvwxyz{|}~ " +
        "      АБВГДЕЖЗИК" +
        "ЛМНОПРСТУФХЦЧШЩЪ" +
        "ЫЬЭЮЯабвгдежзикл" +
        "мнопрстуфхцчшщъы" +
        "ьэюяйё          ",

    'smallcaps': 
        "0123456789      " +
        "@ABCDEFGHIJKLMNO" +
        "PQRSTUVWXYZ     " +
        " abcdefghijklmno" +
        "pqrstuvwxyz     " +
        "      бвгдежзикл" +
        "мнопрстуфхцчшщъы" +
        "ьэюяёй          "
};

export const fontReplacements = {
    '«': '"',
    '»': '"',
    '“': '"',
    '”': '"',
    '„': '"',
    '—': '-',
    '–': '-',
    '−': '-',
    '№': '#',
    '…': '...'
};

export function normalizeBitmapText(text, fontId, limit = 4096) {
    let result = String(text ?? '').slice(0, limit).replace(/[\uFE0E\uFE0F]/g,'');
    if (fontId === 'square') result = result.replace(/[a-zа-яё]/g, character => character.toUpperCase());
    for (const [from, to] of Object.entries(fontReplacements)) {
        if (!fontMaps[fontId]?.includes(from)&&!(usesDefaultSigns(fontId)&&fontMaps.minecraft.includes(from))) result = result.split(from).join(to);
    }
    if (fontId === 'minecraft') return result.replace(/Ё/g, 'Е').replace(/Й/g, 'И');
    if (fontId === 'smallcaps') return result.replace(/[А-ЯЁ]/g, character => character.toLowerCase()).replace(/а/g, 'a');
    return result;
}

/** Latin small caps and digits in the bundled atlas end one row above Cyrillic. */
export function bitmapGlyphOffsetY(fontId, character) {
    return fontId === 'smallcaps' && /^[A-Za-z0-9]$/.test(character) ? 1 : 0;
}
