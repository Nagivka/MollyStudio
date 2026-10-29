import {makeSelection} from './SelectionGeometry.mjs';

function spansToSelection(rows){
    const rects=[];let previous=new Map();
    for(const [y,spans] of rows){const current=new Map();for(const [x,end] of spans){const key=`${x}:${end-x}`,old=previous.get(key);
        if(old&&old.y+old.height===y){old.height++;current.set(key,old);}else{const rect={x,y,width:end-x,height:1};rects.push(rect);current.set(key,rect);if(rects.length>2048)throw Error('Выделение слишком сложное. Уменьшите область или измените допуск.');}}
        previous=current;
    }
    return makeSelection(rects);
}
export function polygonSelection(points,width,height){
    if(points.length<3)return null;
    const minY=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y)))),maxY=Math.min(height-1,Math.ceil(Math.max(...points.map(p=>p.y))));
    function* rows(){
    for(let y=minY;y<=maxY;y++){
        const cuts=[],scan=y+.5;
        for(let i=0,j=points.length-1;i<points.length;j=i++){
            const a=points[j],b=points[i];if((a.y>scan)!==(b.y>scan))cuts.push(a.x+(scan-a.y)*(b.x-a.x)/(b.y-a.y));
        }
        cuts.sort((a,b)=>a-b);const spans=[];
        for(let i=0;i+1<cuts.length;i+=2){const start=Math.max(0,Math.ceil(cuts[i]-.5)),end=Math.min(width,Math.ceil(cuts[i+1]-.5));if(end>start)spans.push([start,end]);}
        yield [y,spans];
    }
    }
    return spansToSelection(rows());
}
export function colorSelection(image,x,y,{tolerance=0,contiguous=true}={}){
    const {width,height,data}=image;x=Math.floor(x);y=Math.floor(y);
    if(x<0||y<0||x>=width||y>=height)return null;
    const seed=(y*width+x)*4,alpha=data[seed+3],limit=Math.min(255,Math.max(0,Number(tolerance)||0)),mask=new Uint8Array(width*height);
    const matches=index=>{
        const offset=index*4,a=data[offset+3];if(Math.abs(a-alpha)>limit)return false;
        if(a===0&&alpha===0)return true;
        return Math.max(Math.abs(data[offset]*a/255-data[seed]*alpha/255),Math.abs(data[offset+1]*a/255-data[seed+1]*alpha/255),Math.abs(data[offset+2]*a/255-data[seed+2]*alpha/255))<=limit;
    };
    if(contiguous){
        const stack=[y*width+x];
        while(stack.length){const index=stack.pop();if(mask[index]||!matches(index))continue;
            const row=Math.floor(index/width),col=index%width;let left=col,right=col;
            while(left>0&&!mask[row*width+left-1]&&matches(row*width+left-1))left--;
            while(right+1<width&&!mask[row*width+right+1]&&matches(row*width+right+1))right++;
            let above=false,below=false;
            for(let px=left;px<=right;px++){const current=row*width+px;mask[current]=1;
                const up=row>0&&!mask[current-width]&&matches(current-width),down=row+1<height&&!mask[current+width]&&matches(current+width);
                if(up&&!above)stack.push(current-width);if(down&&!below)stack.push(current+width);above=up;below=down;
            }
        }
    }else for(let index=0;index<mask.length;index++)if(matches(index))mask[index]=1;
    function* rows(){
        for(let row=0;row<height;row++){const spans=[];let col=0;while(col<width){while(col<width&&!mask[row*width+col])col++;const start=col;while(col<width&&mask[row*width+col])col++;if(col>start)spans.push([start,col]);}yield [row,spans];}
    }
    return spansToSelection(rows());
}
