/** Number of omitted edge pixels on a row, testing pixel centres against the arc. */
export function roundedRowInset(width,height,radius,row){
    const r=Math.max(0,Math.min(radius,width/2,height/2));
    if(!r)return 0;
    const dy=Math.max(0,r-(row+.5),row+.5-(height-r));
    return dy?Math.max(0,Math.ceil(r-Math.sqrt(Math.max(0,r*r-dy*dy))-.5-1e-9)):0;
}
