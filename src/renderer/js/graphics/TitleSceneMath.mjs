export const add=(a,b)=>a.map((n,i)=>n+b[i]);
export const subtract=(a,b)=>a.map((n,i)=>n-b[i]);
export const dot=(a,b)=>a.reduce((sum,n,i)=>sum+n*b[i],0);
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const unit=a=>{const length=Math.hypot(...a);return length?a.map(n=>n/length):[0,0,0];};
export function rotatePoint(point,rotation){
    let [x,y,z]=point;
    for(let axis=0;axis<3;axis++){
        const angle=rotation[axis]*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
        if(axis===0)[y,z]=[y*c-z*s,y*s+z*c];
        if(axis===1)[x,z]=[x*c+z*s,-x*s+z*c];
        if(axis===2)[x,y]=[x*c-y*s,x*s+y*c];
    }
    return [x,y,z];
}
export function applyObjectTransform(point,pivot,transform){
    if(!transform)return point;
    const local=subtract(point,pivot).map((n,i)=>n*transform.scale[i]);
    return add(add(rotatePoint(local,transform.rotation),pivot),transform.position);
}
export const emptyBounds=()=>({min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]});
export function expandBounds(bounds,point){for(let axis=0;axis<3;axis++){bounds.min[axis]=Math.min(bounds.min[axis],point[axis]);bounds.max[axis]=Math.max(bounds.max[axis],point[axis]);}}
export const boundsCenter=bounds=>bounds.min.map((n,i)=>(n+bounds.max[i])/2);
export const boundsCorners=bounds=>[0,1,2,3,4,5,6,7].map(index=>[0,1,2].map(axis=>(index&(1<<axis))?bounds.max[axis]:bounds.min[axis]));

/** Returns the barycentric UV weights for a front-facing ray/triangle hit. */
export function intersectTriangle(origin,direction,a,b,c){
    const first=subtract(b,a),second=subtract(c,a),p=cross(direction,second),det=dot(first,p);
    if(det<1e-8)return null;
    const tvec=subtract(origin,a),u=dot(tvec,p)/det;if(u<0||u>1)return null;
    const q=cross(tvec,first),v=dot(direction,q)/det;if(v<0||u+v>1)return null;
    const distance=dot(second,q)/det;
    return distance>=0?{distance,weights:[1-u-v,u,v]}:null;
}

export function inverseRotatePoint(point,rotation){
    let [x,y,z]=point;
    for(let axis=2;axis>=0;axis--){
        const angle=-rotation[axis]*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
        if(axis===0)[y,z]=[y*c-z*s,y*s+z*c];
        if(axis===1)[x,z]=[x*c+z*s,-x*s+z*c];
        if(axis===2)[x,y]=[x*c-y*s,x*s+y*c];
    }
    return [x,y,z];
}
