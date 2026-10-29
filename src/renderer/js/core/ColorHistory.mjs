export function normalizeColorHistory(value){
    const clean=(items,limit)=>[...new Set((Array.isArray(items)?items:[]).filter(v=>typeof v==='string'&&/^#[\da-f]{6}$/i.test(v)).map(v=>v.toUpperCase()))].slice(0,limit);
    return {recent:clean(value?.recent,24),pinned:clean(value?.pinned,12)};
}
