export function intersectRects(a,b){
    const left=Math.max(a.left,b.left),top=Math.max(a.top,b.top),right=Math.min(a.right,b.right),bottom=Math.min(a.bottom,b.bottom);
    return right>left&&bottom>top?{left,top,right,bottom}:null;
}

/** CSS scales all corner radii together when adjacent corners would overlap. */
export function normalizeCornerRadii(width,height,radii=[]){
    const corners=Array.from({length:4},(_,index)=>{
        const radius=radii[index]||[0,0];
        return [Math.max(0,Number(radius[0])||0),Math.max(0,Number(radius[1])||0)];
    });
    const ratio=(span,sum)=>sum>0?span/sum:1;
    const factor=Math.min(1,ratio(width,corners[0][0]+corners[1][0]),ratio(width,corners[3][0]+corners[2][0]),ratio(height,corners[0][1]+corners[3][1]),ratio(height,corners[1][1]+corners[2][1]));
    return corners.map(([x,y])=>[x*factor,y*factor]);
}

function boxDistance(x,y,rect){
    const dx=Math.abs(x-(rect.left+rect.right)/2)-(rect.right-rect.left)/2;
    const dy=Math.abs(y-(rect.top+rect.bottom)/2)-(rect.bottom-rect.top)/2;
    return Math.hypot(Math.max(0,dx),Math.max(0,dy))+Math.min(Math.max(dx,dy),0);
}

/** Signed distance used for exact inside/outside queries, without safety margins. */
export function roundedRectDistance(x,y,shape){
    const {left,top,right,bottom,radii=[]}=shape;
    let distance=boxDistance(x,y,shape);
    for(let corner=0;corner<4;corner++){
        const [rx,ry]=radii[corner]||[0,0];if(rx<=0||ry<=0)continue;
        const cx=corner===0||corner===3?left+rx:right-rx;
        const cy=corner<2?top+ry:bottom-ry;
        if((corner===0||corner===3?x<cx:x>cx)&&(corner<2?y<cy:y>cy)){
            distance=Math.max(distance,(Math.hypot((x-cx)/rx,(y-cy)/ry)-1)*Math.min(rx,ry));
        }
    }
    return shape.clip?Math.max(distance,boxDistance(x,y,shape.clip)):distance;
}

/** UI regions form one union that hides only the overlapping particle pixels. */
export class WeatherOcclusion{
    constructor(cellSize=128){this.cellSize=cellSize;this.cells=new Map();this.shapes=[];this.revision=0;}
    setShapes(shapes){
        this.cells.clear();this.shapes=[];
        for(const shape of shapes){
            if(![shape.left,shape.top,shape.right,shape.bottom].every(Number.isFinite))continue;
            const bounds=shape.clip?intersectRects(shape,shape.clip):shape;
            if(!bounds||bounds.right<=bounds.left||bounds.bottom<=bounds.top)continue;
            const index=this.shapes.length;this.shapes.push(shape);
            const size=this.cellSize;
            for(let y=Math.floor(bounds.top/size);y<=Math.floor(bounds.bottom/size);y++)for(let x=Math.floor(bounds.left/size);x<=Math.floor(bounds.right/size);x++){
                const key=x+','+y;let cell=this.cells.get(key);if(!cell)this.cells.set(key,cell=[]);cell.push(index);
            }
        }
        this.revision++;
    }
    visibility(x,y){
        if(!Number.isFinite(x)||!Number.isFinite(y))return 1;
        const cell=this.cells.get(Math.floor(x/this.cellSize)+','+Math.floor(y/this.cellSize));
        for(const index of cell||[])if(roundedRectDistance(x,y,this.shapes[index])<=0)return 0;
        return 1;
    }
    clear(){this.setShapes([]);}
}
