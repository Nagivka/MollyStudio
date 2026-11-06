import {normalizeTitleDocument,normalizeTitleTransform} from '../core/TitleDocument.mjs';
import {boundsCenter,add,inverseRotatePoint} from '../graphics/TitleSceneMath.mjs';
import {buildTitleMesh} from '../graphics/TitleMesh.mjs';
import {fitTitleEditingCamera} from '../graphics/TitleCamera.mjs';
import {labelHTML,bindAttribute,bindText} from '../core/Locale.mjs';
import {isShortcutTarget} from './KeyboardNavigation.js';

const modes=[['move','open_with','Перемещение'],['rotate','rotate_right','Вращение'],['scale','transform','Масштаб']];
const wrapAngle=value=>((value+180)%360+360)%360-180;

/** Editing, rendering and PNG share the same document camera pose. */
export default class TitleViewport {
    constructor(editor){
        this.editor=editor;this.states=new WeakMap();
        this.element=document.createElement('section');this.element.className='title-viewport';this.element.id='title-viewport';this.element.setAttribute('role','tabpanel');this.element.hidden=true;
        this.element.innerHTML=`<div class="title-viewport-toolbar" role="toolbar" aria-label="3D">
            <div class="title-mode-buttons">${modes.map(([id,icon,label])=>`<button class="md-btn outlined" type="button" data-title-mode="${id}" title="${label}" aria-label="${label}"><i class="material-symbols-rounded" aria-hidden="true">${icon}</i><span class="title-mode-label">${labelHTML(label)}</span></button>`).join('')}</div>
            <div class="title-view-buttons"><button class="md-btn outlined" type="button" data-title-view="edit">${labelHTML('Редактор')}</button><button class="md-btn outlined" type="button" data-title-view="render">${labelHTML('Предпросмотр')}</button></div>
            <div class="title-viewport-actions"><button class="md-icon-btn" type="button" data-title-fit><i class="material-symbols-rounded" aria-hidden="true">restart_alt</i></button></div>
        </div><div class="title-viewport-stage" tabindex="0"><div class="title-output-frame" hidden></div><svg class="title-gizmo" aria-hidden="true"></svg><output class="title-drag-readout" hidden></output></div><p class="title-navigation-hint"></p>`;
        const workspace=document.getElementById('workspace');workspace.append(this.element);
        this.stage=this.element.querySelector('.title-viewport-stage');
        this.stage.prepend(editor.renderer.canvas);editor.renderer.canvas.className='title-webgl-canvas';
        editor.renderer.canvas.addEventListener('webglcontextlost',()=>{if(editor.project())editor.showGraphicsError(Error('3D-контекст временно недоступен.'));});
        editor.renderer.canvas.addEventListener('webglcontextrestored',()=>{this.redraw();});
        bindAttribute(editor.renderer.canvas,'aria-label','Объёмная сцена надписи');bindAttribute(this.element.querySelector('[data-title-fit]'),'title','Сбросить камеру');
        bindAttribute(this.element.querySelector('[data-title-fit]'),'aria-label','Сбросить камеру');
        bindAttribute(this.stage,'aria-label','3D-вид надписи');
        for(const [id,,label] of modes){const button=this.element.querySelector(`[data-title-mode="${id}"]`);bindAttribute(button,'aria-label',label);bindAttribute(button,'title',label);}
        this.svg=this.element.querySelector('svg');this.outputFrame=this.element.querySelector('.title-output-frame');this.readout=this.element.querySelector('.title-drag-readout');
        this.element.addEventListener('click',event=>{
            const button=event.target.closest('button');if(!button)return;
            if(button.dataset.titleMode){this.cancelDrag();this.state.mode=button.dataset.titleMode;this.redraw();}
            else if(button.dataset.titleView){if(editor.commitPendingEdit()===false)return;this.state.view=button.dataset.titleView;this.redraw();}
            else if(button.hasAttribute('data-title-fit'))this.resetCamera();
        });
        this.stage.addEventListener('contextmenu',event=>event.preventDefault());
        this.stage.addEventListener('pointerdown',event=>this.pointerDown(event));
        this.stage.addEventListener('pointermove',event=>this.pointerMove(event));
        for(const type of ['pointerup','pointercancel','lostpointercapture'])this.stage.addEventListener(type,event=>this.pointerEnd(event,type!=='pointerup'));
        this.stage.addEventListener('wheel',event=>{
            event.preventDefault();event.stopImmediatePropagation();if(!editor.project())return;
            if(!this.cameraDirty&&editor.commitPendingEdit()===false)return;
            this.beginCameraEdit();
            this.state.zoom=Math.min(600,Math.max(10,this.state.zoom*Math.exp(-event.deltaY*.001)));this.redraw();
            clearTimeout(this.cameraTimer);this.cameraTimer=setTimeout(()=>editor.commitPendingEdit(),180);
        },{passive:false});
        window.addEventListener('keydown',event=>this.keyDown(event),true);
        window.addEventListener('blur',()=>this.cancelDrag());
        this.resizeObserver=new ResizeObserver(()=>{this.cancelDrag();this.redraw();});this.resizeObserver.observe(this.stage);
        window.addEventListener('pagehide',()=>{clearTimeout(this.cameraTimer);this.resizeObserver.disconnect();if(this.frame)cancelAnimationFrame(this.frame);});
    }
    get state(){
        const project=this.editor.project();if(!project)return null;
        if(!this.states.has(project)){const data=normalizeTitleDocument(project.titleData);this.states.set(project,{mode:'move',view:'edit',yaw:data.yaw,pitch:data.pitch,zoom:data.zoom,target:[...data.cameraTarget],selection:null,expanded:new Set(['row-0','row-1','row-2'])});}
        return this.states.get(project);
    }
    resetCamera(){this.cancelDrag();if(!this.state)return;this.editor.change(data=>{Object.assign(data,{yaw:0,pitch:-28,zoom:100,cameraTarget:[0,0,0]});const box=this.stage.getBoundingClientRect();Object.assign(data,fitTitleEditingCamera(data,buildTitleMesh(data),box.width,box.height));});}
    syncCamera(){
        if(!this.state||this.cameraDirty)return;
        const data=normalizeTitleDocument(this.editor.project().titleData);Object.assign(this.state,{yaw:data.yaw,pitch:data.pitch,zoom:data.zoom,target:[...data.cameraTarget]});
    }
    beginCameraEdit(){
        const project=this.editor.project();if(!this.editor.pending)this.editor.pending={project,before:structuredClone(project.titleData)};
        this.cameraDirty=true;
    }
    flushCamera(){
        clearTimeout(this.cameraTimer);
        if(!this.cameraDirty||!this.state)return;
        const project=this.editor.project(),state=this.state;this.cameraDirty=false;
        project.titleData=normalizeTitleDocument({...project.titleData,yaw:state.yaw,pitch:state.pitch,zoom:state.zoom,cameraTarget:[...state.target]});
    }

    show(visible){this.cancelDrag();this.element.hidden=!visible;if(visible)this.redraw();}
    redraw(){if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;this.draw();});}
    draw(){
        const project=this.editor.project(),state=this.state;if(!project||this.element.hidden||!this.editor.renderer.loaded||this.editor.renderer.lost||this.editor.opening?.project===project||this.editor.loading?.project===project||!this.editor.renderer.hasResources(project.titleData))return;
        const box=this.stage.getBoundingClientRect();if(!box.width||!box.height)return;
        const ratio=Math.min(2,window.devicePixelRatio||1);
        try{
            const settings=this.editor.app.settingsManager;
            const debug=state.view==='edit'&&settings.get('developerUnlocked')&&settings.get('developerTitleMesh');
            this.editor.renderer.drawViewport({...project.titleData,yaw:state.yaw,pitch:state.pitch,zoom:state.zoom,cameraTarget:state.target},box.width*ratio,box.height*ratio,state.view==='edit'?state:null,state.view==='edit'?state.selection:null,debug);
            if(!this.editor.panel.querySelector('[data-title-retry]').hidden)this.editor.syncRenderStatus();
            this.drawGizmo(box);
            const plan=this.editor.renderer.lastPlan,frame=plan.frame;this.outputFrame.hidden=!frame;
            if(frame){const sx=box.width/plan.width,sy=box.height/plan.height;Object.assign(this.outputFrame.style,{left:frame.x*sx+'px',top:frame.y*sy+'px',width:frame.width*sx+'px',height:frame.height*sy+'px'});}
            for(const button of this.element.querySelectorAll('[data-title-mode]')){button.classList.toggle('active',button.dataset.titleMode===state.mode);button.disabled=state.view==='render';button.setAttribute('aria-pressed',String(button.classList.contains('active')));}
            for(const button of this.element.querySelectorAll('[data-title-view]')){button.classList.toggle('active',button.dataset.titleView===state.view);button.setAttribute('aria-pressed',String(button.classList.contains('active')));}
            const selected=this.node();
            bindText(this.element.querySelector('.title-navigation-hint'),state.view==='render'?'Предпросмотр надписи. Готовый PNG — кнопка «Экспорт».':
                selected&&!this.isLocked(selected)?'Потяните ось X, Y или Z · Shift — привязка · Esc — снять выбор · ПКМ — камера':
                'Щелчок — выбрать букву · ПКМ — повернуть камеру · Колесо — приблизить · Shift+ПКМ — сдвинуть');
        }catch(error){this.editor.showGraphicsError(error);}
    }
    drawGizmo(box){
        const {state,editor,svg}=this,node=editor.renderer.mesh?.nodes.find(node=>node.id===state.selection);
        const visible=node&&state.view==='edit'&&!this.isLocked(node);svg.style.display=visible?'':'none';if(!visible)return;
        const center=node.worldPivot||boundsCenter(node.bounds),p=editor.renderer.projectPoint(center),length=editor.renderer.lastPlan.halfHeight*.22;
        const xy=point=>[point[0]*box.width,point[1]*box.height],origin=xy(p),ns='http://www.w3.org/2000/svg';
        const attributes=(element,values)=>{for(const [key,value] of Object.entries(values))element.setAttribute(key,String(value));};
        // Keep hit targets mounted across frames, including while the pointer is held.
        for(let axis=0;axis<3;axis++){
            let group=svg.children[axis];
            if(!group){
                group=document.createElementNS(ns,'g');group.dataset.titleAxis=String(axis);group.style.color=['#e85d65','#5bb678','#629bf6'][axis];
                for(const tag of ['line','circle','text','circle','line'])group.append(document.createElementNS(ns,tag));
                group.children[1].classList.add('title-axis-handle');group.children[3].classList.add('title-axis-hit');group.children[4].classList.add('title-axis-hit-line');svg.append(group);
            }
            const end=xy(editor.renderer.projectPoint(add(center,[0,1,2].map(i=>i===axis?length:0))));
            attributes(group.children[0],{x1:origin[0],y1:origin[1],x2:end[0],y2:end[1]});
            const shape=state.mode==='scale'?'rect':state.mode==='move'?'path':'circle';let handle=group.children[1];
            if(handle.tagName!==shape){const replacement=document.createElementNS(ns,shape);replacement.classList.add('title-axis-handle');handle.replaceWith(replacement);handle=replacement;}
            const vx=end[0]-origin[0],vy=end[1]-origin[1],distance=Math.hypot(vx,vy),ux=distance?vx/distance:1,uy=distance?vy/distance:0;
            attributes(handle,shape==='rect'?{x:end[0]-5,y:end[1]-5,width:10,height:10}:shape==='path'?{d:`M ${end[0]} ${end[1]} L ${end[0]-ux*14-uy*6} ${end[1]-uy*14+ux*6} L ${end[0]-ux*14+uy*6} ${end[1]-uy*14-ux*6} Z`}:{cx:end[0],cy:end[1],r:8});
            const inset=Math.min(18,distance*.4);attributes(group.children[4],{x1:origin[0]+ux*inset,y1:origin[1]+uy*inset,x2:end[0],y2:end[1]});
            group.classList.toggle('is-dragging',this.drag?.action==='object'&&this.drag.axis===axis);
            attributes(group.children[2],{x:end[0]+8,y:end[1]-8});group.children[2].textContent=['X','Y','Z'][axis];
            attributes(group.children[3],{cx:end[0],cy:end[1],r:14});
        }
    }
    node(id=this.state?.selection){return this.editor.renderer.mesh?.nodes.find(node=>node.id===id);}
    isLocked(node){const nodes=this.editor.renderer.mesh?.nodes||[];while(node){if(node.locked)return true;node=nodes.find(other=>other.id===node.parent);}return false;}
    select(id){
        this.state.selection=this.node(id)?id:null;
        for(let node=this.node();node?.parent;node=this.node(node.parent))this.state.expanded.add(node.parent);
        if(id)this.editor.setTab('scene');this.editor.syncScene();this.redraw();
    }
    pointerDown(event){
        if(!this.state||event.button>2||this.editor.commitPendingEdit()===false)return;
        event.preventDefault();event.stopImmediatePropagation();this.stage.focus({preventScroll:true});
        const navigation=event.button===1||event.button===2&&event.shiftKey?'pan':event.button===2||event.altKey?'orbit':null;
        if(this.state.view==='render'&&!navigation)return;
        const box=this.stage.getBoundingClientRect(),axis=event.target.closest('[data-title-axis]')?.dataset.titleAxis;
        let action=navigation;
        if(!action){
            if(axis!==undefined){if(!this.node()||this.isLocked(this.node()))return;action='object';}
            else{
                const hit=this.editor.renderer.pick((event.clientX-box.x)/box.width,(event.clientY-box.y)/box.height);
                this.select(hit?(event.ctrlKey||event.metaKey?hit.objectId:hit.glyphId):null);return;
            }
        }
        const node=this.node();
        this.drag={id:event.pointerId,x:event.clientX,y:event.clientY,project:this.editor.project(),view:structuredClone({...this.state,expanded:undefined}),action,mode:this.state.mode,axis:action==='object'?Number(axis):null,model:structuredClone(this.editor.project().titleData),selection:this.state.selection,moved:false};
        if(action==='object'){
            this.drag.anchor=node.worldPivot||boundsCenter(node.bounds);
            this.drag.axisStart=this.editor.renderer.axisParameter((event.clientX-box.x)/box.width,(event.clientY-box.y)/box.height,this.drag.anchor,this.drag.axis);
            this.drag.worldPerPixel=Math.hypot(...this.editor.renderer.screenDelta(0,1/box.height,this.drag.anchor));
        }
        this.stage.setPointerCapture(event.pointerId);this.redraw();
    }
    pointerMove(event){
        const drag=this.drag;if(!drag||drag.id!==event.pointerId)return;
        event.preventDefault();event.stopImmediatePropagation();
        const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.hypot(dx,dy)<2&&!drag.moved)return;
        drag.moved=true;
        if(drag.action==='orbit'){this.beginCameraEdit();this.state.yaw=wrapAngle(drag.view.yaw+dx*.5);this.state.pitch=Math.min(80,Math.max(-80,drag.view.pitch+dy*.5));}
        else if(drag.action==='pan'){
            this.beginCameraEdit();const box=this.stage.getBoundingClientRect(),delta=this.editor.renderer.screenDelta(dx/box.width,dy/box.height);
            this.state.target=drag.view.target.map((n,i)=>n-delta[i]);
        }else if(drag.action==='object'){
            const transform=normalizeTitleTransform(drag.model.transforms[drag.selection]),box=this.stage.getBoundingClientRect();
            if(drag.mode==='move'){
                const value=this.editor.renderer.axisParameter((event.clientX-box.x)/box.width,(event.clientY-box.y)/box.height,drag.anchor,drag.axis);
                let amount=value===null||drag.axisStart===null?(dx-dy)*drag.worldPerPixel:value-drag.axisStart;
                if(event.shiftKey)amount=Math.round(amount*4)/4;
                let delta=[0,0,0];delta[drag.axis]=amount;
                const parents=[];for(let node=this.node(this.node(drag.selection).parent);node;node=this.node(node.parent))parents.push(node);
                for(const parent of parents.reverse()){
                    const t=normalizeTitleTransform(drag.model.transforms[parent.id]);delta=inverseRotatePoint(delta,t.rotation).map((n,i)=>n/t.scale[i]);
                }
                transform.position=transform.position.map((n,i)=>n+delta[i]);
            }else if(drag.mode==='rotate'){
                let amount=(dx-dy)*.5;if(event.shiftKey)amount=Math.round(amount/15)*15;
                transform.rotation[drag.axis]=wrapAngle(transform.rotation[drag.axis]+amount);
            }else{
                let factor=Math.exp((dx-dy)*.008);if(event.shiftKey)factor=Math.max(.1,Math.round(factor*10)/10);
                transform.scale=transform.scale.map((n,i)=>event.ctrlKey||event.metaKey||drag.axis===i?n*factor:n);
            }
            if(!this.editor.pending)this.editor.pending={project:drag.project,before:structuredClone(drag.model)};
            drag.project.titleData=normalizeTitleDocument({...drag.model,transforms:{...drag.model.transforms,[drag.selection]:transform}});
            this.editor.syncTransform();this.readout.hidden=false;
            const t=drag.project.titleData.transforms[drag.selection],key={move:'position',rotate:'rotation',scale:'scale'}[drag.mode];
            this.readout.textContent=['X','Y','Z'][drag.axis]+': '+t[key][drag.axis]+(drag.mode==='rotate'?'°':drag.mode==='scale'?'×':'');
        }
        this.redraw();
    }
    pointerEnd(event,cancel=false){
        if(!this.drag||event.pointerId!==this.drag.id)return;
        const drag=this.drag;this.drag=null;this.readout.hidden=true;this.redraw();
        if(this.stage.hasPointerCapture(event.pointerId))this.stage.releasePointerCapture(event.pointerId);
        if(drag.moved){
            if(cancel){this.cameraDirty=false;clearTimeout(this.cameraTimer);const state=this.states.get(drag.project);if(state)Object.assign(state,{yaw:drag.view.yaw,pitch:drag.view.pitch,zoom:drag.view.zoom,target:[...drag.view.target]});drag.project.titleData=drag.model;this.editor.pending=null;this.editor.sync();this.redraw();}
            else this.editor.commitPendingEdit();
        }
        event.stopImmediatePropagation();
    }
    cancelDrag(){if(this.drag)this.pointerEnd({pointerId:this.drag.id,stopImmediatePropagation(){}},true);}
    finishDrag(){if(this.drag)this.pointerEnd({pointerId:this.drag.id,stopImmediatePropagation(){}},false);}
    keyDown(event){
        if(!this.state||event.defaultPrevented||isShortcutTarget(event.target,event))return;
        if(event.ctrlKey||event.metaKey||event.altKey)return;
        const key=({KeyW:'w',KeyE:'e',KeyR:'r',KeyF:'f'})[event.code]||event.key.toLowerCase();
        if(key==='escape'){if(this.drag)this.cancelDrag();else this.select(null);}
        else if(['w','e','r'].includes(key)){this.cancelDrag();this.state.mode={w:'move',e:'rotate',r:'scale'}[key];this.state.view='edit';this.redraw();}
        else if(key==='f')this.resetCamera();
        else if(event.key==='Delete'&&this.state.selection&&!this.isLocked(this.node())){
            this.editor.change(data=>{const id=this.state.selection;data.transforms[id]={...normalizeTitleTransform(data.transforms[id]),visible:false};});
        }
        else return;
        event.preventDefault();event.stopImmediatePropagation();
    }
}
