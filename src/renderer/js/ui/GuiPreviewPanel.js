import {drawLayers} from '../graphics/LayerCompositing.js';
import {getExportRegion} from '../graphics/ExportImage.js';
import {paintPixelPreview,alignPixelPreview,watchPixelRatio} from '../graphics/PixelPreview.mjs';

/** Game backdrop belongs to preview only; document and PNG export stay transparent. */
export default class GuiPreviewPanel {
    constructor(app) {
        this.app = app;
        app.bus.on('PROJECT_SWITCHED', () => this.syncButton());
        app.bus.on('CANVAS_UPDATED', () => {
            this.queueRender();
        });
        globalThis.window?.addEventListener?.('resize',()=>this.queueRender());
        this.stopWatchingRatio=watchPixelRatio(()=>this.queueRender());
        document.getElementById('btn-preview-gui')?.addEventListener('click', () => this.open());
    }

    queueRender(){
        if(!this.dialog?.open||this.renderFrame)return;
        this.renderFrame=requestAnimationFrame(()=>{this.renderFrame=null;if(this.dialog?.open)this.render();});
    }

    syncButton() {
        const button = document.getElementById('btn-preview-gui');
        if (button) button.hidden = this.app.getActiveProject()?.type !== 'gui';
    }

    create() {
        if (this.dialog) return;
        const dialog = document.createElement('dialog');
        dialog.className = 'gui-preview-dialog';
        dialog.setAttribute('aria-labelledby', 'gui-preview-heading');
        dialog.innerHTML = `<header><h2 id="gui-preview-heading"><!--i18n-->GUI в Minecraft</h2><button type="button" class="md-icon-btn" data-game-close aria-label="Закрыть предпросмотр" data-i18n-aria-label="%D0%97%D0%B0%D0%BA%D1%80%D1%8B%D1%82%D1%8C%20%D0%BF%D1%80%D0%B5%D0%B4%D0%BF%D1%80%D0%BE%D1%81%D0%BC%D0%BE%D1%82%D1%80"><i class="material-symbols-rounded" aria-hidden="true">close</i></button></header>
            <div class="gui-preview-stage"><img src="assets/images/preview/minecraft.png" alt="" aria-hidden="true"><div class="gui-preview-viewport"><div class="gui-preview-content"><canvas aria-label="Меню на фоне игрового мира" data-i18n-aria-label="%D0%9C%D0%B5%D0%BD%D1%8E%20%D0%BD%D0%B0%20%D1%84%D0%BE%D0%BD%D0%B5%20%D0%B8%D0%B3%D1%80%D0%BE%D0%B2%D0%BE%D0%B3%D0%BE%20%D0%BC%D0%B8%D1%80%D0%B0"></canvas></div></div></div>
            <footer><output role="status"></output><button type="button" class="md-btn primary" data-game-close><!--i18n-->Готово</button></footer>`;
        document.body.append(dialog);
        this.dialog = dialog;
        this.stage = dialog.querySelector('.gui-preview-stage');
        this.canvas = dialog.querySelector('canvas');
        dialog.querySelector('.gui-preview-viewport').addEventListener('scroll',()=>alignPixelPreview(this.canvas),{passive:true});
        this.observer=new ResizeObserver(()=>{
            if(!dialog.open)return;const key=[this.stage.clientWidth,this.stage.clientHeight,devicePixelRatio].join(':');
            if(key!==this.sizeKey){this.sizeKey=key;this.queueRender();}
        });this.observer.observe(this.stage);
        dialog.querySelectorAll('[data-game-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
        dialog.addEventListener('close', () => {
            if (dialog.open) return;
            cancelAnimationFrame(this.renderFrame);this.renderFrame=null;
            this.canvas.width = this.canvas.height = 1;
            this.returnFocus?.isConnected && this.returnFocus.focus({preventScroll:true});
        });
    }

    async open() {
        const project=this.app.getActiveProject();
        if (project?.type !== 'gui') return false;
        if (this.app.tools.finishDocument({preserveSelection:true}) === false) return false;
        try { await project.templateLoadPromise; }
        catch(error) {this.app.showToast(error.message||'Не удалось подготовить шаблон GUI.','error');return false;}
        if(this.app.getActiveProject()!==project)return false;
        this.create();
        this.returnFocus = document.activeElement;
        if (!this.dialog.open) this.dialog.showModal();
        try {
            await this.dialog.querySelector('img').decode();
            if (!this.dialog.open) return false;
            this.render();
            Promise.allSettled(this.dialog.getAnimations().map(animation=>animation.finished)).then(()=>{if(this.dialog.open)alignPixelPreview(this.canvas);});
            return true;
        } catch {
            this.dialog.close();
            this.app.showToast('Не удалось загрузить фон Minecraft.','error');
            return false;
        }
    }

    render() {
        if (this.app.getActiveProject()?.type !== 'gui') {this.dialog.close();return;}
        const source = document.createElement('canvas');
        source.width = this.app.config.width;source.height = this.app.config.height;
        try {
            drawLayers(source.getContext('2d',{willReadFrequently:true}),this.app.layerManager.getLayers());
            const region = getExportRegion(source,true);
            const scale = 1.5;
            const size=paintPixelPreview(this.canvas,source,{region,scale});
            const content=this.dialog.querySelector('.gui-preview-content');
            content.style.width=`${size.width+24}px`;
            content.style.height=`${size.height+24}px`;
            this.stage.style.minHeight=`min(${region.height*scale+24}px, 60dvh)`;
            this.dialog.querySelector('output').textContent = `${region.width} × ${region.height} px · 1,5×`;
            alignPixelPreview(this.canvas);
        } finally {source.width = source.height = 1;}
    }
}
