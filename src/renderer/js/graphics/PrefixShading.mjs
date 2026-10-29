import ButtonRenderer from './ButtonRenderer.js';

// Reuse the button generator's color math so both editors produce the same shades.
const calculator = new ButtonRenderer();
const rgb = hex => calculator.hexToRgb(hex);
const hex = channels => calculator.rgbToHex(...channels);

export function prefixGradientPosition(angle, x, y, width, height) {
    const radians = angle * Math.PI / 180, dx = Math.cos(radians), dy = Math.sin(radians);
    const extent = Math.abs(dx) * (width - 1) + Math.abs(dy) * (height - 1);
    return extent < 1e-8 ? 0 : Math.max(0, Math.min(1, .5 + ((x - (width - 1) / 2) * dx + (y - (height - 1) / 2) * dy) / extent));
}

/** Compile coordinates and HEX stops once for a rendered block. */
export function prefixPositionSampler(angle, width, height) {
    const radians=angle*Math.PI/180,dx=Math.cos(radians),dy=Math.sin(radians);
    const extent=Math.abs(dx)*(width-1)+Math.abs(dy)*(height-1);
    const cx=(width-1)/2,cy=(height-1)/2;
    return extent<1e-8?()=>0:(x,y)=>Math.max(0,Math.min(1,.5+((x-cx)*dx+(y-cy)*dy)/extent));
}

export function prefixColorSampler(colors, angle, width, height) {
    const stops=colors.map(rgb),position=prefixPositionSampler(angle,width,height);
    if(stops.length===1)return ()=>stops[0];
    return (x,y)=>{
        const scaled=position(x,y)*(stops.length-1),index=Math.min(stops.length-2,Math.floor(scaled));
        const a=stops[index],b=stops[index+1],t=scaled-index;
        return [0,1,2].map(channel=>Math.round(a[channel]+(b[channel]-a[channel])*t));
    };
}

/** Auto shadows sample the backdrop at their destination, not the text gradient. */
export function prefixTextShadowRamp(block) {
    if (block.textShadowMode === 'solid') return [rgb(block.textShadowColor)];
    const automatic = block.textShadowMode === 'auto';
    const colors = automatic
        ? block.background === 'none' ? block.textMode === 'gradient' ? block.textColors : [block.textColors[0]]
            : block.background === 'gradient' ? block.backgroundColors : [block.backgroundColors[0]]
        : block.textShadowColors;
    const factor = automatic ? 1 - block.textShadowDarkness / 100 : 1;
    return Array.from({ length: colors.length === 1 ? 1 : 256 }, (_, index) => samplePrefixColor(colors, index / 255).map(value => Math.round(value * factor)));
}

export function prefixTextShadowPreview(block) {
    const ramp = prefixTextShadowRamp(block);
    return [ramp[0], ramp[Math.floor((ramp.length - 1) / 2)], ramp.at(-1)].map(hex);
}

export function samplePrefixColor(colors, position) {
    if (colors.length === 1) return rgb(colors[0]);
    const scaled = Math.max(0, Math.min(1, position)) * (colors.length - 1);
    const index = Math.min(colors.length - 2, Math.floor(scaled));
    const a = rgb(colors[index]), b = rgb(colors[index + 1]);
    return a.map((value, channel) => Math.round(value + (b[channel] - value) * (scaled - index)));
}

export function prefixShades(block, surface) {
    if (block.autoShade && block.background !== 'none') {
        return calculator.calculateMinecraftShadesRgb(...surface,block.tintedBorder);
    }
    return {
        surface,
        border: rgb(block.borderColor),
        // Null retains the original renderer's per-pixel shading in older projects.
        highlight: block.highlightColor ? rgb(block.highlightColor) : surface.map(value => Math.round(value + (255 - value) * .28)),
        shadow: block.bevelShadowColor ? rgb(block.bevelShadowColor) : surface.map(value => Math.round(value * .72))
    };
}

export function prefixShadePreview(block) {
    const colors = block.background === 'gradient' ? block.backgroundColors : [block.backgroundColors[0]];
    return Object.fromEntries(Object.entries(prefixShades(block, samplePrefixColor(colors, .5))).map(([key, color]) => [key, hex(color)]));
}

export function prefixShadeRamp(block) {
    const colors = block.background === 'gradient' ? block.backgroundColors : [block.backgroundColors[0]];
    return Array.from({ length: colors.length === 1 ? 1 : 256 }, (_, index) => prefixShades(block, samplePrefixColor(colors, index / 255)));
}
