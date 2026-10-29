const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
/** Keep the editable recipe's unit square aligned with transformed master pixels. */
export function inheritButtonSource(source,canvas,context,draw=[1,0,0,1,0,0]){
    if(!source.buttonSourceMap||!context.getTransform)return;
    const t=context.getTransform(),mapping=source.buttonSourceMap.matrix;
    canvas.buttonSourceMap={width:canvas.width,height:canvas.height,matrix:multiply(multiply([t.a,t.b,t.c,t.d,t.e,t.f],draw),mapping)};
}
