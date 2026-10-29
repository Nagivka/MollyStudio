export const LEAF_SEASONS = Object.freeze(['autumn', 'spring', 'summer', 'all']);
export function leafSeason(choice, variant) {
    return choice === 'all' ? LEAF_SEASONS[Math.abs(variant) % 3] : LEAF_SEASONS.includes(choice) ? choice : 'autumn';
}
// Preserve transparent pixels and the source's light/dark shading.
export function summerLeafPixels(data) {return recolorLeafPixels(data,'summer');}
export function springLeafPixels(data) {return recolorLeafPixels(data,'spring');}
function recolorLeafPixels(data,season) {
    for (let i=0;i<data.length;i+=4) {
        if (!data[i+3]) continue;
        const light = .2126*data[i]+.7152*data[i+1]+.0722*data[i+2];
        const palette=season==='spring'?[1.5,.65,1.05]:[.48,1.25,.32];
        for(let channel=0;channel<3;channel++)data[i+channel]=Math.min(255,Math.round(light*palette[channel]));
    }
    return data;
}
