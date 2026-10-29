// Standalone utilities: pure transformations shared by the launcher and editor.
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const CAPS = Array.from('ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀsᴛᴜᴠᴡxʏᴢ');
const FORWARD = Object.fromEntries([...LETTERS].map((letter, i) => [letter, CAPS[i]]));
const BACKWARD = Object.fromEntries(CAPS.map((letter, i) => [letter, LETTERS[i]]));
const RUSSIAN = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
// Source verified against the user's reference generator. Some Cyrillic letters
// intentionally stay lowercase, while Ё shares the same glyph as Е.
const RUSSIAN_CAPS = Array.from('ᴀбʙгдᴇᴇжзийᴋлᴍʜᴏпᴘᴄтуȹxцчшщъыьэюя');
const RU_FORWARD = Object.fromEntries([...RUSSIAN].map((letter, i) => [letter, RUSSIAN_CAPS[i]]));
const RU_BACKWARD = Object.fromEntries(RUSSIAN_CAPS.map((letter, i) => [letter, RUSSIAN[i]]));
const TRANSLIT = Object.fromEntries(Object.entries({а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'}));
const segmenter = new Intl.Segmenter('ru', { granularity: 'grapheme' });
export const graphemes = text => [...segmenter.segment(String(text))].map(item => item.segment);
export const UTILITY_TEXT_LIMIT = 4096;

export function smallCaps(text, { reverse = false, transliterate = false, language = 'all' } = {}) {
    const source = String(text);
    const useRussian = language !== 'en';
    const useEnglish = language !== 'ru' || transliterate;
    if (reverse) {
        return source.replace(/[\p{L}\p{M}]+/gu, word => {
            const russian = useRussian && (language === 'ru' || /[А-Яа-яЁё]/u.test(word));
            return Array.from(word).map(char => russian ? RU_BACKWARD[char] ?? char : useEnglish ? BACKWARD[char] ?? char : char).join('');
        });
    }
    return Array.from(source).map(char => {
        const lower = char.toLowerCase();
        if (transliterate && useRussian && Object.hasOwn(TRANSLIT, lower)) return [...TRANSLIT[lower]].map(letter => FORWARD[letter] ?? letter).join('');
        if (useRussian && Object.hasOwn(RU_FORWARD, lower)) return RU_FORWARD[lower];
        return useEnglish ? FORWARD[lower] ?? char : char;
    }).join('');
}

export function normalizeColors(colors) {
    const valid = (Array.isArray(colors) ? colors : []).filter(color => /^#[\da-f]{6}$/i.test(color)).slice(0, 8);
    return valid.length ? valid.map(color => color.toUpperCase()) : ['#55CCFF', '#AA66FF'];
}

export function gradientCharacters(text, colors, { skipSpaces = false } = {}) {
    // Cap output without cutting a surrogate pair or a combining sequence in half.
    const chars = [];
    let length = 0;
    for (const part of segmenter.segment(String(text))) {
        if (length + part.segment.length > UTILITY_TEXT_LIMIT) break;
        chars.push(part.segment); length += part.segment.length;
    }
    const stops = normalizeColors(colors).map(color => [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16)));
    const count = chars.filter(char => !skipSpaces || !/^\s+$/u.test(char)).length;
    let index = 0;
    return chars.map(char => {
        if (skipSpaces && /^\s+$/u.test(char)) return { text: char, color: null };
        const position = count <= 1 ? 0 : index++ / (count - 1) * (stops.length - 1);
        const start = Math.min(Math.floor(position), stops.length - 1), end = Math.min(start + 1, stops.length - 1);
        const fraction = position - start;
        const color = '#' + stops[start].map((channel, i) => Math.round(channel + (stops[end][i] - channel) * fraction).toString(16).padStart(2, '0')).join('').toUpperCase();
        return { text: char, color };
    });
}

const STYLE_KEYS = ['bold', 'italic', 'underlined', 'strikethrough'];
const STYLE_CODES = ['l', 'o', 'n', 'm'];
export function textComponent(text, colors, options = {}) {
    const styles = Object.fromEntries(STYLE_KEYS.map(key => [key, Boolean(options[key])]));
    const extra = gradientCharacters(text, colors, options).map(char => ({ text: char.text, ...(char.color ? { color: char.color } : {}) }));
    return { text: '', ...styles, ...(extra.length ? { extra } : {}) };
}

export function formatGradient(text, colors, format = 'minimessage', options = {}) {
    if (format === 'json') return JSON.stringify(textComponent(text, colors, options));
    const chars = gradientCharacters(text, colors, options);
    if (format === 'minimessage') {
        const tags = STYLE_KEYS.filter(key => options[key]);
        const escape = value => value.replace(/\\/g, '\\\\').replace(/</g, '\\<');
        return tags.map(key => `<${key}>`).join('') + chars.map(char => char.color ? `<${char.color}>${escape(char.text)}</${char.color}>` : escape(char.text)).join('') + tags.reverse().map(key => `</${key}>`).join('');
    }
    const marker = format === 'section' ? '§' : '&';
    const styles = STYLE_CODES.filter((_, i) => options[STYLE_KEYS[i]]).map(code => marker + code).join('');
    return chars.map(char => {
        if (!char.color) return char.text;
        const color = format === 'hex' ? '&' + char.color : marker + 'x' + [...char.color.slice(1)].map(digit => marker + digit).join('');
        return color + styles + char.text;
    }).join('') + (chars.length ? marker + 'r' : '');
}
