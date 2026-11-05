import ButtonRenderer,{BUTTON_STYLES,normalizeButtonStyle} from '../graphics/ButtonRenderer.js';
import {bindText,bindAttribute} from '../core/Locale.mjs';
import {removeColorStop} from '../core/GradientStops.mjs';
import {normalizeButtonData} from '../core/ButtonDocument.mjs';
import InspectorTabs from './InspectorTabs.js';

/** Shared color state; the window and modal provide their own DOM renderers. */
export default class ButtonGeneratorModel extends ButtonRenderer {
    constructor() {
        super();
        this.colorMode = 'solid';
        this.autoShadeEnabled = true;
        this.masterBaseColor = '#C5C5C5';
        this.gradientColors = ['#3B82F6', '#1D4ED8'];
        this.activeGradientStopIndex = 0;
        this.gradientAngle = 90;
        this.autoFitPreview=true;
        this.colors = {border: '#000000', highlight: '#ECECEC', shadow: '#7C7C7C', surface: '#C5C5C5'};
    }

    setupInspector(root,id){
        if(this.inspectorTabs)return;
        const scroll=root.querySelector('.buttons-sidebar-scroll-area'),cards=[...scroll.querySelectorAll(':scope > .m3-card')];
        this.inspectorTabs=new InspectorTabs(scroll,[
            {key:'size',label:'Размер',icon:'grid_on',nodes:[cards[0]]},
            {key:'style',label:'Стиль',icon:'smart_button',nodes:[cards[1]]},
            {key:'color',label:'Цвет',icon:'palette',nodes:[cards[2]]}
        ],{id});
        this.previewRoot=root;this.previewStage=root.querySelector('.canvas-stage');
        const fit=document.createElement('button');fit.type='button';fit.className='icon-btn';fit.dataset.generatorFit='true';bindText(fit,'По экрану');
        fit.addEventListener('click',()=>{this.autoFitPreview=true;this.updateView();});
        root.querySelector('.viewport-toolbar .toolbar-group').append(fit);
        this.previewResizeObserver=new ResizeObserver(()=>{if(this.autoFitPreview)this.updateView();});this.previewResizeObserver.observe(this.previewStage);
    }

    syncPreviewZoom(){
        if(this.autoFitPreview&&this.previewStage.clientWidth&&this.previewStage.clientHeight){
            const style=getComputedStyle(this.previewStage),width=this.previewStage.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)-4,height=this.previewStage.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom)-4;
            this.currentZoom=Math.max(1,Math.min(4,Math.floor(Math.min(width/176,height/222))));
        }
        for(const button of this.previewRoot.querySelectorAll('.viewport-toolbar .icon-btn')){
            const active=button.hasAttribute('data-generator-fit')?this.autoFitPreview:!this.autoFitPreview&&Number(button.dataset.z)===this.currentZoom;
            button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
        }
    }

    syncStyleControls(root,prefix='') {
        this.currentStyle=normalizeButtonStyle(this.currentStyle);
        const get=name=>{const id=prefix?prefix+name[0].toUpperCase()+name.slice(1):name;return root.querySelector?.('#'+id);};
        for(const style of BUTTON_STYLES){
            const button=get('segStyle'+style[0].toUpperCase()+style.slice(1)),active=this.currentStyle===style;
            button?.classList.toggle('active',active);button?.setAttribute('aria-pressed',String(active));
        }
        const contour=['outline','double'].includes(this.currentStyle),chin=get('chinInput');
        if(chin)chin.closest('.control-group').hidden=this.currentStyle!=='ten';
        const tinted=get('tintedBorderCheck');if(tinted)tinted.closest('.m3-switch-row').hidden=this.currentStyle==='outline';
        const thickness=get('shadowInput');
        if(thickness){
            bindText(thickness.closest('.control-group').querySelector('.control-label-row > span'),contour?'Толщина контура:':'Толщина фаски:');
            bindAttribute(thickness,'aria-label',contour?'Толщина контура, px':'Толщина фаски, px');
        }
    }

    updateShading() {
        if (this.colorMode === 'solid') {
            if (this.autoShadeEnabled) this.colors = this.calculateMinecraftShades(this.masterBaseColor, this.tintedBorderEnabled);
            else this.colors.surface = this.masterBaseColor;
        }
        this.updateMiniSwatches();
    }

    addGradientStop() {
        if (this.gradientColors.length >= 8) return false;
        this.gradientColors.push(this.gradientColors.at(-1));
        this.activeGradientStopIndex = this.gradientColors.length - 1;
        this.renderGradientStopsUI(); this.updateView();
        return true;
    }

    removeGradientStop(index) {
        const active = removeColorStop(this.gradientColors, index, this.activeGradientStopIndex);
        if (active === null) return false;
        this.activeGradientStopIndex = active;
        this.renderGradientStopsUI(); this.updateView();
        return true;
    }

    setGradientStopColor(index, color) {
        if (!Number.isInteger(index) || index < 0 || index >= this.gradientColors.length
            || typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color)) return false;
        const hex = color.toUpperCase();
        if (this.gradientColors[index] === hex) return false;
        this.gradientColors[index] = hex;
        this.renderGradientStopsUI(); this.updateView();
        return true;
    }

    createButtonData() {
        const w = this.getWidth(this.currentCols), h = this.getHeight(this.currentRows);
        const canvas = this.renderButton(w, h, this.colors, this.currentStyle,
            this.currentOpacity, this.transparentBorder, this.currentChin, this.currentShadow);
        try {
            return {
                importId: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
                w, h, cols: this.currentCols, rows: this.currentRows,
                slotMode: this.currentSlotMode, guiCol: this.guiCol, guiRow: this.guiRow,
                style: this.currentStyle, mode: 'normal', normalDataUrl: canvas.toDataURL('image/png'),
                buttonData:normalizeButtonData({width:w,height:h,style:this.currentStyle,colorMode:this.colorMode,baseColor:this.masterBaseColor,
                    autoShade:this.autoShadeEnabled,tintedBorder:this.tintedBorderEnabled,transparentBorder:this.transparentBorder,
                    opacity:this.currentOpacity,chin:this.currentChin,bevel:this.currentShadow,gradientAngle:this.gradientAngle,gradientColors:this.gradientColors,colors:this.colors})
            };
        } finally {
            canvas.width = canvas.height = 1;
        }
    }
}
