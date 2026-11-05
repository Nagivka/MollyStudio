import {boundsCorners,boundsCenter,subtract} from './TitleSceneMath.mjs';

/** Fit visible objects without changing lens or the shared export camera distance. */
export function fitTitleEditingCamera(data,scene,width,height){
    const cameraTarget=boundsCenter(scene.bounds),plan=titleEditingPlan(scene.bounds,scene.baseBounds,{...data,zoom:100,cameraTarget},Math.max(1,width),Math.max(1,height));
    let extent=.01;
    for(const point of boundsCorners(scene.bounds)){
        const [x,y,z]=turnTitlePoint(subtract(point,cameraTarget),plan.yaw,plan.pitch),depth=plan.perspective?Math.max(.01,plan.distance-z):plan.distance;
        extent=Math.max(extent,Math.abs(x)/(depth*plan.tangent*plan.ratio),Math.abs(y)/(depth*plan.tangent));
    }
    return {cameraTarget,zoom:Math.max(10,Math.min(100,85/extent))};
}

export function turnTitlePoint([x,y,z],yaw,pitch){
    const c=Math.cos(yaw),s=Math.sin(yaw),a=Math.cos(pitch),b=Math.sin(pitch),u=x*c+z*s,v=-x*s+z*c;
    return [u,y*a-v*b,y*b+v*a];
}

/** Lens/eye are shared by editing and output. Cropping must never dolly the camera. */
export function titleCameraPose(baseBounds,data){
    const radius=Math.max(2,Math.hypot(...baseBounds.max.map((n,i)=>(n-baseBounds.min[i])/2)));
    return {yaw:data.yaw*Math.PI/180,pitch:data.pitch*Math.PI/180,target:[...(data.cameraTarget||[0,0,0])],distance:radius*.8/Math.tan(20*Math.PI/180),radius,perspective:data.projection==='perspective'};
}

export function titleEditingPlan(bounds,baseBounds,data,width,height){
    const pose=titleCameraPose(baseBounds,data),ratio=width/height;
    const tangent=Math.tan(20*Math.PI/180)*100/data.zoom*Math.max(1,1.5/ratio);
    const halfHeight=pose.distance*tangent;
    return {...pose,width,height,ratio,tangent,halfHeight,shift:[0,0],depth:cameraDepth(bounds,pose)};
}

function cameraDepth(bounds,pose){
    return Math.max(1,...boundsCorners(bounds).map(p=>Math.abs(turnTitlePoint(subtract(p,pose.target),pose.yaw,pose.pitch)[2])))+1;
}

/** Output is a crop of the same camera image, using an off-axis frustum. */
export function titleOutputPlan(bounds,data,baseBounds=bounds){
    const pose=titleCameraPose(baseBounds,data);
    const corners=boundsCorners(bounds).map(point=>turnTitlePoint(subtract(point,pose.target),pose.yaw,pose.pitch));
    const projected=corners.filter(p=>!pose.perspective||pose.distance-p[2]>.01)
        .map(p=>pose.perspective?[p[0]/(pose.distance-p[2]),p[1]/(pose.distance-p[2])]:p.slice(0,2));
    if(!projected.length)projected.push([-1,-1],[1,1]);
    const min=[0,1].map(axis=>Math.min(...projected.map(p=>p[axis]))),max=[0,1].map(axis=>Math.max(...projected.map(p=>p[axis])));
    const extent=min.map((n,i)=>Math.max(.0001,max[i]-n)),aspect=extent[0]/extent[1];
    const width=data.resolution;
    const automaticPadding=Math.min(data.padding,(width-1)/2);
    const height=data.output==='custom'?data.outputHeight:data.output==='square'?width:Math.min(4096,Math.max(128,Math.round((width-2*automaticPadding)/aspect+2*automaticPadding)));
    const padding=Math.min(automaticPadding,(height-1)/2);
    const ratio=width/height,roomX=Math.max(1,width-2*padding)/width,roomY=Math.max(1,height-2*padding)/height;
    const vertical=Math.max(extent[1]/2/roomY,extent[0]/2/ratio/roomX)*100/data.zoom;
    return {...pose,width,height,ratio,tangent:pose.perspective?vertical:Math.tan(20*Math.PI/180),halfHeight:pose.perspective?pose.distance*vertical:vertical,
        shift:min.map((n,i)=>(n+max[i])/2),depth:cameraDepth(bounds,pose)};
}

export function fitTitleFrame(width,height,outputWidth,outputHeight){
    const scale=Math.min(width/outputWidth,height/outputHeight),w=Math.max(1,Math.round(outputWidth*scale)),h=Math.max(1,Math.round(outputHeight*scale));
    return {x:Math.round((width-w)/2),y:Math.round((height-h)/2),width:w,height:h};
}
