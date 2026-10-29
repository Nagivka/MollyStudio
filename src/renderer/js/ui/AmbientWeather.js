import {WeatherParticles} from '../core/WeatherParticles.mjs';
import {WeatherFrameBudget} from '../core/WeatherFrameBudget.mjs';
import WeatherObstacles from './WeatherObstacles.js';
import {naturalLeaf, naturalSnow, naturalRain} from './WeatherArtwork.js';
import {leafSeason, summerLeafPixels, springLeafPixels} from '../core/WeatherLeaves.mjs';
import {drawWeatherBitmap} from '../core/WeatherBitmap.mjs';

const controllers = new WeakMap();
const leafColors = ['#DA8938', '#C85B3B', '#D9AD45', '#A96D3A'];
const leafPixels = ['00010000', '01011010', '01111110', '11111111', '01111110', '00011000', '00001000', '00001000'];
const pixelLeaves = [leafPixels, ['00011000','00111100','01111110','01111110','00111100','00111100','00011000','00001000'], ['00010000','00111000','01111100','11111110','01111100','00111000','00010000','00010000']];
const leafSprites = new Map();
const weatherTextures={leaves:{autumn:[],spring:[],summer:[]},snow:[],rain:[]};
let texturesStarted=false;
function loadTextures(){
    if(texturesStarted||typeof Image==='undefined')return;texturesStarted=true;
    for(const color of ['orange','red','yellow'])for(let variant=1;variant<=4;variant++){
        const image=new Image();
        image.onload=()=>{
            weatherTextures.leaves.autumn.push(image);
            for(const [season,recolor] of [['summer',summerLeafPixels],['spring',springLeafPixels]]){
                const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
                const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
                const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);recolor(pixels.data);ctx.putImageData(pixels,0,0);
                weatherTextures.leaves[season].push(canvas);
            }
        };
        image.src=new URL(`../../assets/weather/leaves/Fall/${color}_poplar_${variant}.png`,import.meta.url).href;
    }
    for(let variant=0;variant<6;variant++){
        const image=new Image();image.onload=()=>{
            const tile={image,x:0,y:0,size:image.width};
            weatherTextures.snow.push(tile);
        };
        image.src=new URL(`../../assets/weather/snow/freezing_${variant}.png`,import.meta.url).href;
    }
    for(const effect of ['snow','rain']){
        const image=new Image();
        image.onload=()=>{
            const tile=effect==='snow'?8:16,canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
            const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
            for(let y=0;y<image.height;y+=tile)for(let x=0;x<image.width;x+=tile){
                const pixels=ctx.getImageData(x,y,tile,tile).data;
                if(pixels.some((value,index)=>index%4===3&&value>32))weatherTextures[effect].push({image,x,y,size:tile});
            }
            canvas.width=canvas.height=1;
        };
        image.src=new URL(`../../assets/weather/${effect}.png`,import.meta.url).href;
    }
}
function pixelLeaf(particle,season='autumn') {
    const key = season+':'+(particle.variant%pixelLeaves.length * leafColors.length + particle.color);
    if (!leafSprites.has(key)) {
        const sprite = document.createElement('canvas');sprite.width = sprite.height = 8;
        const ctx = sprite.getContext('2d');ctx.fillStyle = season==='spring'?'#D980AD':season==='summer'?'#649D48':leafColors[particle.color];
        const pixels = pixelLeaves[particle.variant%pixelLeaves.length];
        for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) if (pixels[row][col] === '1') ctx.fillRect(col, row, 1, 1);
        ctx.fillStyle = '#87542F';ctx.fillRect(3, 4, 1, 3);
        leafSprites.set(key, sprite);
    }
    return leafSprites.get(key);
}
/** One decorative surface per window; previews have an explicit disposal owner. */
export class WeatherSurface {
    constructor(canvas, {preview = false} = {}) {
        loadTextures();
        this.canvas = canvas;
        this.preview = preview;
        this.ctx = canvas.getContext('2d', {alpha: true});
        this.frame = 0;
        this.lastTime = 0;
        this.lastStepTime = 0;
        this.budget = new WeatherFrameBudget();
        this.blend = 1;
        this.previousField = null;
        this.previewPaused = false;
        this.settings = {};
        this.disposed = false;
        this.obstacles=new WeatherObstacles(canvas,{preview});
        this.scrollPositions=new WeakMap();
        if(!preview)for(const element of document.querySelectorAll('.workspace-layout,.settings-win-content-scroll,.buttons-sidebar-scroll-area,.right-panel')){
            this.scrollPositions.set(element,{x:element.scrollLeft||0,y:element.scrollTop||0});
        }
        this.onScroll=event=>{
            const element=event.target===document?document.scrollingElement:event.target;
            if(!element||this.preview)return;
            const current={x:element.scrollLeft||0,y:element.scrollTop||0},previous=this.scrollPositions.get(element)||{x:0,y:0};
            this.scrollPositions.set(element,current);
            this.field?.scrollBy(current.x-previous.x,current.y-previous.y);
            this.previousField?.scrollBy(current.x-previous.x,current.y-previous.y);
        };
        if(!preview){
            document.addEventListener('scroll',this.onScroll,true);
        }
        this.nativeVisible = !window.desktopAPI?.isVisible;
        let visibilityRevision = 0;
        this.stopVisibilityListener = window.desktopAPI?.onWindowVisibilityChange?.(visible => {
            visibilityRevision++;
            this.nativeVisible = visible === true;
            this.sync();
        });
        const initialRevision = visibilityRevision;
        window.desktopAPI?.isVisible?.().then(visible => {
            if (this.disposed || initialRevision !== visibilityRevision) return;
            this.nativeVisible = visible === true;
            this.sync();
        }).catch(() => {});
        this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
        this.refresh = () => this.sync();
        this.onPageHide = () => this.stop();
        this.drawFrame = time => {
            this.frame = 0;
            if (this.disposed || !this.field || this.previewPaused) return;
            const interval = 1000 / this.budget.fps(this.settings.weatherQuality);
            const elapsed = time - this.lastTime;
            if (!this.lastTime || elapsed >= interval - .5) {
                const started = performance.now();
                const dt = this.lastStepTime ? Math.min(.05, (time - this.lastStepTime) / 1000) : 0;
                this.field.step(dt);this.previousField?.step(dt);
                this.blend = Math.min(1, this.blend + dt / .4);
                if (this.blend === 1) this.previousField = null;
                this.lastTime = this.lastTime ? time - Math.max(0, elapsed % interval) : time;
                this.lastStepTime = time;
                this.paint();
                this.budget.sample(performance.now() - started);
            }
            this.frame = requestAnimationFrame(this.drawFrame);
        };
        canvas.setAttribute('aria-hidden', 'true');
        canvas.setAttribute('role', 'presentation');
        this.resizeObserver = new ResizeObserver(() => this.sync());
        this.resizeObserver.observe(preview ? canvas.parentElement : document.documentElement);
        this.workspace = preview ? null : document.querySelector('#workspace');
        if (this.workspace) this.resizeObserver.observe(this.workspace);
        this.themeObserver = new MutationObserver(this.refresh);
        this.themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme', 'class']});
        this.reducedMotion.addEventListener('change', this.refresh);
        document.addEventListener('visibilitychange', this.refresh);
        window.addEventListener('resize', this.refresh);
        window.addEventListener('pagehide', this.onPageHide);
        window.addEventListener('pageshow', this.refresh);
        if (preview) {
            this.inView = false;
            this.intersectionObserver = new IntersectionObserver(entries => {
                this.inView = entries[0]?.isIntersecting === true;
                this.sync();
            });
            this.intersectionObserver.observe(canvas.parentElement);
        }
    }

    configure(settings) {
        this.settings = settings;
        this.sync();
    }

    setPaused(paused) {
        if (!this.preview) return;
        this.previewPaused = paused === true;
        this.sync();
    }

    sync() {
        if (this.disposed || !this.ctx) return;
        this.obstacles.invalidate();
        const {weatherEffect = 'none', weatherDensity = 'normal', weatherScope = 'home', animationsEnabled = true} = this.settings;
        const isHome = /(?:\/|\/index\.html)$/.test(location.pathname);
        const allowed = weatherEffect !== 'none' && animationsEnabled && !this.reducedMotion.matches
            && !document.hidden && this.nativeVisible && (this.preview ? this.inView : weatherScope === 'all' || isHome);
        if (!allowed) {
            this.stop();
            this.canvas.hidden = true;
            if (weatherEffect === 'none') this.field = null;
            this.previousField = null;
            this.blend = 1;
            this.canvas.width = this.canvas.height = 1;
            this.obstacles.releaseMask();
            return;
        }
        this.canvas.hidden = false;
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) { this.stop();return; }
        this.canvasRect = rect;
        const theme = document.documentElement.dataset.theme || 'dark';
        this.pixelated = theme === 'minecraft' || theme === 'light-minecraft';
        this.light = theme.startsWith('light');
        // Cap each surface (particles and cached opacity mask) at 4 million pixels.
        const pixelBudget = this.settings.weatherQuality === 'economy' ? 1.2e6 : 4e6;
        const scale = Math.min(this.pixelated ? 1 : devicePixelRatio || 1, 2, Math.sqrt(pixelBudget / (rect.width * rect.height)));
        const width = Math.max(1, Math.floor(rect.width * scale)), height = Math.max(1, Math.floor(rect.height * scale));
        const changed = this.canvas.width !== width || this.canvas.height !== height;
        if (changed) { this.canvas.width = width;this.canvas.height = height; }
        this.scale = scale;
        if (!this.field || this.field.effect !== weatherEffect) {
            this.previousField = this.previewPaused ? null : this.field;
            this.field = new WeatherParticles(weatherEffect, weatherDensity, rect.width, rect.height);
            this.blend = this.previewPaused ? 1 : 0;
        }
        for (const field of [this.field, this.previousField]) if (field) {
            field.configure(this.settings);
            field.resize(rect.width, rect.height);
        }
        this.opacity = Math.max(.15, Math.min(1, (this.settings.weatherOpacity ?? 75) / 100));
        this.particleScale=Math.max(.25,Math.min(4,(this.settings.weatherSize??200)/100));
        this.paint();
        if (this.previewPaused) { this.stop();return; }
        if (!this.frame) { this.lastTime = 0;this.frame = requestAnimationFrame(this.drawFrame); }
    }

    paint() {
        const ctx = this.ctx;
        ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width / this.scale, this.canvas.height / this.scale);
        ctx.imageSmoothingEnabled = !this.pixelated;
        this.obstacles.update();
        this.canvasRect=this.canvas.getBoundingClientRect();
        if (this.previousField) this.paintField(this.previousField, 1 - this.blend);
        this.paintField(this.field, this.blend);
        ctx.globalAlpha = 1;
        this.obstacles.apply(ctx,{width:this.canvas.width,height:this.canvas.height,scale:this.scale,origin:this.canvasRect});
    }

    paintField(field, weight) {
        if (weight <= 0) return;
        const ctx = this.ctx;
        for (const particle of field.particles) {
            const x = this.pixelated ? Math.round(particle.x) : particle.x;
            const y = this.pixelated ? Math.round(particle.y) : particle.y;
            const alpha = this.opacity * weight * Math.max(0, Math.min(1, (particle.y + 10) / 22, (field.height - particle.y + 24) / 24));
            ctx.globalAlpha = (.24 + particle.depth * .38) * alpha;
            if (field.effect === 'rain') {
                ctx.strokeStyle = ctx.fillStyle = this.light ? '#426886' : '#98BCD6';
                const length = (8 + particle.depth * 14)*this.particleScale;
                const dx = length * particle.vx / particle.speed;
                if (this.pixelated) {
                    const tile=weatherTextures.rain[particle.variant%weatherTextures.rain.length];
                    if(tile){
                        drawWeatherBitmap(ctx,tile.image,x,y,length,{scale:this.scale||1,source:tile});
                        continue;
                    }
                    const steps = Math.max(1, Math.ceil(Math.abs(dx)));
                    for (let step = 0; step < steps; step++) ctx.fillRect(x + Math.round(dx * step / steps), y + Math.round(length * step / steps), Math.max(1,Math.round(this.particleScale)), Math.ceil(length / steps));
                } else {
                    ctx.save();ctx.translate(x,y);ctx.rotate(-Math.atan2(dx,length));
                    const width=(.65+particle.depth*.6)*this.particleScale;
                    ctx.drawImage(naturalRain(this.light),-width*2,0,width*4,Math.hypot(dx,length));ctx.restore();
                }
            } else if (field.effect === 'snow') {
                ctx.fillStyle = this.light ? '#90AEC6' : '#E4EFF8';
                if (this.pixelated) {
                    const tile=weatherTextures.snow[particle.variant%weatherTextures.snow.length];
                    if(tile){drawWeatherBitmap(ctx,tile.image,x,y,particle.size*2*this.particleScale,{scale:this.scale||1,source:tile});continue;}
                    const size = Math.max(1,Math.round(particle.size*this.particleScale));
                    ctx.fillRect(x, y, size, size);
                    if (size >= 4) { ctx.fillStyle = '#F5FAFF';ctx.fillRect(x + 1, y + 1, size - 2, size - 2); }
                } else {
                    const size=particle.size*this.particleScale*2;
                    ctx.drawImage(naturalSnow(particle.variant,this.light),x-size/2,y-size/2,size,size);
                }
            } else if (field.effect === 'leaves') {
                const season=leafSeason(this.settings?.weatherLeaves,particle.variant);
                const textures=weatherTextures.leaves[season];
                ctx.fillStyle = leafColors[particle.color];
                ctx.globalAlpha = (.55 + particle.depth * .3) * alpha;
                if (this.pixelated) {
                    const texture=textures[Math.floor(particle.variant/3)%textures.length];
                    const sprite=texture||pixelLeaf(particle,season);
                    drawWeatherBitmap(ctx,sprite,x,y,particle.size*this.particleScale,{scale:this.scale||1,rotation:particle.rotation,flip:Math.sin(particle.phase+field.time*.7)<0});
                } else {
                    const size = particle.size*this.particleScale;
                    ctx.save();ctx.translate(x,y);ctx.rotate(particle.rotation);
                    ctx.drawImage(naturalLeaf(particle.variant,particle.color,season),-size*.8,-size*.8,size*1.6,size*1.6);ctx.restore();
                }
            }
        }
    }

    stop() {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
        this.lastTime = 0;
        this.lastStepTime = 0;
    }

    dispose() {
        this.disposed = true;
        this.stop();
        this.stopVisibilityListener?.();
        this.resizeObserver.disconnect();this.themeObserver.disconnect();this.intersectionObserver?.disconnect();
        document.removeEventListener('scroll',this.onScroll,true);this.obstacles.dispose();
        this.reducedMotion.removeEventListener('change', this.refresh);
        document.removeEventListener('visibilitychange', this.refresh);
        window.removeEventListener('resize', this.refresh);
        window.removeEventListener('pagehide', this.onPageHide);
        window.removeEventListener('pageshow', this.refresh);
        this.canvas.width = this.canvas.height = 1;
        this.field = null;
        this.previousField = null;
    }
}

export function syncAmbientWeather(settings) {
    if (typeof document === 'undefined' || !document.body) return;
    let surface = controllers.get(document);
    if (!surface) {
        if (settings.weatherEffect === 'none' || !settings.weatherEffect) return;
        const canvas = document.createElement('canvas');
        canvas.id = 'ambient-weather';canvas.className = 'ambient-weather';
        document.body.append(canvas);
        surface = new WeatherSurface(canvas);
        controllers.set(document, surface);
    }
    surface.configure(settings);
    window.dispatchEvent(new Event('molly-weather-changed'));
}
