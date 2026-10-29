/** Equal gaps between aligned neighbours. Candidate pairs are bounded per axis. */
export function equalGapSnap(box, references, threshold) {
    const result = {x: box.x, y: box.y, guides: []};
    for (const axis of ['x','y']) {
        const size = axis === 'x' ? 'w' : 'h', cross = axis === 'x' ? 'y' : 'x', crossSize = axis === 'x' ? 'h' : 'w';
        const aligned = references.filter(item => item[size] > 0 &&
            Math.min(box[cross]+box[crossSize], item[cross]+item[crossSize]) > Math.max(box[cross], item[cross]));
        const candidates = [...aligned]
            .sort((a,b) => Math.abs(a[axis]-box[axis])-Math.abs(b[axis]-box[axis])).slice(0,24)
            .sort((a,b) => a[axis]-b[axis]);
        let best = null;
        const consider = (position, segments) => {
            if (!Number.isFinite(position) || Math.abs(position-Math.round(position))>1e-6) return;
            const difference = Math.abs(position-box[axis]);
            if (difference > threshold || aligned.some(item => position < item[axis]+item[size] && position+box[size] > item[axis])) return;
            if (difference <= threshold && (!best || difference < best.difference)) best = {position,difference,segments};
        };
        for (let i=0;i<candidates.length-1;i++) {
            const a=candidates[i], b=candidates[i+1], endA=a[axis]+a[size], endB=b[axis]+b[size], gap=b[axis]-endA;
            if(gap<0)continue;
            const between=(endA+b[axis]-box[size])/2;
            if(gap>=box[size])consider(between,[[endA,between],[between+box[size],b[axis]]]);
            consider(endB+gap,[[endA,b[axis]],[endB,endB+gap]]);
            consider(a[axis]-gap-box[size],[[a[axis]-gap,a[axis]],[endA,b[axis]]]);
        }
        if(best){
            result[axis]=best.position;
            for(const [from,to] of best.segments) if(to>from)result.guides.push({axis,from,to,at:box[cross]+box[crossSize]/2,distance:to-from});
        }
    }
    return result;
}
