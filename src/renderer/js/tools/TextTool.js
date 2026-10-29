import {createGradientRow,createColorPreview,createHexInput} from '../ui/Controls.mjs';
import {bindAttribute} from '../core/Locale.mjs';
import { setPressedState } from '../ui/ControlState.js';
import Tool from './Tool.js';
import { TextDataCommand } from '../core/Commands.js';
import { fontMaps, normalizeBitmapText, bitmapGlyphOffsetY, resolveBitmapGlyph } from '../utils/FontData.js';
import { Palettes, populatePaletteSelect } from '../utils/Palettes.js';
import { captureGradientFocus, restoreGradientFocus } from '../ui/GradientFocus.js';
import {tokenizeBitmapText,layoutBitmapText} from '../graphics/BitmapTextLayout.mjs';
import {removeColorStop} from '../core/GradientStops.mjs';
import {editTextData} from '../graphics/TextEdit.mjs';
import CanvasTextEditor from '../ui/CanvasTextEditor.js';
import {textMatrix,textWorldPoint} from '../graphics/TextTransform.mjs';
import {normalizeText} from '../graphics/TextNavigation.mjs';

export default class TextTool extends Tool {
    constructor(bus, layerManager, history) {
        super(bus, layerManager, history);
        this.fontImages = {};
        this.activeFontId = 'minecraft';
        this.charWidth = 8;
        this.charHeight = 8;
        this.charsPerRow = 16;

        this.charWidthCache = new Map();
        this.tintCanvas = document.createElement('canvas');
        this.tintCanvas.width = 32;
        this.tintCanvas.height = 32;
        this.tintCtx = this.tintCanvas.getContext('2d', { willReadFrequently: true });

        this.activeGradientStopIndex = 0;
        this.activePalette = 'minecraft';

        this.preloadFonts();
        this.setupUIBindings();
        this.setupPalettesUI();
        this.setupInlineEditor();

        this.bus.on('RENDER_TEXT_LAYER', (layer) => this.renderTextLayer(layer));
        this.bus.on('LAYER_ACTIVE_CHANGED', () => {
            this.commitPendingEdit?.();
            const layer=this.layerManager.getActiveLayer();
            if (layer && layer.type === 'text' && layer.textData) {
                this.syncUIWithLayer(layer,{force:true});
            }else{
                document.getElementById('textGradientStopsList')?.replaceChildren();
                this.gradientRowsLayer=this.syncedTextLayer=null;
            }
        });
        this.bus.on('COLOR_CHANGED', color => {
            const active = this.layerManager.getActiveLayer();
            if (this.toolManager?.currentToolId !== 'text' || !this.canEditText(active)) return;
            this.capturePendingEdit?.();
            this.setSolidColor(active, color);
            this.commitStyleEdit?.();
            this.syncUIWithLayer(active);
        });
    }

    canEditText(layer) {
        return !!layer && layer.type === 'text' && !!layer.textData && !layer.locked
            && layer.visible !== false && (this.layerManager.isEditable?.(layer) ?? true);
    }

    changeTextData(layer, mutate, notify=true) {
        try{
            const next=structuredClone(layer.textData);
            mutate(next);
            if(JSON.stringify(next)===JSON.stringify(layer.textData))return true;
            editTextData(layer,next,()=>this.renderTextLayer(layer,notify));
            this.updateTextLayerName(layer);
            return true;
        }catch(error){
            console.error('Text edit failed:',error);
            this.syncUIWithLayer(layer,{force:true});this.bus.emit('LAYER_NAME_CHANGED',layer);this.bus.emit('CANVAS_UPDATED');
            globalThis.window?.mollyEditor?.showToast?.('Не удалось изменить текст. Предыдущее состояние сохранено.','error');
            return false;
        }
    }

    readHexField(input, fallback) {
        const raw=input.value.trim(),hex=(raw.startsWith('#')?raw:'#'+raw).toUpperCase();
        if(/^#[\da-f]{6}$/i.test(hex)){input.value=hex;return hex;}
        input.value=fallback||'#FFFFFF';
        globalThis.window?.mollyEditor?.showToast?.('Цвет должен содержать 6 символов HEX, например #A1B2C3.','warning');
        return null;
    }

    preloadFonts() {
        const fonts = [
            { id: 'minecraft', file: 'default.png' },
            { id: 'smallcaps', file: 'smallcaps.png' },
            { id: 'square', file: 'square.png' },
            { id: 'minecraft-ten', file: 'ten.png' },
            { id: 'other', file: 'other.png' }
        ];

        fonts.forEach(f => {
            const img = new Image();
            img.onload = () => {
                this.fontImages[f.id] = img;
                this.fontGeneration=(this.fontGeneration||0)+1;this.glyphCache?.clear();
                this.reRenderAllTextLayers();
            };
            img.onerror = () => console.error(`Unable to load bitmap font: ${f.file}`);
            img.src = `assets/images/${f.file}`;
        });
    }

    /* ==========================================================================
       COLOR SHADING & MATH (from buttons.html)
       ========================================================================== */
    hexToRgb(hex) {
        hex = hex.replace('#', '').trim();
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const num = parseInt(hex, 16);
        return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
    }

    rgbToHex(r, g, b) {
        return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('').toUpperCase();
    }

    rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;
        if (max === min) {
            h = s = 0;
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        return [h, s, l];
    }

    hslToRgb(h, s, l) {
        let r, g, b;
        if (s === 0) {
            r = g = b = l;
        } else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }
        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }

    calculateMinecraftShades(baseHex) {
        if (!baseHex) return { surface: '#FFFFFF', highlight: '#FFFFFF', shadow: '#7C7C7C', border: '#000000' };
        if (baseHex.toUpperCase() === '#C5C5C5') {
            return {
                surface: '#C5C5C5',
                highlight: '#ECECEC',
                shadow: '#7C7C7C',
                border: '#000000'
            };
        }
        const [r, g, b] = this.hexToRgb(baseHex);
        const [h, s, l] = this.rgbToHsl(r, g, b);

        const hl_l = Math.min(1.0, l + (1.0 - l) * 0.45);
        const hl_s = Math.max(0.0, s * 0.85);
        const [hl_r, hl_g, hl_b] = this.hslToRgb(h, hl_s, hl_l);

        const sh_l = Math.max(0.0, l * 0.63);
        const sh_s = Math.min(1.0, s * 1.05);
        const [sh_r, sh_g, sh_b] = this.hslToRgb(h, sh_s, sh_l);

        return {
            surface: baseHex.toUpperCase(),
            highlight: this.rgbToHex(hl_r, hl_g, hl_b),
            shadow: this.rgbToHex(sh_r, sh_g, sh_b),
            border: '#000000'
        };
    }

    updateMiniSwatches(baseHex) {
        const shades = this.calculateMinecraftShades(baseHex);
        const elBd = document.getElementById('textMiniSwatchBd');
        const elHl = document.getElementById('textMiniSwatchHl');
        const elSh = document.getElementById('textMiniSwatchSh');
        const elSf = document.getElementById('textMiniSwatchSf');
        if (elBd) { elBd.style.background = shades.border; elBd.dataset.color = shades.border; }
        if (elHl) { elHl.style.background = shades.highlight; elHl.dataset.color = shades.highlight; }
        if (elSh) { elSh.style.background = shades.shadow; elSh.dataset.color = shades.shadow; }
        if (elSf) { elSf.style.background = shades.surface; elSf.dataset.color = shades.surface; }
    }

    setupPalettesUI() {
        populatePaletteSelect(document.getElementById('textPaletteSelect'));
        this.renderPaletteSwatches(this.activePalette);
    }

    renderPaletteSwatches(palName) {
        const container = document.getElementById('textPaletteSwatchesGrid');
        if (!container) return;
        container.innerHTML = '';
        this.activePalette = palName;
        const list = Palettes[palName] || Palettes.minecraft;
        list.forEach(hex => {
            const btn = document.createElement('button');
            btn.type = 'button';
            bindAttribute(btn, "aria-label", "Выбрать цвет {0}", {0: hex});
            btn.className = 'swatch-btn';
            btn.style.backgroundColor = hex;
            btn.title = hex;
            btn.draggable = true;
            btn.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', hex);
                e.dataTransfer.effectAllowed = 'copy';
            });
            btn.addEventListener('click', () => {
                const active = this.layerManager.getActiveLayer();
                if (!this.canEditText(active)) return;
                this.capturePendingEdit?.();
                const mode = active.textData.colorMode || 'solid';
                if (mode === 'solid') {
                    this.setSolidColor(active, hex);
                } else {
                    this.setGradientStopColor(active, this.activeGradientStopIndex, hex);
                }
                this.commitStyleEdit?.();
            });
            container.appendChild(btn);
        });
    }

    setSolidColor(active, hex) {
        if (!this.canEditText(active)) return;
        if(typeof hex!=='string'||!/^#[\da-f]{6}$/i.test(hex))return false;
        const upper = hex.toUpperCase();
        if(!this.changeTextData(active,data=>{
            data.color=upper;if(data.shadowMode!=='custom')data.shadowColor=this.computeShadowColor(upper);
        }))return false;

        const colorInput = document.getElementById('textMasterColorInput');
        const hexInput = document.getElementById('textHexTextInput');
        if (colorInput) colorInput.value = upper;
        if (hexInput) hexInput.value = upper;

        this.updateMiniSwatches(upper);

        const autoPreview = document.getElementById('textShadowAutoColorPreview');
        const autoHex = document.getElementById('textShadowAutoColorHex');
        const autoShade = this.computeShadowColor(upper);
        if (autoPreview) autoPreview.style.background = autoShade;
        if (autoHex) autoHex.textContent = autoShade;

        return true;
    }

    setGradientStopColor(active, idx, hex, refresh = true) {
        if (!this.canEditText(active)) return;
        const colors=active.textData.gradientColors||['#3B82F6','#1D4ED8'];
        if(!Number.isInteger(idx)||idx<0||idx>=colors.length||typeof hex!=='string'||!/^#[\da-f]{6}$/i.test(hex))return false;
        if(!this.changeTextData(active,data=>{data.gradientColors=[...colors];data.gradientColors[idx]=hex.toUpperCase();}))return false;
        if (refresh) this.renderGradientStopsUI(active);
        return true;
    }

    setGradAngle(active, deg) {
        if (!this.canEditText(active)) return;
        const angle = Math.max(0, Math.min(360, parseInt(deg, 10) || 0));
        if(!this.changeTextData(active,data=>{data.gradientAngle=angle;}))return false;
        const input = document.getElementById('textGradAngleInput');
        const valText = document.getElementById('textGradAngleValText');
        if (input) input.value = angle;
        if (valText) valText.textContent = `${angle}°`;
        document.querySelectorAll('#textGradAngleChipsRow .m3-chip').forEach(c => {
            setPressedState(c, parseInt(c.dataset.angle, 10) === angle);
        });
        return true;
    }

    setupUIBindings() {
        const textInput = document.getElementById('text-input');
        const fontSelect = document.getElementById('font-select');
        const textSpacing = document.getElementById('text-spacing');
        const shadowToggle = document.getElementById('text-shadow-toggle');
        const shadowOffX = document.getElementById('text-shadow-ox');
        const shadowOffY = document.getElementById('text-shadow-oy');

        // Color & Gradient elements (from buttons.html)
        const segSolid = document.getElementById('textSegColorSolid');
        const segGrad = document.getElementById('textSegColorGradient');
        const solidColorInput = document.getElementById('textMasterColorInput');
        const hexTextInput = document.getElementById('textHexTextInput');
        const btnAddGradColor = document.getElementById('textBtnAddGradColor');
        const gradAngleInput = document.getElementById('textGradAngleInput');
        const paletteSelect = document.getElementById('textPaletteSelect');

        // Shadow mode elements
        const shadowOptions = document.getElementById('text-shadow-options');
        const segShadowAuto = document.getElementById('textSegShadowAuto');
        const segShadowCustom = document.getElementById('textSegShadowCustom');
        const shadowAutoSection = document.getElementById('textShadowAutoSection');
        const shadowCustomSection = document.getElementById('textShadowCustomSection');
        const shadowCustomColorInput = document.getElementById('textShadowCustomColorInput');
        const shadowCustomHexInput = document.getElementById('textShadowCustomHexInput');

        let beforeSnapshot = null;
        let snapshotLayer = null;
        let snapshotControl = null;
        const commitSnapshot = () => {
            if(this.canvasEditor?.active)return this.canvasEditor.commitProperty();
            const target = snapshotLayer;
            const before = beforeSnapshot;
            const invalid=snapshotControl?.getAttribute?.('aria-invalid')==='true';
            if(target?.textData&&before&&invalid){
                this.changeTextData(target,data=>{for(const key of Object.keys(data))delete data[key];Object.assign(data,before);});
                this.syncUIWithLayer(target,{force:true});
            }
            if (!invalid&&target?.textData && before && JSON.stringify(before) !== JSON.stringify(target.textData)) {
                this.history.push(new TextDataCommand(target, before, target.textData, this.bus));
            }
            beforeSnapshot = null;snapshotLayer = null;snapshotControl=null;
            return true;
        };
        const captureSnapshot = () => {
            if(this.canvasEditor?.active){this.canvasEditor.captureProperty();return;}
            const active = this.layerManager.getActiveLayer();
            if (!this.canEditText(active)) return;
            if (snapshotLayer && snapshotLayer !== active) commitSnapshot();
            if (!beforeSnapshot) {
                snapshotLayer = active;
                beforeSnapshot = JSON.parse(JSON.stringify(active.textData));
                snapshotControl=document.activeElement;
            }
        };
        this.capturePendingEdit = captureSnapshot;
        this.finishTextSnapshot=commitSnapshot;
        this.commitStyleEdit=commitSnapshot;
        this.commitPendingEdit = () => this.inlineLayer?this.closeInlineEditor(true):commitSnapshot();
        for(const [id,key,fallback] of [['text-wrap-width','maxWidth',0],['text-frame-height','frameHeight',0],['text-font-size','fontSize',8],['text-auto-leading','autoLeading',false],['text-line-height','lineHeight',10],['text-align','align','left'],['text-scale-x','scaleX',1],['text-scale-y','scaleY',1],['text-rotation','rotation',0]]){
            const input=document.getElementById(id);if(!input)continue;
            input.addEventListener('focus',captureSnapshot);
            const update=()=>{
                const active=this.layerManager.getActiveLayer();if(!this.canEditText(active))return;
                const valid=input.type==='checkbox'||input.tagName==='SELECT'||input.value!==''&&input.checkValidity()&&(!['scaleX','scaleY'].includes(key)||Number(input.value)>0);
                input.setAttribute('aria-invalid',String(!valid));if(!valid)return;
                captureSnapshot();this.changeTextData(active,data=>{
                    if(key==='autoLeading'&&!input.checked)data.lineHeight=this.getTextLayout(active).leading;
                    data[key]=input.type==='checkbox'?input.checked:key==='align'?input.value:Number(input.value);
                    if(key==='lineHeight')data.autoLeading=false;
                });
            };
            input.addEventListener(input.tagName==='SELECT'?'change':'input',update);
            input.addEventListener('change',commitSnapshot);
            input.addEventListener('blur',()=>{
                commitSnapshot();
                const active=this.layerManager.getActiveLayer();
                if(input.getAttribute('aria-invalid')==='true'&&active?.textData){input.value=active.textData[key]??fallback;input.removeAttribute('aria-invalid');}
            });
        }

        const updateActiveFromUI = event => {
            const active = this.layerManager.getActiveLayer();
            if (!this.canEditText(active)) return;
            const input=event?.target;
            if(input?.type==='number'&&(input.value===''||!input.checkValidity())){input.setAttribute('aria-invalid','true');return;}

            const key=new Map([[textInput,'text'],[fontSelect,'fontId'],[textSpacing,'letterSpacing'],[shadowToggle,'shadow'],[shadowOffX,'shadowOffsetX'],[shadowOffY,'shadowOffsetY']]).get(input);
            if(!key)return;
            input.removeAttribute('aria-invalid');captureSnapshot();
            this.changeTextData(active,data=>{
                data[key]=key==='text'?normalizeText(input.value):input.type==='number'?Number(input.value):input.type==='checkbox'?input.checked:input.value;
            });
        };

        [fontSelect, textSpacing, shadowOffX, shadowOffY, shadowCustomColorInput, solidColorInput, gradAngleInput].forEach(input => input?.addEventListener('blur', commitSnapshot));
        for(const [input,key,fallback] of [[textSpacing,'letterSpacing',0],[shadowOffX,'shadowOffsetX',1],[shadowOffY,'shadowOffsetY',1]])input?.addEventListener('blur',()=>{
            if(input.getAttribute('aria-invalid')==='true'){
                input.value=this.layerManager.getActiveLayer()?.textData?.[key]??fallback;input.removeAttribute('aria-invalid');
            }
        });
        textInput?.addEventListener('focus', captureSnapshot);
        textInput?.addEventListener('blur', commitSnapshot);
        textInput?.addEventListener('input', updateActiveFromUI);

        fontSelect?.addEventListener('focus', captureSnapshot);
        fontSelect?.addEventListener('change', event => {
            updateActiveFromUI(event);
            commitSnapshot();
        });

        textSpacing?.addEventListener('focus', captureSnapshot);
        textSpacing?.addEventListener('input', updateActiveFromUI);
        textSpacing?.addEventListener('change', commitSnapshot);

        shadowToggle?.addEventListener('change', event => {
            captureSnapshot();
            if (shadowOptions) {
                shadowOptions.style.display = shadowToggle.checked ? 'flex' : 'none';
            }
            updateActiveFromUI(event);
            commitSnapshot();
        });

        shadowOffX?.addEventListener('focus', captureSnapshot);
        shadowOffX?.addEventListener('input', updateActiveFromUI);
        shadowOffX?.addEventListener('change', commitSnapshot);

        shadowOffY?.addEventListener('focus', captureSnapshot);
        shadowOffY?.addEventListener('input', updateActiveFromUI);
        shadowOffY?.addEventListener('change', commitSnapshot);

        // Shadow mode segmented buttons
        segShadowAuto?.addEventListener('click', () => {
            const active = this.layerManager.getActiveLayer();
            if (!this.canEditText(active)) return;
            captureSnapshot();
            this.changeTextData(active,data=>{data.shadowMode='auto';data.shadowColor=this.computeShadowColor(data.color||'#FFFFFF');});
            this.syncUIWithLayer(active);
            commitSnapshot();
        });

        segShadowCustom?.addEventListener('click', () => {
            const active = this.layerManager.getActiveLayer();
            if (!this.canEditText(active)) return;
            captureSnapshot();
            this.changeTextData(active,data=>{data.shadowMode='custom';data.shadowCustomColor||='#000000';data.shadowColor=data.shadowCustomColor;});
            this.syncUIWithLayer(active);
            commitSnapshot();
        });

        // Custom shadow color inputs
        shadowCustomColorInput?.addEventListener('input', (e) => {
            const active = this.layerManager.getActiveLayer();
            if (!this.canEditText(active)) return;
            captureSnapshot();
            const upper = e.target.value.toUpperCase();
            if(this.changeTextData(active,data=>{data.shadowMode='custom';data.shadowCustomColor=upper;data.shadowColor=upper;})&&shadowCustomHexInput)shadowCustomHexInput.value=upper;
        });
        shadowCustomColorInput?.addEventListener('change', commitSnapshot);

        shadowCustomHexInput?.addEventListener('change', (e) => {
            const active=this.layerManager.getActiveLayer();if(!this.canEditText(active))return;
            const upper=this.readHexField(e.target,active.textData.shadowCustomColor||'#000000');if(!upper)return;
            captureSnapshot();
            if(this.changeTextData(active,data=>{data.shadowMode='custom';data.shadowCustomColor=upper;data.shadowColor=upper;})){
                if(shadowCustomColorInput)shadowCustomColorInput.value=upper;e.target.value=upper;
            }
            commitSnapshot();
        });

        // Mini swatches click handlers
        ['textMiniSwatchBd', 'textMiniSwatchHl', 'textMiniSwatchSh', 'textMiniSwatchSf'].forEach(id => {
            const el = document.getElementById(id);
            el?.addEventListener('click', () => {
                const active = this.layerManager.getActiveLayer();
                if (!active || active.type !== 'text' || !active.textData || !el.dataset.color) return;
                captureSnapshot();
                const mode = active.textData.colorMode || 'solid';
                if (mode === 'solid') {
                    this.setSolidColor(active, el.dataset.color);
                } else {
                    this.setGradientStopColor(active, this.activeGradientStopIndex, el.dataset.color);
                }
                commitSnapshot();
            });
        });

        // Segmented buttons switching
        segSolid?.addEventListener('click', () => {
            const active = this.layerManager.getActiveLayer();
            if (!this.canEditText(active)) return;
            captureSnapshot();
            this.changeTextData(active,data=>{data.colorMode='solid';});
            this.syncUIWithLayer(active);
            commitSnapshot();
        });

        segGrad?.addEventListener('click', () => {
            const active = this.layerManager.getActiveLayer();
            if (!this.canEditText(active)) return;
            captureSnapshot();
            this.changeTextData(active,data=>{
                data.colorMode='gradient';if(!data.gradientColors||data.gradientColors.length<2)data.gradientColors=['#3B82F6','#1D4ED8'];data.gradientAngle??=90;
            });
            this.syncUIWithLayer(active);
            commitSnapshot();
        });

        // Solid Color Inputs
        solidColorInput?.addEventListener('input', (e) => {
            const active = this.layerManager.getActiveLayer();
            if (!this.canEditText(active)) return;
            captureSnapshot();
            this.setSolidColor(active, e.target.value);
        });
        solidColorInput?.addEventListener('change', commitSnapshot);

        hexTextInput?.addEventListener('change', (e) => {
            const active=this.layerManager.getActiveLayer();if(!this.canEditText(active))return;
            const val=this.readHexField(e.target,active.textData.color);if(!val)return;
            captureSnapshot();this.setSolidColor(active,val);commitSnapshot();
        });

        // Add Gradient Stop
        btnAddGradColor?.addEventListener('click', () => {
            const active = this.layerManager.getActiveLayer();
            if (!this.canEditText(active)) return;
            if ((active.textData.gradientColors?.length||2) >= 8) return;
            captureSnapshot();
            if(!this.changeTextData(active,data=>{data.gradientColors??=['#3B82F6','#1D4ED8'];data.gradientColors.push(data.gradientColors.at(-1));}))return;
            this.activeGradientStopIndex = active.textData.gradientColors.length - 1;
            this.renderGradientStopsUI(active);
            commitSnapshot();
        });

        // Gradient Angle Slider & Chips
        gradAngleInput?.addEventListener('input', (e) => {
            const active = this.layerManager.getActiveLayer();
            if (!this.canEditText(active)) return;
            captureSnapshot();
            this.setGradAngle(active, e.target.value);
        });
        gradAngleInput?.addEventListener('change', commitSnapshot);

        document.querySelectorAll('#textGradAngleChipsRow .m3-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const active = this.layerManager.getActiveLayer();
                if (!this.canEditText(active)) return;
                captureSnapshot();
                this.setGradAngle(active, chip.dataset.angle);
                commitSnapshot();
            });
        });

        // Palette selector dropdown
        paletteSelect?.addEventListener('change', (e) => {
            this.renderPaletteSwatches(e.target.value);
        });
    }

    renderGradientStopsUI(layer,{force=false}={}) {
        const container = document.getElementById('textGradientStopsList');
        const bar = document.getElementById('textGradPreviewBar');
        if (!layer || !layer.textData) return;

        const colors = layer.textData.gradientColors || ['#3B82F6', '#1D4ED8'];

        if (bar) {
            bar.style.background = `linear-gradient(to right, ${colors.join(', ')})`;
        }
        if (!container) return;
        const focused=document.activeElement,rows=[...container.querySelectorAll('.grad-stop-row')];
        if(!force&&this.gradientRowsLayer===layer&&container.contains(focused)&&rows.length===colors.length){
            rows.forEach((row,index)=>{
                row.style.borderColor=index===this.activeGradientStopIndex?'var(--md-primary)':'var(--md-outline-variant)';
                row.querySelector('[data-gradient-role="select"]')?.setAttribute('aria-pressed',String(index===this.activeGradientStopIndex));
                row.querySelectorAll('input').forEach(input=>{if(input!==focused)input.value=colors[index];});
            });
            return;
        }
        this.gradientRowsLayer=layer;
        const focusToken = captureGradientFocus(container);
        container.innerHTML = '';

        colors.forEach((hex, idx) => {
            const row = createGradientRow(idx,idx===this.activeGradientStopIndex);

            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                row.style.borderColor = 'var(--md-primary)';
                row.style.backgroundColor = 'var(--md-surface-container-highest)';
            });
            row.addEventListener('dragleave', () => {
                row.style.borderColor = (idx === this.activeGradientStopIndex) ? 'var(--md-primary)' : 'var(--md-outline-variant)';
                row.style.backgroundColor = 'var(--md-surface-container-high)';
            });
            row.addEventListener('drop', (e) => {
                e.preventDefault();
                const color = e.dataTransfer.getData('text/plain');
                if (color && /^#[0-9A-Fa-f]{6}$/.test(color.trim())) {
                    this.capturePendingEdit?.();
                    this.setGradientStopColor(layer, idx, color.trim());
                    this.commitStyleEdit?.();
                }
            });
            row.addEventListener('click', e => {
                this.activeGradientStopIndex = idx;
                if (e.target === row || e.target === label) this.renderGradientStopsUI(layer);
            });

            const label = document.createElement('button');
            label.type = 'button'; label.className = 'md-icon-btn gradient-stop-select';
            label.dataset.gradientRole = 'select';
            bindAttribute(label, "aria-label", "Выбрать точку градиента {0}", {0: idx + 1});
            label.setAttribute('aria-pressed', String(idx === this.activeGradientStopIndex));
            label.style.fontFamily = "'Google Sans', sans-serif";
            label.style.fontSize = '0.74rem';
            label.style.color = 'var(--md-on-surface-variant)';
            label.style.minWidth = '14px';
            label.textContent = `${idx + 1}`;
            row.appendChild(label);

            const {circle,input:colInput} = createColorPreview(hex,26);
            colInput.id = `text-gradient-color-${idx}`;
            colInput.dataset.gradientRole = 'color';
            bindAttribute(colInput, "aria-label", "Цвет точки градиента {0}", {0: idx + 1});
            colInput.value = hex;
            colInput.addEventListener('input', (e) => {
                this.capturePendingEdit?.();
                if(this.setGradientStopColor(layer,idx,e.target.value,false))textInput.value=e.target.value;
            });
            colInput.addEventListener('change', () => this.commitStyleEdit?.());
            circle.appendChild(colInput);
            row.appendChild(circle);

            const textInput = createHexInput(hex);
            textInput.id = `text-gradient-hex-${idx}`;
            textInput.dataset.gradientRole = 'hex';
            bindAttribute(textInput, "aria-label", "HEX точки градиента {0}", {0: idx + 1});
            textInput.className = 'm3-text-field';
            textInput.spellcheck=false;textInput.autocomplete='off';
            textInput.value = hex;
            textInput.maxLength = 7;
            textInput.style.padding = '3px 8px';
            textInput.style.fontSize = '0.76rem';
            textInput.addEventListener('change', (e) => {
                if(!this.canEditText(layer))return;
                const val=this.readHexField(e.target,layer.textData.gradientColors?.[idx]);if(!val)return;
                this.capturePendingEdit?.();this.setGradientStopColor(layer,idx,val);this.commitStyleEdit?.();
            });
            row.appendChild(textInput);

            if (colors.length > 2) {
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'icon-btn';
                delBtn.style.padding = '0 4px';
                delBtn.style.height = '26px';
                delBtn.style.background = 'transparent';
                delBtn.style.border = 'none';
                delBtn.style.cursor = 'pointer';
                bindAttribute(delBtn, "title", 'Удалить');
                bindAttribute(delBtn, "aria-label", "Удалить точку градиента {0}", {0: idx+1});
                delBtn.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true" style="font-size: 16px; color: var(--md-on-surface-variant);">close</span>';
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!this.canEditText(layer)) return;
                    this.capturePendingEdit?.();
                    let activeStop=this.activeGradientStopIndex;
                    if(!this.changeTextData(layer,data=>{activeStop=removeColorStop(data.gradientColors,idx,activeStop)??activeStop;}))return;
                    this.activeGradientStopIndex=activeStop;
                    this.renderGradientStopsUI(layer);
                    this.commitStyleEdit?.();
                });
                row.appendChild(delBtn);
            }

            container.appendChild(row);
        });
        restoreGradientFocus(container, focusToken);
    }

    syncUIWithLayer(layer,{force=false}={}) {
        if (!layer || !layer.textData) return;
        const styleKeys=['fontId','fontSize','letterSpacing','lineHeight','autoLeading','align','colorMode','color','gradientColors','gradientAngle','shadow','shadowOffsetX','shadowOffsetY','shadowMode','shadowCustomColor','shadowColor'];
        this.lastTextStyle=Object.fromEntries(styleKeys.filter(key=>layer.textData[key]!==undefined).map(key=>[key,structuredClone(layer.textData[key])]));
        force ||= this.syncedTextLayer!==layer;this.syncedTextLayer=layer;
        const setValue=(input,value)=>{
            if(input&&(force||document.activeElement!==input)){
                if(input.value!==String(value))input.value=value;
                input.removeAttribute('aria-invalid');
            }
        };
        const textInput = document.getElementById('text-input');
        const fontSelect = document.getElementById('font-select');
        const textSpacing = document.getElementById('text-spacing');
        const shadowToggle = document.getElementById('text-shadow-toggle');
        const shadowOptions = document.getElementById('text-shadow-options');
        const shadowOffX = document.getElementById('text-shadow-ox');
        const shadowOffY = document.getElementById('text-shadow-oy');

        const segSolid = document.getElementById('textSegColorSolid');
        const segGrad = document.getElementById('textSegColorGradient');
        const solidSection = document.getElementById('textSolidColorSection');
        const gradSection = document.getElementById('textGradientColorSection');
        const solidColorInput = document.getElementById('textMasterColorInput');
        const hexTextInput = document.getElementById('textHexTextInput');
        const gradAngleInput = document.getElementById('textGradAngleInput');
        const gradAngleValText = document.getElementById('textGradAngleValText');

        const segShadowAuto = document.getElementById('textSegShadowAuto');
        const segShadowCustom = document.getElementById('textSegShadowCustom');
        const shadowAutoSection = document.getElementById('textShadowAutoSection');
        const shadowCustomSection = document.getElementById('textShadowCustomSection');
        const shadowAutoColorPreview = document.getElementById('textShadowAutoColorPreview');
        const shadowAutoColorHex = document.getElementById('textShadowAutoColorHex');
        const shadowCustomColorInput = document.getElementById('textShadowCustomColorInput');
        const shadowCustomHexInput = document.getElementById('textShadowCustomHexInput');

        setValue(textInput,layer.textData.text||'');setValue(fontSelect,layer.textData.fontId||'minecraft');setValue(textSpacing,layer.textData.letterSpacing??0);
        syncFontPreview(fontSelect);
        for(const [id,key,fallback] of [['text-wrap-width','maxWidth',0],['text-frame-height','frameHeight',0],['text-font-size','fontSize',8],['text-line-height','lineHeight',10],['text-align','align','left'],['text-scale-x','scaleX',1],['text-scale-y','scaleY',1],['text-rotation','rotation',0]]){
            setValue(document.getElementById(id),layer.textData[key]??fallback);
        }
        const autoLeading=document.getElementById('text-auto-leading');if(autoLeading)autoLeading.checked=layer.textData.autoLeading===true;
        const leadingInput=document.getElementById('text-line-height');if(leadingInput){leadingInput.disabled=layer.textData.autoLeading===true;if(leadingInput.disabled)setValue(leadingInput,this.getTextLayout(layer).leading);}
        const frame=(Number(layer.textData.maxWidth)||0)>0;
        for(const button of document.querySelectorAll('[data-text-kind]'))setPressedState(button,frame?button.dataset.textKind==='frame':button.dataset.textKind==='point');
        const frameInput=document.getElementById('text-frame-height');if(frameInput)frameInput.disabled=!frame;
        
        const hasShadow = layer.textData.shadow !== false;
        if (shadowToggle) shadowToggle.checked = hasShadow;
        if (shadowOptions) shadowOptions.style.display = hasShadow ? 'flex' : 'none';
        setValue(shadowOffX,layer.textData.shadowOffsetX??1);setValue(shadowOffY,layer.textData.shadowOffsetY??1);

        // Shadow mode
        const shadowMode = layer.textData.shadowMode || 'auto';
        setPressedState(segShadowAuto, shadowMode === 'auto');
        setPressedState(segShadowCustom, shadowMode === 'custom');
        if (shadowAutoSection) shadowAutoSection.style.display = (shadowMode === 'auto') ? 'flex' : 'none';
        if (shadowCustomSection) shadowCustomSection.style.display = (shadowMode === 'custom') ? 'flex' : 'none';

        const solidColor = (layer.textData.color || '#FFFFFF').toUpperCase();
        const autoShade = this.computeShadowColor(solidColor);
        if (shadowAutoColorPreview) shadowAutoColorPreview.style.background = autoShade;
        if (shadowAutoColorHex) shadowAutoColorHex.textContent = autoShade;

        const customColor = (layer.textData.shadowCustomColor || '#000000').toUpperCase();
        setValue(shadowCustomColorInput,customColor);setValue(shadowCustomHexInput,customColor);

        const mode = layer.textData.colorMode || 'solid';
        setPressedState(segSolid, mode === 'solid');
        setPressedState(segGrad, mode === 'gradient');
        if (solidSection) solidSection.style.display = mode === 'solid' ? 'flex' : 'none';
        if (gradSection) gradSection.style.display = mode === 'gradient' ? 'flex' : 'none';

        setValue(solidColorInput,solidColor);setValue(hexTextInput,solidColor);
        this.updateMiniSwatches(solidColor);

        const angle = layer.textData.gradientAngle !== undefined ? layer.textData.gradientAngle : 90;
        setValue(gradAngleInput,angle);
        if (gradAngleValText) gradAngleValText.textContent = `${angle}°`;
        document.querySelectorAll('#textGradAngleChipsRow .m3-chip').forEach(c => {
            setPressedState(c, parseInt(c.dataset.angle, 10) === angle);
        });

        if (mode === 'gradient') {
            this.renderGradientStopsUI(layer,{force});
        }
        this.updateTextWarning(this.getTextLayout(layer));
    }

    computeShadowColor(hex) {
        if (!hex) return '#3F3F3F';
        let c = hex.replace('#', '');
        if (c.length === 3) c = c.split('').map(x => x + x).join('');
        const num = parseInt(c, 16);
        const r = Math.floor(((num >> 16) & 255) * 0.25);
        const g = Math.floor(((num >> 8) & 255) * 0.25);
        const b = Math.floor((num & 255) * 0.25);
        return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
    }

    normalizeText(text, fontId) {
        return normalizeBitmapText(text, fontId);
    }

    calculateActualWidth(fontImg, srcX, srcY, w = 8, h = 8, cacheKey = null) {
        if (cacheKey && this.charWidthCache.has(cacheKey)) {
            return this.charWidthCache.get(cacheKey);
        }

        const canvas = this.tintCanvas;
        if (canvas.width < w || canvas.height < h) {
            canvas.width = Math.max(canvas.width, w);
            canvas.height = Math.max(canvas.height, h);
        }
        const ctx = this.tintCtx;
        ctx.clearRect(0, 0, w, h);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(fontImg, srcX, srcY, w, h, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h).data;

        let maxRightPixel = 0;
        for (let x = w - 1; x >= 0; x--) {
            for (let y = 0; y < h; y++) {
                const alphaIndex = (y * w + x) * 4 + 3;
                if (imgData[alphaIndex] > 0) { 
                    maxRightPixel = x + 1;
                    break;
                }
            }
            if (maxRightPixel > 0) break;
        }

        const result = maxRightPixel > 0 ? maxRightPixel : 4;
        if (cacheKey) {
            this.charWidthCache.set(cacheKey, result);
        }
        return result;
    }

    onPointerDown(x,y,color,size,layer,event) { this.canvasEditor.pointerDown(x,y,color,layer,event); }
    onPointerMove(x,y) { this.canvasEditor.pointerMove(x,y); }
    onPointerUp(x,y) { this.canvasEditor.pointerUp(x,y); }
    onHoverMove(x,y) { this.canvasEditor.hover({x,y}); }
    cancelAction() { this.canvasEditor.cancelGesture(); }
    deactivate() { return this.closeInlineEditor(true); }

    getGlyph(character,fontId) {
        this.glyphCache??=new Map();const key=fontId+'\0'+character;
        if(this.glyphCache.has(key))return this.glyphCache.get(key);
        let glyph;
        if(character===' ')glyph={width:3,offsetY:0};
        else if(fontId==='minecraft-ten'&&this.fontImages.other&&['Ё','Й'].includes(character)){
            const image=this.fontImages.other,w=image.width>16?Math.floor(image.width/2):8,h=image.height||10,sx=character==='Ё'?0:w;
            glyph={image,sx,sy:0,sourceW:w,sourceH:h,offsetY:-2,width:this.calculateActualWidth(image,sx,0,w,h,'other_'+character)};
        }else{
            const {fontId:activeFont,index}=resolveBitmapGlyph(character,fontId);
            if(index<0)glyph={width:4,offsetY:0,missing:true};
            else{
                const image=this.fontImages[activeFont],sx=index%16*8,sy=Math.floor(index/16)*8;
                if(!image)return {width:4,offsetY:0,pending:true};
                glyph={image,sx,sy,sourceW:8,sourceH:8,offsetY:bitmapGlyphOffsetY(activeFont,character),width:this.calculateActualWidth(image,sx,sy,8,8,activeFont+'_'+index)};
            }
        }
        this.glyphCache.set(key,glyph);return glyph;
    }

    setupInlineEditor() { this.canvasEditor=new CanvasTextEditor(this); }
    openInlineEditor(layer) { return this.canvasEditor.open(layer); }
    closeInlineEditor(apply=true) { return this.canvasEditor.finish(apply); }

    getTextLayout(layer) {
        const data=layer.textData;this.textLayouts??=new WeakMap();
        const signature=JSON.stringify([data.text,data.fontId,data.letterSpacing,data.maxWidth,data.frameHeight,data.fontSize,data.autoLeading,data.lineHeight,data.align,this.fontGeneration||0]);
        const old=this.textLayouts.get(layer);if(old?.signature===signature)return old.layout;
        const parsed=tokenizeBitmapText(data.text);
        parsed.tokens=parsed.tokens.flatMap(token=>[...this.normalizeText(token.char,data.fontId)].map(char=>({...token,char})));
        const spacing=Math.max(-8,Math.min(64,Number(data.letterSpacing)||0));
        const ratio=Math.max(6,Math.min(96,Number(data.fontSize)||8))/8;
        const leading=data.autoLeading?Math.round(10*ratio):data.lineHeight??Math.round(10*ratio);
        const layout=layoutBitmapText(parsed.tokens,char=>{const glyph=this.getGlyph(char,data.fontId);return {...glyph,offsetY:glyph.offsetY*ratio,advance:Math.max(1,(glyph.width+1)*ratio+spacing)};},
            {...data,lineHeight:leading,lineBoxHeight:10*ratio,sourceText:String(data.text??'')});
        layout.fontRatio=ratio;
        layout.missing=[...new Set(layout.glyphs.filter(g=>g.glyph.missing).map(g=>g.char))];layout.unsupportedStyles=parsed.unsupportedStyles;
        this.textLayouts.set(layer,{signature,layout});return layout;
    }

    renderTextLayer(layer,notify=true) {
        if(!layer||layer.type!=='text'||!layer.textData)return;
        const data=layer.textData;
        if(!this.fontImages[data.fontId]||!fontMaps[data.fontId])return;
        const layout=this.getTextLayout(layer);
        const scaleX=Math.max(Number.MIN_VALUE,Math.min(1000000,Number(data.scaleX)||1))*(data.flipX?-1:1),scaleY=Math.max(Number.MIN_VALUE,Math.min(1000000,Number(data.scaleY)||1))*(data.flipY?-1:1);
        const shadowX=data.shadow?Number(data.shadowOffsetX??1)||0:0,shadowY=data.shadow?Number(data.shadowOffsetY??1)||0:0;
        const left=Math.min(0,shadowX),top=Math.min(0,...layout.glyphs.map(g=>g.y))+Math.min(0,shadowY),right=layout.width+Math.max(0,shadowX),bottom=layout.height+Math.max(0,shadowY);
        const corners=[[left,top],[right,top],[left,bottom],[right,bottom]].map(([x,y])=>textWorldPoint(data,{x,y}));
        const x=Math.floor(Math.min(...corners.map(p=>p.x))+1e-8),y=Math.floor(Math.min(...corners.map(p=>p.y))+1e-8);
        const bounds={x,y,w:Math.max(1,Math.ceil(Math.max(...corners.map(p=>p.x))-1e-8)-x),h:Math.max(1,Math.ceil(Math.max(...corners.map(p=>p.y))-1e-8)-y)};
        const canvas=document.createElement('canvas');canvas.width=layer.width;canvas.height=layer.height;
        let ctx;
        try{
            ctx=canvas.getContext('2d',{willReadFrequently:true,alpha:true});ctx.imageSmoothingEnabled=false;
            ctx.save();
            try{
                ctx.translate(Number(data.x)||0,Number(data.y)||0);
                if(data.shearX){const m=textMatrix(data);ctx.transform(m.a,m.b,m.c,m.d,0,0);}
                else{ctx.rotate((Number(data.rotation)||0)*Math.PI/180);ctx.scale(scaleX,scaleY);}
                if(data.maxWidth>0&&data.frameHeight>0){ctx.beginPath();ctx.rect(0,0,layout.width,layout.height);ctx.clip();}
                if(data.shadow)this.drawLayoutPass(ctx,layout,data,true);
                this.drawLayoutPass(ctx,layout,data,false);
            }finally{ctx.restore();}
        }catch(error){canvas.width=canvas.height=1;throw error;}
        // Keep the previous canvas intact: an enclosing command or group edit
        // may still need it for rollback after another object's render fails.
        layer.canvas=canvas;layer.ctx=ctx;layer.textLayoutBounds=bounds;
        layer.invalidateSource?.();
        this.updateTextLayerName(layer);
        if(this.layerManager.getActiveLayer()===layer)this.updateTextWarning(layout);
        if(notify)this.bus.emit('CANVAS_UPDATED');
        this.canvasEditor?.refresh();
    }

    updateTextWarning(layout) {
        const target=document.getElementById('text-glyph-warning');if(!target)return;
        const parts=[];
        if(layout.missing.length)parts.push('Нет символов в шрифте: '+layout.missing.slice(0,12).join(' ')+(layout.missing.length>12?'…':''));
        if(layout.unsupportedStyles.length)parts.push('Коды начертания в этом bitmap-шрифте не применяются.');
        target.textContent=parts.join(' ');target.hidden=!parts.length;
        const overflow=document.getElementById('text-frame-overflow');if(overflow)overflow.hidden=!layout.overflow;
        const height=document.getElementById('text-fit-height');if(height)height.hidden=!layout.verticalOverflow;
        const width=document.getElementById('text-fit-width');if(width)width.hidden=!layout.horizontalOverflow;
    }

    updateTextLayerName(layer) {
        if(!/^Текст(?::|\s+\d+$)/.test(layer.name||''))return;
        const next=`Текст: "${String(layer.textData.text||'').replace(/\s+/g,' ').slice(0,16)}"`;
        if(layer.name!==next){layer.name=next;this.bus.emit('LAYER_NAME_CHANGED',layer);}
    }

    reRenderAllTextLayers() {
        let failures=0;
        for(const layer of this.layerManager.getLayers())if(layer.type==='text'){
            try{this.renderTextLayer(layer,false);}catch(error){failures++;console.error('Failed to refresh text layer:',error);}
        }
        if(failures)globalThis.window?.mollyEditor?.showToast?.(`Не удалось обновить текстовых слоёв: ${failures}. Предыдущие изображения сохранены.`,'warning');
        this.bus.emit('CANVAS_UPDATED');
    }

    drawLayoutPass(ctx,layout,data,shadow) {
        const gradient=data.colorMode==='gradient'&&Array.isArray(data.gradientColors)&&data.gradientColors.length>=2;
        const sx=shadow?(Number(data.shadowOffsetX??1)||0):0,sy=shadow?(Number(data.shadowOffsetY??1)||0):0;
        const base=data.color||'#FFFFFF',custom=data.shadowMode==='custom',shadowColor=data.shadowCustomColor||'#000000';
        const colorOf=color=>shadow?(custom?shadowColor:this.computeShadowColor(color)):color;
        const angle=(Number(data.gradientAngle??90)||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),W=layout.width,H=layout.height+2,length=Math.abs(W*c)+Math.abs(H*s);
        const x0=W/2-c*length/2,y0=H/2-s*length/2,x1=W/2+c*length/2,y1=H/2+s*length/2;
        const tint=this.tintCanvas,t=this.tintCtx;
        for(const placed of layout.glyphs){
            if(data.maxWidth>0&&data.frameHeight>0&&placed.line>=layout.visibleLines)continue;
            const glyph=placed.glyph;if(!glyph.image)continue;
            const w=glyph.sourceW,h=glyph.sourceH,ratio=layout.fontRatio||1;
            const corners=[[0,0],[w,0],[0,h],[w,h]].map(([dx,dy])=>{
                return textWorldPoint(data,{x:placed.x+sx+dx*ratio,y:placed.y+sy+dy*ratio});
            });
            if(Math.max(...corners.map(p=>p.x))<0||Math.max(...corners.map(p=>p.y))<0||Math.min(...corners.map(p=>p.x))>ctx.canvas.width||Math.min(...corners.map(p=>p.y))>ctx.canvas.height)continue;
            if(tint.width<w)tint.width=w;if(tint.height<h)tint.height=h;
            t.globalCompositeOperation='source-over';t.imageSmoothingEnabled=false;t.clearRect(0,0,tint.width,tint.height);
            t.drawImage(glyph.image,glyph.sx,glyph.sy,w,h,0,0,w,h);t.globalCompositeOperation='source-in';
            if(gradient){
                const paint=t.createLinearGradient((x0-placed.x)/ratio,(y0-placed.y-2)/ratio,(x1-placed.x)/ratio,(y1-placed.y-2)/ratio);
                data.gradientColors.forEach((color,index)=>paint.addColorStop(index/(data.gradientColors.length-1),colorOf(color)));
                t.fillStyle=paint;
            }else t.fillStyle=colorOf(placed.color||base);
            t.fillRect(0,0,w,h);t.globalCompositeOperation='source-over';
            ctx.drawImage(tint,0,0,w,h,placed.x+sx,placed.y+sy,w*ratio,h*ratio);
        }
    }
}
import {syncFontPreview} from '../ui/FontPreview.js';
