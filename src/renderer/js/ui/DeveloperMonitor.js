let frame=0,enabled=false,node,last=0,start=0,count=0,slow=0,maximum=0,listening=false;
function stop(){cancelAnimationFrame(frame);frame=0;last=start=count=slow=maximum=0;node?.remove();node=null;}
function draw(now){
    if(!enabled||document.hidden){stop();return;}
    if(last){const elapsed=now-last;maximum=Math.max(maximum,elapsed);if(elapsed>50)slow++;count++;}
    last=now;if(!start)start=now;
    if(now-start>=1000){
        node.textContent=`${Math.round(count*1000/(now-start))} FPS · ${Math.round(maximum)} ms max · >50 ms: ${slow}`;
        count=slow=maximum=0;start=now;
    }
    frame=requestAnimationFrame(draw);
}
function refresh(){
    if(!enabled||document.hidden){stop();return;}
    if(frame)return;
    node=document.createElement('output');node.className='developer-performance';node.textContent='FPS…';document.body.append(node);
    frame=requestAnimationFrame(draw);
}
export function syncDeveloperMonitor(value){
    if(typeof window==='undefined'||typeof requestAnimationFrame!=='function')return;
    enabled=Boolean(value);
    if(!listening&&enabled){listening=true;document.addEventListener('visibilitychange',refresh);window.addEventListener('pagehide',()=>{enabled=false;stop();},{once:true});}
    refresh();
}
