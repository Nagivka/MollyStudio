import { pixelAliases, pixelDrawings } from './PixelIconData.mjs';

// Pixelarticons 2.4.2 (MIT), curated locally. No font ligatures or remote assets.
export const minecraftIconNames = Object.freeze(Object.keys(pixelAliases));
const cache = new Map();
export function minecraftIcon(name) {
    const glyph = pixelAliases[String(name ?? '').trim()];
    if (!glyph || !pixelDrawings[glyph]) return null;
    if (!cache.has(glyph)) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" shape-rendering="crispEdges"><g fill="white">${pixelDrawings[glyph]}</g></svg>`;
        cache.set(glyph, Object.freeze({ glyph, grid: 24, svg, mask: `url("data:image/svg+xml,${encodeURIComponent(svg)}")` }));
    }
    return cache.get(glyph);
}
