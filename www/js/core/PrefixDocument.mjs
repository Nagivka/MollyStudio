export const PREFIX_LIMITS = Object.freeze({ blocks: 8, text: 64, colors: 8, dimension: 4096 });
export const PREFIX_PRESETS = Object.freeze({
    gold: { name: 'Золото', colors: ['#B85C16', '#FFD65C'], text: '#FFF4CC', border: '#66351A' },
    ocean: { name: 'Океан', colors: ['#1557A8', '#38D6E8'], text: '#E9FFFF', border: '#103A67' },
    forest: { name: 'Изумруд', colors: ['#12694D', '#8AD66D'], text: '#F0FFDA', border: '#164832' },
    ruby: { name: 'Рубин', colors: ['#941E47', '#F96F76'], text: '#FFF1E9', border: '#54182E' },
    violet: { name: 'Аметист', colors: ['#5537A8', '#C798F7'], text: '#FFF0FF', border: '#34205E' },
    slate: { name: 'Графит', colors: ['#303944', '#66778C'], text: '#FFFFFF', border: '#18212C' }
});
const color = (value, fallback) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value.toUpperCase() : fallback;
const integer = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Math.round(Number(value)))) : fallback;
const choice = (value, values, fallback) => values.includes(value) ? value : fallback;
const colors = (value, fallback) => Array.isArray(value) && value.length ? value.slice(0, PREFIX_LIMITS.colors).map((item, index) => color(item, fallback[index % fallback.length])) : [...fallback];

export function normalizePrefixBlock(value = {}, index = 0) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
    const preset = PREFIX_PRESETS.gold;
    return {
        id: typeof value.id === 'string' && /^[\w-]{1,80}$/.test(value.id) ? value.id : `block-${index + 1}`,
        text: String(value.text ?? 'VIP').replace(/[\r\n\t\u0000-\u001F]/g, ' ').slice(0, PREFIX_LIMITS.text),
        font: choice(value.font, ['minecraft', 'smallcaps', 'minecraft-ten'], 'smallcaps'),
        icon: choice(value.icon, ['none', 'crown', 'star', 'heart', 'bolt', 'shield', 'check'], 'none'),
        iconSide: choice(value.iconSide, ['left', 'right'], 'left'),
        textMode: choice(value.textMode, ['solid', 'gradient'], 'solid'),
        textColors: colors(value.textColors, [preset.text, '#FFFFFF']),
        textAngle: integer(value.textAngle, 0, 0, 360),
        background: choice(value.background, ['solid', 'gradient', 'none'], 'gradient'),
        backgroundColors: colors(value.backgroundColors, preset.colors),
        backgroundAngle: integer(value.backgroundAngle, 90, 0, 360),
        paddingX: integer(value.paddingX, 3, 0, 32), paddingY: integer(value.paddingY, 2, 0, 16),
        letterSpacing: integer(value.letterSpacing, 0, 0, 8),
        radius: integer(value.radius, 1, 0, 12),
        borderWidth: integer(value.borderWidth, 1, 0, 4), borderColor: color(value.borderColor, preset.border),
        bevel: value.bevel !== false,
        textShadow: value.textShadow !== false, textShadowColor: color(value.textShadowColor, '#392511'),
        shadow: value.shadow === true, shadowColor: color(value.shadowColor, '#000000'),
        shadowX: integer(value.shadowX, 1, -8, 8), shadowY: integer(value.shadowY, 1, -8, 8),
        shadowOpacity: integer(value.shadowOpacity, 50, 0, 100)
    };
}

export function normalizePrefixDocument(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
    const blocks = (Array.isArray(value.blocks) && value.blocks.length ? value.blocks : [{}]).slice(0, PREFIX_LIMITS.blocks).map(normalizePrefixBlock);
    const ids = new Set();
    blocks.forEach((block, index) => {
        if (ids.has(block.id)) block.id = `block-${index}-${blocks.length}`;
        while (ids.has(block.id)) block.id += '-copy';
        ids.add(block.id);
    });
    return { version: 1, gap: integer(value.gap, 1, 0, 16), margin: integer(value.margin, 0, 0, 16), blocks };
}

export function applyPrefixPreset(block, presetId) {
    const preset = PREFIX_PRESETS[presetId];
    if (!preset) return normalizePrefixBlock(block);
    return normalizePrefixBlock({ ...block, background: 'gradient', backgroundColors: preset.colors,
        textColors: [preset.text, '#FFFFFF'], borderColor: preset.border, textShadowColor: preset.border });
}

export function validatePrefixDocument(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.blocks) || value.blocks.length < 1 || value.blocks.length > PREFIX_LIMITS.blocks) {
        throw new Error('Некорректный проект префиксов: поддерживается от 1 до 8 блоков, версия формата 1.');
    }
    for (const block of value.blocks) {
        if (!block || typeof block.text !== 'string' || block.text.length > PREFIX_LIMITS.text) throw new Error('Текст блока префикса превышает 64 символа.');
    }
    return normalizePrefixDocument(value);
}
