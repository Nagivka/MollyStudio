const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{let win;const results=[],timer=setTimeout(()=>app.exit(1),120000);try{
await ready();win=makeWindow(1280,900);
const pages=[['home','index.html',{}],['settings','settings.html',{tab:'effects'}],['gui','editor.html',{new:'true',type:'gui',size:'27',name:'Weather audit'}],['prefix','editor.html',{new:'true',type:'prefix',name:'Weather audit'}],['buttons','buttons.html',{}]];
for(const [name,file,query] of pages){
await win.loadFile(path.join(root,'src/renderer',file),{query});await settle(win);
for(const theme of ['dark','light','minecraft','light-minecraft']){
const result=await win.page.evaluate(async({name,theme})=>{
document.documentElement.classList.add('no-animations');document.documentElement.dataset.theme=theme;
await document.fonts.ready;
const {default:Obstacles}=await import(new URL('js/ui/WeatherObstacles.js',location.href));
const canvas=document.createElement('canvas');canvas.className='ambient-weather';canvas.width=innerWidth;canvas.height=innerHeight;canvas.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none';document.body.append(canvas);
const scene=new Obstacles(canvas);scene.update();const ctx=canvas.getContext('2d');ctx.fillStyle='magenta';ctx.fillRect(0,0,canvas.width,canvas.height);scene.apply(ctx,{width:canvas.width,height:canvas.height,scale:1,origin:{left:0,top:0}});
let samples=0;const failures=[];
const visible=(element,x,y)=>{
if(x<0||y<0||x>=innerWidth||y>=innerHeight)return false;
for(let node=element;node;node=node.parentElement){const s=getComputedStyle(node);if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)<.05)return false;if(/hidden|clip|auto|scroll/.test(s.overflow)){const r=node.getBoundingClientRect();if(x<r.left||x>=r.right||y<r.top||y>=r.bottom)return false;}}
return document.elementsFromPoint(x,y).some(node=>node===element||element.contains(node));};
const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let text;
while(text=walker.nextNode()){
const parent=text.parentElement;if(!text.data.trim()||parent.closest('script,style,svg,canvas,.sr-only,.visually-hidden,.material-symbols-rounded'))continue;
const range=document.createRange();range.selectNodeContents(text);
for(const r of range.getClientRects()){
const x=r.left+r.width/2,y=r.top+r.height/2;if(!r.width||!visible(parent,x,y))continue;samples++;
if(ctx.getImageData(Math.floor(x),Math.floor(y),1,1).data[3]!==0)failures.push(text.data.trim().slice(0,70));
}}
scene.dispose();canvas.remove();return{name,theme,samples,failures};
},{name,theme});results.push(result);if(result.failures.length)throw Error(JSON.stringify(result));
}}
await fs.writeFile(path.join(root,'.test-output/weather-important-report.json'),JSON.stringify({passed:true,cases:results.length,samples:results.reduce((n,r)=>n+r.samples,0),results},null,2));console.log(JSON.stringify({passed:true,cases:results.length,samples:results.reduce((n,r)=>n+r.samples,0)}));
}catch(error){console.error(error);process.exitCode=1;}finally{clearTimeout(timer);win?.destroy();app.exit(process.exitCode||0);}})();

