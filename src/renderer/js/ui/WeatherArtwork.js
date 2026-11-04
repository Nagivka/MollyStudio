// Small, deterministic canvases, shared between live effects and previews.
// No per-frame gradients, random texture generation or shadow filters.
const leaves=new Map(),snow=new Map(),rain=new Map();
let hiddenSnowflake;
// Independent existing particle values give a stable 1/1024 chance per flake.
export const isCreeperSnowflake=particle=>particle.variant===63&&particle.color===3&&particle.phase<Math.PI/2;
export function creeperSnowflake(){
    if(hiddenSnowflake)return hiddenSnowflake;
    const sprite=document.createElement('canvas');sprite.width=sprite.height=16;
    const ctx=sprite.getContext('2d');ctx.fillStyle='#e4eff8';
    ctx.fillRect(4,4,8,8);
    for(const [x,y,w,h] of [[7,0,2,4],[7,12,2,4],[0,7,4,2],[12,7,4,2],
        [2,2,2,2],[12,2,2,2],[2,12,2,2],[12,12,2,2]])ctx.fillRect(x,y,w,h);
    for(const [x,y,w,h] of [[5,6,2,2],[9,6,2,2],[7,8,2,1],[6,9,4,2],[6,11,1,1],[9,11,1,1]])ctx.clearRect(x,y,w,h);
    hiddenSnowflake=sprite;return sprite;
}
const colors=[['#c58b3c','#9d532c','#e1ae59'],['#bb6744','#8e4631','#d18a5b'],['#c9a14b','#99732e','#e0bd6c'],['#a88049','#795630','#c4a26c']];
const outlines=[
    [[0,-.64],[.18,-.3],[.48,-.4],[.4,-.12],[.68,.04],[.37,.18],[.36,.43],[.12,.36],[0,.55],[-.15,.35],[-.4,.41],[-.35,.15],[-.65,.02],[-.38,-.14],[-.49,-.4],[-.18,-.3]],
    [[0,-.7],[.27,-.45],[.4,-.1],[.35,.23],[.16,.5],[0,.58],[-.23,.36],[-.35,.05],[-.27,-.37]],
    [[0,-.7],[.22,-.35],[.25,.07],[.14,.43],[0,.65],[-.18,.35],[-.22,-.04],[-.13,-.42]],
    [[0,-.64],[.21,-.47],[.18,-.31],[.4,-.25],[.28,-.07],[.45,.04],[.28,.19],[.34,.34],[.12,.41],[0,.6],[-.16,.4],[-.35,.33],[-.27,.16],[-.42,.02],[-.26,-.1],[-.36,-.26],[-.16,-.33],[-.2,-.48]]
];
function canvas(){const c=document.createElement('canvas');c.width=c.height=96;return c;}
export function naturalLeaf(variant,color,season='autumn'){
    const key=season+':'+((variant%8)*4+color%4);
    if(leaves.has(key))return leaves.get(key);
    const green=[['#599443','#315d2c','#8fba60'],['#4c873c','#28512d','#80af50'],['#71a44c','#426b30','#a0c66d'],['#508e55','#305c39','#8ab775']];
    const pink=[['#d57ba4','#98476e','#f3b2d1'],['#d58ab4','#985379','#f6c0df'],['#c96b97','#914264','#efa8cb'],['#db96b9','#a35e84','#f8cce1']];
    const c=canvas(),ctx=c.getContext('2d'),palette=season==='summer'?green[color%4]:season==='spring'?pink[color%4]:colors[color%4];
    ctx.translate(48,44);ctx.scale(62,62);
    const points=outlines[variant%outlines.length],path=new Path2D();
    const midpoint=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
    path.moveTo(...midpoint(points.at(-1),points[0]));
    for(let i=0;i<points.length;i++)path.quadraticCurveTo(...points[i],...midpoint(points[i],points[(i+1)%points.length]));
    path.closePath();
    ctx.save();ctx.clip(path);
    const fill=ctx.createLinearGradient(-.6,-.6,.5,.6);
    fill.addColorStop(0,palette[2]);fill.addColorStop(.48,palette[0]);fill.addColorStop(1,palette[1]);
    ctx.fillStyle=fill;ctx.fill(path);
    // Fine, irregular pigmentation instead of bevels or a glossy centre seam.
    let seed=(variant%8)*4+color%4+97;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    for(let i=0;i<110;i++){
        ctx.fillStyle=i%3?'#53361b16':'#fff0b018';
        const x=random()*1.4-.7,y=random()*1.4-.7,r=.004+random()*.018;
        ctx.beginPath();ctx.ellipse(x,y,r,r*.6,random()*3,0,Math.PI*2);ctx.fill();
    }
    ctx.strokeStyle='#60472755';ctx.lineWidth=.009;ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(0,.53);ctx.quadraticCurveTo(-.045,.03,0,-.55);ctx.stroke();
    for(let i=0;i<4;i++)for(const sign of [-1,1]){
        const y=-.28+i*.18;ctx.beginPath();ctx.moveTo(-.01,y+.12);ctx.quadraticCurveTo(sign*.13,y+.03,sign*(variant%4===2?.17:.3),y-.08);ctx.stroke();
    }
    ctx.restore();ctx.strokeStyle=palette[1];ctx.lineWidth=.018;
    ctx.beginPath();ctx.moveTo(0,.45);ctx.quadraticCurveTo(.015,.6,.08,.72);ctx.stroke();
    leaves.set(key,c);return c;
}
export function naturalSnow(variant,light){
    const shape=((variant%6)+6)%6,key=shape+(light?6:0);
    if(snow.has(key))return snow.get(key);
    const c=canvas(),ctx=c.getContext('2d');
    // Open sixfold crystals stay recognizable at the actual 4–20 px particle
    // sizes. No blurred disc, glossy centre or per-frame texture generation.
    ctx.translate(48,48);ctx.rotate(shape%2?Math.PI/6:0);
    ctx.strokeStyle=light?'#60869f':'#edf7ff';
    ctx.lineWidth=shape===3?3:4;ctx.lineCap='round';ctx.lineJoin='round';
    const line=(x,y,a,b)=>{ctx.moveTo(x,y);ctx.lineTo(a,b);};
    ctx.beginPath();
    for(let arm=0;arm<6;arm++){
        ctx.save();ctx.rotate(arm*Math.PI/3);
        line(0,0,38,0);
        const branches=shape===0?[20]:shape===1?[24]:shape===2?[16,27]:shape===3?[13,22,31]:shape===4?[27]:[18,29];
        for(const distance of branches){
            const length=shape===1?13:shape===3?7:10;
            for(const sign of [-1,1])line(distance,0,distance+length*.55,sign*length*.84);
        }
        ctx.restore();
    }
    ctx.stroke();
    if(shape===1||shape===4){
        const radius=shape===4?15:9;
        ctx.lineWidth=3;ctx.beginPath();
        for(let i=0;i<=6;i++){
            const angle=i*Math.PI/3,x=Math.cos(angle)*radius,y=Math.sin(angle)*radius;
            if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);
        }
        ctx.stroke();
    }
    snow.set(key,c);return c;
}
export function naturalRain(light){
    const key=Boolean(light);if(rain.has(key))return rain.get(key);
    const c=document.createElement('canvas');c.width=8;c.height=64;
    const ctx=c.getContext('2d'),fill=ctx.createLinearGradient(0,0,0,64);
    const color=light?'65,104,130':'170,200,221';
    fill.addColorStop(0,`rgba(${color},0)`);fill.addColorStop(.65,`rgba(${color},.5)`);fill.addColorStop(.92,`rgba(${color},.8)`);fill.addColorStop(1,`rgba(${color},0)`);
    ctx.fillStyle=fill;ctx.fillRect(3,0,2,64);rain.set(key,c);return c;
}
