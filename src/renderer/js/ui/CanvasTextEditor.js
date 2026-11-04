import TransformOverlay from './TransformOverlay.js';
import {bindAttribute} from '../core/Locale.mjs';
import {textNavigation} from '../core/Platform.mjs';
import {CreateObjectCommand, TextDataCommand} from '../core/Commands.js';
import {captureTextState, restoreTextState} from '../graphics/TextEdit.mjs';
import {textMatrix,textWorldPoint,textLocalPoint} from '../graphics/TextTransform.mjs';
import {normalizeText, SnapshotHistory, snapIndex, caretPosition, hitCaret, glyphIndexAt,
    wordRange, paragraphRange, moveHorizontal, moveVertical} from '../graphics/TextNavigation.mjs';

const clone = value => structuredClone(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Native text input drives editable bitmap layers; all guides live outside exported pixels. */
export default class CanvasTextEditor {
    constructor(tool) {
        this.tool=tool;this.bus=tool.bus;this.manager=tool.layerManager;
        this.canvas=document.getElementById('main-canvas');this.workspace=document.getElementById('workspace');
        this.focusTarget=document.getElementById('canvas-wrapper')||this.canvas;
        this.history=new SnapshotHistory(120);this.active=false;this.drag=null;this.blink=true;
        this.input=document.createElement('textarea');this.input.id='canvas-text-input';this.input.className='canvas-text-input';
        this.input.maxLength=4096;this.input.spellcheck=false;this.input.autocomplete='off';this.input.tabIndex=-1;
        bindAttribute(this.input,'aria-label','Ввод текста выбранного объекта');document.body.append(this.input);
        this.overlay=new TransformOverlay(this.bus,this.workspace,this.canvas,this.manager.config,
            {id:'text-overlay-canvas',event:'TEXT_OVERLAY_UPDATED',clearOnPreview:false});
        this.installInput();
        document.getElementById('btn-text-inline')?.addEventListener('click',()=>this.open(this.manager.getActiveLayer()));
        document.getElementById('text-edit-apply')?.addEventListener('click',()=>this.finish(true));
        document.getElementById('text-edit-cancel')?.addEventListener('click',()=>this.finish(false));
        for(const button of document.querySelectorAll('[data-text-kind]'))button.addEventListener('click',()=>{
            const layer=this.manager.getActiveLayer();if(!tool.canEditText(layer))return;
            tool.capturePendingEdit();const layout=tool.getTextLayout(layer);
            tool.changeTextData(layer,data=>{
                data.maxWidth=button.dataset.textKind==='frame'?Math.ceil(Math.max(16,layout.width)):0;
                data.frameHeight=data.maxWidth?Math.ceil(Math.max(16,layout.contentHeight)):0;
            });tool.commitStyleEdit();tool.syncUIWithLayer(layer);
        });
        for(const [id,key,value] of [['text-fit-height','frameHeight',layout=>layout.contentHeight],['text-fit-width','maxWidth',layout=>layout.minRequiredWidth]])
            document.getElementById(id)?.addEventListener('click',()=>{
                const layer=this.manager.getActiveLayer();if(!tool.canEditText(layer))return;
                tool.capturePendingEdit();tool.changeTextData(layer,data=>{data[key]=clamp(Math.ceil(value(tool.getTextLayout(layer))),1,4096);});
                tool.commitStyleEdit();tool.syncUIWithLayer(layer);
            });
        this.workspace.addEventListener('dblclick',event=>{
            if(tool.toolManager.currentToolId==='text'||event.target.closest('button,input,select,textarea,.doc-tab-bar,.bottom-status-bar'))return;
            const point=this.eventPoint(event),layer=this.findAt(point);
            if(layer){event.preventDefault();tool.toolManager.setTool('text');this.selectAt(layer,point,event,2);this.drag=null;}
        });
        document.addEventListener('pointerdown',event=>{if(!this.workspace.contains(event.target))this.lastClick=null;},true);
        document.addEventListener('keydown',event=>{
            if(!this.active||event.target===this.input||event.isComposing||this.composing)return;
            if(event.key==='Escape'&&event.target.closest('#prop-group-text,#prop-group-text-layout')&&this.property){
                event.preventDefault();event.stopImmediatePropagation();this.restore(this.property);this.property=this.propertyControl=null;
                this.tool.syncUIWithLayer(this.layer,{force:true});event.target.blur();this.focus();
            }else if(event.key==='Enter'&&event.target.matches('input[type=number]')&&this.property){
                event.preventDefault();event.stopImmediatePropagation();this.commitProperty();event.target.blur();this.focus();
            }else if(event.key==='Escape'&&!event.target.closest('dialog,.modal-overlay')){
                event.preventDefault();if(!this.tool.toolManager.pointerSession)this.finish(false);
            }
        },true);
        for(const event of ['CANVAS_UPDATED','TEXT_VIEWPORT_CHANGED','TOOL_CHANGED','LAYER_ACTIVE_CHANGED','SETTINGS_CHANGED'])this.bus.on(event,()=>this.refresh());
        this.timer=setInterval(()=>{
            if(this.active&&document.activeElement===this.input&&document.visibilityState==='visible'){this.blink=!this.blink;this.render();}
        },500);
        window.addEventListener('pagehide',()=>{clearInterval(this.timer);if(this.overlayFrame)cancelAnimationFrame(this.overlayFrame);this.disposed=true;});
    }

    selection() {
        const input=this.input,backward=input.selectionDirection==='backward';
        return {start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection,
            focus:backward?input.selectionStart:input.selectionEnd,anchor:backward?input.selectionEnd:input.selectionStart};
    }
    snapshot() {return {data:clone(this.layer.textData),selection:this.selection(),line:this.line??null};}
    restore(snapshot) {
        if(!this.layer||!this.tool.changeTextData(this.layer,data=>{Object.assign(data,snapshot.data);for(const key of Object.keys(data))if(!(key in snapshot.data))delete data[key];}))return false;
        this.input.value=this.layer.textData.text;const range=snapshot.selection;
        this.input.setSelectionRange(range.start,range.end,range.direction);this.line=snapshot.line;this.goalX=null;this.blink=true;this.refresh();return true;
    }
    captureProperty() {if(this.active&&!this.property&&!this.composing){this.history.breakGroup();this.property=this.snapshot();this.propertyControl=document.activeElement;}}
    commitProperty() {
        if(this.property&&this.active){
            const before=this.property,invalid=this.propertyControl?.getAttribute('aria-invalid')==='true';
            this.property=null;this.propertyControl=null;
            if(invalid){this.restore(before);this.tool.syncUIWithLayer(this.layer,{force:true});}
            else this.history.record(before,this.snapshot());this.notify();
        }
        return true;
    }
    notify() {this.tool.history.notifyChanged();this.refresh();}
    focus() {if(this.active){this.input.focus({preventScroll:true});this.positionInput();}}
    caret(index,anchor=index,line=null) {
        const layout=this.tool.getTextLayout(this.layer);index=snapIndex(layout,index);anchor=snapIndex(layout,anchor);
        this.input.setSelectionRange(Math.min(index,anchor),Math.max(index,anchor),index<anchor?'backward':'forward');
        this.line=line;this.blink=true;this.render();this.positionInput();
    }
    open(layer,{created=false,previousId=null,index=null,line=null}={}) {
        if(!this.tool.canEditText(layer)||this.composing)return false;
        if(this.active&&this.layer===layer){this.caret(index??layer.textData.text.length,index??layer.textData.text.length,line);this.focus();return true;}
        if(this.active&&!this.finish(true))return false;
        this.tool.finishTextSnapshot?.();
        if(this.tool.toolManager.currentToolId!=='text')this.tool.toolManager.setTool('text');
        this.manager.setActive(layer.id);
        this.layer=layer;this.before=captureTextState(layer);this.created=created;this.previousId=previousId;
        this.history.clear();this.property=this.propertyControl=this.inputBefore=this.compositionBefore=null;this.composing=false;this.active=true;this.tool.inlineLayer=layer;
        this.input.value=normalizeText(layer.textData.text);this.line=line;this.goalX=null;
        // A native textarea normalizes CRLF. Keep its UTF-16 positions identical
        // to the source layout, while Escape can still restore the original file.
        if(this.input.value!==layer.textData.text&&!this.tool.changeTextData(layer,data=>{data.text=this.input.value;})){
            this.finish(false);return false;
        }
        this.tool.syncUIWithLayer(layer,{force:true});
        this.caret(index??layer.textData.text.length,index??layer.textData.text.length,line);this.focus();this.notify();return true;
    }
    finish(apply=true) {
        if(!this.active)return true;if(this.composing)return false;
        if(this.drag)this.cancelGesture();this.commitProperty();
        const layer=this.layer,before=this.before,created=this.created;
        this.active=false;this.tool.inlineLayer=null;this.property=this.propertyControl=this.inputBefore=this.compositionBefore=null;
        this.layer=this.before=null;this.created=false;this.input.blur();
        if(created&&(!apply||!layer.textData.text.length)){
            this.manager.removeLayer(layer.id);if(this.previousId)this.manager.setActive(this.previousId);
        }else if(apply){
            if(created)this.tool.history.push(new CreateObjectCommand(this.manager,layer));
            else if(JSON.stringify(before.textData)!==JSON.stringify(layer.textData))this.tool.history.push(new TextDataCommand(layer,before.textData,layer.textData,this.bus));
        }else{restoreTextState(layer,before);this.bus.emit('LAYER_NAME_CHANGED',layer);}
        this.history.clear();this.tool.history.notifyChanged();
        const active=this.manager.getActiveLayer();if(active?.type==='text')this.tool.syncUIWithLayer(active,{force:true});
        this.bus.emit('CANVAS_UPDATED');this.focusTarget.focus({preventScroll:true});this.refresh();return true;
    }
    undo(back=true) {
        if(this.composing)return false;
        if(this.tool.toolManager.pointerSession){this.tool.toolManager.cancelPointer();return true;}
        this.commitProperty();const value=back?this.history.undo():this.history.redo();
        if(value){
            if(!this.restore(value)){if(back)this.history.redo();else this.history.undo();this.notify();return false;}
            this.focus();
        }this.notify();return !!value;
    }

    installInput() {
        const input=this.input;
        input.addEventListener('beforeinput',event=>{
            if(!this.active)return;
            if(['historyUndo','historyRedo'].includes(event.inputType)){event.preventDefault();this.undo(event.inputType==='historyUndo');return;}
            if(!this.composing)this.inputBefore=this.snapshot();
            if(!this.composing&&['deleteContentBackward','deleteContentForward'].includes(event.inputType)){
                const range=this.selection();if(range.start!==range.end)return;
                const layout=this.tool.getTextLayout(this.layer),back=event.inputType==='deleteContentBackward';
                const boundary=back?layout.boundaries.findLast(index=>index<range.start):layout.boundaries.find(index=>index>range.end);
                if(boundary===undefined){this.inputBefore=null;return;}
                event.preventDefault();input.setRangeText('',back?boundary:range.start,back?range.end:boundary,'end');
                input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:event.inputType}));
            }
        });
        input.addEventListener('input',event=>{
            if(!this.active||!this.tool.canEditText(this.layer))return;
            const before=this.inputBefore||this.snapshot(),range=this.selection(),text=normalizeText(input.value);
            if(!this.tool.changeTextData(this.layer,data=>{data.text=text;})){input.value=this.layer.textData.text;return;}
            if(input.value!==text){input.value=text;input.setSelectionRange(Math.min(range.start,text.length),Math.min(range.end,text.length),range.direction);}
            this.line=null;this.goalX=null;this.blink=true;
            if(!this.composing&&!event.isComposing){
                const group=event.inputType==='insertText'&&event.data&&!/\s/.test(event.data)?'typing':
                    ['deleteContentBackward','deleteContentForward'].includes(event.inputType)&&before.selection.start===before.selection.end?event.inputType:null;
                this.history.record(before,this.snapshot(),{group});this.inputBefore=null;
            }
            this.notify();this.ensureVisible();
        });
        input.addEventListener('compositionstart',()=>{if(!this.active)return;this.compositionBefore=this.snapshot();this.history.breakGroup();this.composing=true;this.refresh();});
        input.addEventListener('compositionend',()=>{
            if(!this.active)return;this.tool.changeTextData(this.layer,data=>{data.text=normalizeText(input.value);});
            this.composing=false;this.history.record(this.compositionBefore,this.snapshot());this.compositionBefore=this.inputBefore=null;this.notify();
        });
        input.addEventListener('keydown',event=>{
            if(!this.active||event.isComposing||this.composing)return;
            const modifier=event.ctrlKey||event.metaKey;
            if(modifier&&['KeyZ','KeyY'].includes(event.code)){
                event.preventDefault();event.stopPropagation();this.undo(event.code==='KeyZ'&&!event.shiftKey);return;
            }
            if(modifier&&event.key==='Enter'){event.preventDefault();this.finish(true);return;}
            if(modifier&&event.code==='KeyS'&&!event.altKey){
                event.preventDefault();window.mollyEditor?.menuBar.handleAction(event.shiftKey?'file-save-as':'file-save');return;
            }
            if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.finish(false);return;}
            const navigation=textNavigation(event);if(!navigation)return;
            event.preventDefault();this.history.breakGroup();
            const layout=this.tool.getTextLayout(this.layer),range=this.selection(),caret=caretPosition(layout,range.focus,this.line);let hit;
            if(navigation.kind==='horizontal'){
                const {direction,word}=navigation;
                hit=!event.shiftKey&&range.start!==range.end&&!word?{index:direction<0?range.start:range.end,line:null}:moveHorizontal(layout,range.focus,this.line,direction,word);this.goalX=null;
            }else if(navigation.kind==='line'||navigation.kind==='document'){
                const {end}=navigation,row=layout.lines[caret.line],whole=navigation.kind==='document';hit={index:whole?end?layout.text.length:0:end?row.end:row.start,line:whole?null:caret.line};this.goalX=null;
            }else{hit=moveVertical(layout,range.focus,this.line,navigation.direction,this.goalX);this.goalX=hit.goalX;}
            this.caret(hit.index,event.shiftKey?range.anchor:hit.index,hit.line);this.ensureVisible();
        });
        document.addEventListener('selectionchange',()=>{if(this.active&&document.activeElement===input){this.blink=true;this.render();}});
    }

    eventPoint(event) {
        const r=this.canvas.getBoundingClientRect();return {x:(event.clientX-r.left)*this.manager.config.width/r.width,y:(event.clientY-r.top)*this.manager.config.height/r.height};
    }
    local(data,point) {
        return textLocalPoint(data,point);
    }
    world(data,point) {
        return textWorldPoint(data,point);
    }
    findHandle(point) {
        const layer=this.manager.getActiveLayer();
        if(!this.tool.canEditText(layer)||!(layer.textData.maxWidth>0))return null;
        const data=layer.textData,layout=this.tool.getTextLayout(layer),m=textMatrix(data),z=this.zoom();
        const handles=[['corner',layout.height],['width',layout.height/2]].map(([kind,y])=>{
            const p=this.world(data,{x:layout.width,y});
            return {kind,distance:Math.hypot(point.x-p.x,point.y-p.y)*z};
        }).sort((a,b)=>a.distance-b.distance);
        for(const {kind,distance} of handles){
            if(distance<=8){
                const direction=kind==='corner'?{x:m.a+m.c,y:m.b+m.d}:{x:m.a,y:m.b};
                const index=((Math.round(Math.atan2(direction.y,direction.x)*4/Math.PI)%4)+4)%4;
                return {kind,layer,layout,cursor:['ew-resize','nwse-resize','ns-resize','nesw-resize'][index]};
            }
        }
        return null;
    }
    hover(point){
        const view=window.mollyEditor?.workspace;
        if(view?.isPanning||view?.isSpacePressed||view?.isBrushResizing)return;
        const handle=this.findHandle(point),cursor=handle?.cursor||'text';
        this.canvas.style.cursor=cursor;const wrapper=document.getElementById('canvas-wrapper');if(wrapper)wrapper.style.cursor=cursor;
        this.workspace.style.cursor=handle?cursor:'default';
    }
    findAt(point) {
        const top=this.manager.findLayerAt(Math.floor(point.x),Math.floor(point.y));
        // Whitespace belongs to the frame above an image, but an opaque image
        // above that frame must still block clicks through to the lower text.
        for(const layer of [...this.manager.layers].reverse()){
            if(this.tool.canEditText(layer)){
                const p=this.local(layer.textData,point),layout=this.tool.getTextLayout(layer);
                if(p.x>=0&&p.y>=0&&p.x<=(layer.textData.maxWidth>0?layout.width:Math.max(16,layout.width))&&p.y<=layout.height)return layer;
                if(layer===top)return layer;
            }
            if(layer===top&&!layer.isBase)return null;
        }
        return null;
    }
    selectAt(layer,point,event,clicks=1) {
        const local=this.local(layer.textData,point),layout=this.tool.getTextLayout(layer),hit=hitCaret(layout,local.x,local.y);
        const oldAnchor=this.active&&this.layer===layer?this.selection().anchor:hit.index;
        if(!this.open(layer,{index:hit.index,line:hit.line}))return;
        let range={start:hit.index,end:hit.index},granularity='character';
        if(clicks>=3){range=paragraphRange(layout.text,glyphIndexAt(layout,local.x,local.y));granularity='paragraph';}
        else if(clicks===2){range=wordRange(layout.text,glyphIndexAt(layout,local.x,local.y));granularity='word';}
        const anchor=event?.shiftKey?oldAnchor:range.start;this.history.breakGroup();
        this.caret(range.end,anchor,hit.line);this.drag={kind:'select',layer,anchor,range,granularity,point};this.focus();
    }
    pointerDown(x,y,color,parent,event) {
        if(this.composing)return;event?.preventDefault?.();this.commitProperty();
        const point={x,y},layer=this.manager.getActiveLayer();
        const handle=this.findHandle(point);
        if(handle){
                if(this.active)this.focus();else this.focusTarget.focus({preventScroll:true});
                this.history.breakGroup();this.drag={kind:'resize',layer,handle:handle.kind,point,start:clone(layer.textData),startHeight:handle.layout.height,before:captureTextState(layer),edit:this.active?this.snapshot():null};return;
        }
        const previous=this.lastClick,time=event?.timeStamp??performance.now();
        const clicks=previous&&time-previous.time<500&&Math.hypot(x-previous.x,y-previous.y)*this.zoom()<5?previous.count%3+1:1;
        this.lastClick={time,x,y,count:clicks};
        const hit=this.findAt(point);if(hit){this.selectAt(hit,point,event,clicks);return;}
        if(!this.finish(true))return;
        if(parent&&this.manager.isEditable?.(parent)===false)return;
        this.drag={kind:'create',point,to:point,color,parent,previousId:this.manager.activeLayerId};this.render();
    }
    pointerMove(x,y) {
        const drag=this.drag;if(!drag)return;const point={x,y};
        if(Math.hypot(x-drag.point.x,y-drag.point.y)*this.zoom()>5)this.lastClick=null;
        if(drag.kind==='create')drag.to=point;
        else if(drag.kind==='resize'){
            const from=this.local(drag.start,drag.point),to=this.local(drag.start,point);
            this.tool.changeTextData(drag.layer,data=>{
                data.maxWidth=clamp(Math.round(drag.start.maxWidth+to.x-from.x),1,4096);
                if(drag.handle==='corner')data.frameHeight=clamp(Math.round(drag.startHeight+to.y-from.y),1,4096);
            });this.tool.syncUIWithLayer(drag.layer);
        }else if(drag.kind==='select'){
            const layout=this.tool.getTextLayout(drag.layer),local=this.local(drag.layer.textData,point),hit=hitCaret(layout,local.x,local.y);
            if(drag.granularity==='character')this.caret(hit.index,drag.anchor,hit.line);
            else{const range=(drag.granularity==='word'?wordRange:paragraphRange)(layout.text,glyphIndexAt(layout,local.x,local.y));
                this.caret(range.start<drag.range.start?range.start:range.end,range.start<drag.range.start?drag.range.end:drag.range.start,hit.line);}
        }
        this.render();
    }
    pointerUp(x,y) {
        const drag=this.drag;if(!drag)return;
        if(Number.isFinite(x)&&Number.isFinite(y)&&drag.kind!=='select')this.pointerMove(x,y);
        this.drag=null;
        if(drag.kind==='create'){
            const width=Math.abs(drag.to.x-drag.point.x),height=Math.abs(drag.to.y-drag.point.y),frame=width>=10&&height>=8;
            const source=this.tool.lastTextStyle||{},data={...source,text:'',x:Math.round(frame?Math.min(drag.to.x,drag.point.x):drag.point.x),
                y:Math.round(frame?Math.min(drag.to.y,drag.point.y):drag.point.y),maxWidth:frame?clamp(Math.round(width),16,4096):0,frameHeight:frame?clamp(Math.round(height),16,4096):0,
                color:drag.color||source.color||'#FFFFFF',rotation:0,scaleX:1,scaleY:1,flipX:false,flipY:false};
            const layer=this.manager.addTextLayer('Текст: ""',data);if(!layer)return;
            layer.groupId=drag.parent?.isGroup?drag.parent.id:drag.parent?.groupId||null;
            try{this.tool.renderTextLayer(layer);this.open(layer,{created:true,previousId:drag.previousId,index:0});}
            catch(error){this.manager.removeLayer(layer.id);if(drag.previousId)this.manager.setActive(drag.previousId);throw error;}
        }else if(drag.kind==='resize'){
            if(drag.edit)this.history.record(drag.edit,this.snapshot());
            else if(JSON.stringify(drag.before.textData)!==JSON.stringify(drag.layer.textData))this.tool.history.push(new TextDataCommand(drag.layer,drag.before.textData,drag.layer.textData,this.bus));
            this.notify();
        }else{this.focus();this.ensureVisible();}
        this.render();
    }
    cancelGesture() {
        const drag=this.drag;this.drag=null;this.lastClick=null;
        if(drag?.kind==='resize'){restoreTextState(drag.layer,drag.before);if(drag.edit)this.restore(drag.edit);this.bus.emit('CANVAS_UPDATED');this.tool.syncUIWithLayer(drag.layer,{force:true});}
        this.render();
    }
    zoom(){return this.canvas.getBoundingClientRect().width/this.manager.config.width||1;}
    positionInput(){
        if(!this.active)return;const caret=caretPosition(this.tool.getTextLayout(this.layer),this.selection().focus,this.line),p=this.world(this.layer.textData,caret),r=this.canvas.getBoundingClientRect(),z=this.zoom();
        this.input.style.left=clamp(r.left+p.x*z,0,innerWidth-4)+'px';this.input.style.top=clamp(r.top+p.y*z,0,innerHeight-4)+'px';
    }
    ensureVisible(){
        if(!this.active||this.drag)return;const app=window.mollyEditor,w=app?.workspace;if(!w)return;
        const layout=this.tool.getTextLayout(this.layer),caret=caretPosition(layout,this.selection().focus,this.line);if(caret.line>=layout.visibleLines)return;
        const p=this.world(this.layer.textData,caret);if(p.x<0||p.y<0||p.x>this.manager.config.width||p.y>this.manager.config.height)return;
        const r=this.canvas.getBoundingClientRect(),v=this.workspace.getBoundingClientRect(),z=this.zoom(),x=r.left+p.x*z,y=r.top+p.y*z;
        const top=v.top+(this.workspace.querySelector('.doc-tab-bar')?.offsetHeight||30)+35,bottom=v.bottom-55;
        let dx=x<v.left+35?v.left+35-x:x>v.right-35?v.right-35-x:0,dy=y<top?top-y:y+layout.lineBoxHeight*z>bottom?bottom-y-layout.lineBoxHeight*z:0;
        if(dx||dy){w.autoFitOnResize=false;w.panX+=dx;w.panY+=dy;w.updateTransform();}
    }
    refresh(){
        if(this.active&&!this.manager.layers.includes(this.layer)){
            this.active=false;this.tool.inlineLayer=null;this.layer=null;this.drag=this.property=null;this.composing=false;this.history.clear();this.input.blur();this.tool.history.notifyChanged();
        }
        if(this.active&&!this.tool.canEditText(this.layer)){if(!this.composing)this.finish(true);return;}
        if(this.active&&this.input.value!==this.layer.textData.text){const range=this.selection();this.input.value=this.layer.textData.text;this.input.setSelectionRange(range.start,range.end,range.direction);}
        document.getElementById('text-edit-actions')?.toggleAttribute('hidden',!this.active);
        const hint=document.getElementById('text-tool-hint');if(hint)hint.hidden=this.active;
        for(const id of ['text-edit-apply','text-edit-cancel']){const button=document.getElementById(id);if(button)button.disabled=!!this.composing;}
        this.positionInput();this.render();
    }
    render(){
        if(this.overlayFrame||this.disposed)return;
        this.overlayFrame=requestAnimationFrame(()=>{this.overlayFrame=0;this.bus.emit('TEXT_OVERLAY_UPDATED',ctx=>this.draw(ctx));});
    }
    draw(ctx){
        const drag=this.drag,z=this.zoom();
        if(drag?.kind==='create'){ctx.strokeStyle='#93b9ff';ctx.lineWidth=1/z;ctx.setLineDash([4/z,3/z]);ctx.strokeRect(drag.point.x,drag.point.y,drag.to.x-drag.point.x,drag.to.y-drag.point.y);return;}
        const layer=this.active?this.layer:this.tool.toolManager.currentToolId==='text'?this.manager.getActiveLayer():null;
        if(!this.tool.canEditText(layer))return;
        const data=layer.textData,layout=this.tool.getTextLayout(layer),sx=(Number(data.scaleX)||1)*(data.flipX?-1:1),sy=(Number(data.scaleY)||1)*(data.flipY?-1:1);
        const m=textMatrix(data);ctx.save();ctx.transform(m.a,m.b,m.c,m.d,data.x,data.y);
        const ux=1/z/Math.abs(sx),uy=1/z/Math.abs(sy),width=data.maxWidth>0?layout.width:Math.max(16,layout.width);
        ctx.strokeStyle='#94baff';ctx.lineWidth=Math.min(ux,uy);ctx.setLineDash(this.active?[]:[4*ux,3*ux]);ctx.strokeRect(0,0,width,layout.height);ctx.setLineDash([]);
        if(data.maxWidth>0)for(const [x,y] of [[layout.width,layout.height/2],[layout.width,layout.height]]){
            ctx.fillStyle='#20324e';ctx.fillRect(x-3.5*ux,y-3.5*uy,7*ux,7*uy);ctx.strokeRect(x-3.5*ux,y-3.5*uy,7*ux,7*uy);
        }
        if(layout.overflow){ctx.fillStyle='#ff8c82';ctx.fillRect(width-10*ux,layout.height-10*uy,7*ux,7*uy);}
        if(this.active){
            const range=this.selection();ctx.save();if(data.maxWidth>0&&data.frameHeight>0){ctx.beginPath();ctx.rect(0,0,layout.width,layout.height);ctx.clip();}
            if(range.start!==range.end){ctx.fillStyle='#729df766';for(const row of layout.lines.slice(0,layout.visibleLines)){
                const cells=row.glyphs.filter(g=>g.end>range.start&&g.start<range.end);
                if(cells.length)ctx.fillRect(row.offset+cells[0].x,row.y,cells.at(-1).x+cells.at(-1).advance-cells[0].x,layout.lineBoxHeight);
                if(range.start<=row.end&&range.end>row.end&&layout.text[row.end]==='\n')ctx.fillRect(row.offset+row.width,row.y,3,layout.lineBoxHeight);
            }}else if(this.blink&&document.activeElement===this.input){
                const caret=caretPosition(layout,range.focus,this.line);if(caret.line<layout.visibleLines){
                    ctx.fillStyle='#17243d';ctx.fillRect(caret.x-ux,caret.y,ux*3,layout.lineBoxHeight);
                    ctx.fillStyle='#edf5ff';ctx.fillRect(caret.x,caret.y,ux,layout.lineBoxHeight);
                }
            }
            ctx.restore();
        }
        ctx.restore();
    }
}
