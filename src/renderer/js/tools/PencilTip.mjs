/** Test pixel centres against the requested diameter, not diameter minus one. */
export function pencilTipContains(size,x,y){
    if(x<0||y<0||x>=size||y>=size)return false;
    const centre=(size-1)/2;
    return (x-centre)**2+(y-centre)**2<=(size/2)**2;
}
