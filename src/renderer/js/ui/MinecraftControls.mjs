export function minecraftRangeState({ min = '', max = '', step = '', value = 0 } = {}) {
    const low = min === '' ? 0 : Number(min);
    const high = max === '' ? 100 : Number(max);
    const current = Number(value);
    const fraction = Number.isFinite(current) && high > low
        ? Math.max(0, Math.min(1, (current - low) / (high - low))) : 0;
    const increment = step === '' ? 1 : Number(step);
    const intervals = (high - low) / increment;
    const stepped = Number.isFinite(intervals) && increment > 0 && intervals >= 2 && intervals <= 16
        && Math.abs(intervals - Math.round(intervals)) < 1e-6;
    return { fill: `${fraction * 100}%`, stepSize: stepped ? `${100 / Math.round(intervals)}%` : null };
}

export function minecraftIconSize(fontSize) {
    const size = Number.parseFloat(fontSize);
    return size >= 40 ? 48 : size > 0 && size < 14 ? 12 : 24;
}

const tickGradients=new Map();
/** Place each interior tick once; repeating fractional stops accumulated drift. */
export function minecraftRangeTicks(input){
    const state=minecraftRangeState(input);if(!state.stepSize)return null;
    const count=Math.round(100/Number.parseFloat(state.stepSize));
    if(!tickGradients.has(count)){
        const stops=['transparent 0%'];
        for(let index=1;index<count;index++){
            const point=100*index/count;
            stops.push(`transparent calc(${point}% - 1px)`,`var(--mc-edge) calc(${point}% - 1px)`,`var(--mc-edge) calc(${point}% + 1px)`,`transparent calc(${point}% + 1px)`);
        }
        stops.push('transparent 100%');tickGradients.set(count,`linear-gradient(to right, ${stops.join(', ')})`);
    }
    return tickGradients.get(count);
}
