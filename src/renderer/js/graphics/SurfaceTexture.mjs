export const SURFACE_TEXTURES = Object.freeze([
    ['none', 'Без фактуры'], ['grain', 'Зернистость'], ['paper', 'Бумага'],
    ['stone', 'Камень'], ['stripes', 'Диагональные полосы'], ['lines', 'Горизонтальные линии'],
    ['dots', 'Точки'], ['checker', 'Шахматная сетка'], ['weave', 'Плетение']
].map(([id, name]) => Object.freeze({id, name})));
const types = new Set(SURFACE_TEXTURES.map(item => item.id));
const integer = (value, fallback, min, max) => Number.isFinite(Number(value))
    ? Math.max(min, Math.min(max, Math.round(Number(value)))) : fallback;
export function normalizeTexture(value = {}) {
    if (!value || typeof value !== 'object') value = {};
    return {type: types.has(value.type) ? value.type : 'none',
        amount: integer(value.amount, 20, 0, 100), scale: integer(value.scale, 1, 1, 16),
        seed: integer(value.seed, 1, 0, 65535)};
}
function noise(x, y, seed) {
    let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295 * 2 - 1;
}
/** Integer coordinates and a stored seed keep previews, undo and exports identical. */
export function textureSampler(value) {
    const {type, amount, scale, seed} = normalizeTexture(value);
    if (type === 'none' || !amount) return () => 0;
    return (x, y) => {
        x = Math.floor(x / scale); y = Math.floor(y / scale);
        let sample;
        switch (type) {
            case 'grain': sample = noise(x, y, seed); break;
            case 'paper': sample = .65 * noise(x, y, seed) + .35 * noise(Math.floor(x / 4), Math.floor(y / 2), seed); break;
            case 'stone': sample = .25 * noise(x, y, seed) + .75 * noise(Math.floor(x / 3), Math.floor(y / 3), seed); break;
            case 'stripes': sample = (x + y) % 4 < 2 ? .6 : -.6; break;
            case 'lines': sample = y % 3 === 0 ? -.8 : .2; break;
            case 'dots': sample = x % 3 === 0 && y % 3 === 0 ? -1 : .125; break;
            case 'checker': sample = (x + y) % 2 ? .5 : -.5; break;
            case 'weave': sample = (x % 4 < 2) === (y % 4 < 2) ? .5 : -.5; break;
            default: sample = 0;
        }
        return Math.round(sample * amount * .85);
    };
}
/** Changes luminance only. Transparent pixels and alpha remain untouched. */
export function applySurfaceTexture(image, settings, include = null) {
    const texture=normalizeTexture(settings);
    if(texture.type==='none'||!texture.amount)return image;
    const sample = textureSampler(texture), {data, width, height} = image;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (!data[i + 3] || (include && !include(x, y))) continue;
        const delta = sample(x, y);
        for (let c = 0; c < 3; c++) data[i + c] += delta;
    }
    return image;
}
