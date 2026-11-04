const fs = require('node:fs/promises');
const path = require('node:path');
const {app, root, ready, makeWindow, evaluateMain, settle} = require('./lib/electron-harness.cjs');

(async () => {
    const windows = [], checks = [];
    const expect = (value, message) => { if (!value) throw Error(message);checks.push(message); };
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
        await ready();
        const home = makeWindow();windows.push(home);
        await home.loadFile(path.join(root, 'src/renderer/index.html'));
        await home.showInactive();
        await home.cdp.send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'no-preference'}]});
        await home.page.evaluate(async () => {
            const {WeatherSurface} = await import(new URL('js/ui/AmbientWeather.js', location.href));
            const paint = WeatherSurface.prototype.paint;
            window.weatherPaints = 0;
            WeatherSurface.prototype.paint = function () { window.weatherPaints++;if (!this.preview) window.weatherSurface = this;return paint.call(this); };
            const {default: SettingsManager} = await import(new URL('js/core/SettingsManager.js', location.href));
            window.weatherSettings = new SettingsManager();
            weatherSettings.set('animationsEnabled', true);
            weatherSettings.set('weatherEffect', 'rain');
        });
        await home.page.waitForFunction(() => window.weatherPaints > 2);
        expect(await home.page.evaluate(() => document.querySelectorAll('#ambient-weather').length === 1
            && getComputedStyle(document.querySelector('#ambient-weather')).pointerEvents === 'none'), 'Weather has one noninteractive overlay');
        const settings = makeWindow(960, 760, {label: 'settings'});windows.push(settings);
        await settings.loadFile(path.join(root, 'src/renderer/settings.html'));
        await settings.page.click('#settings-tab-effects');
        await settings.showInactive();
        await settings.cdp.send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'no-preference'}]});
        await settings.page.evaluate(async () => {
            const {WeatherSurface} = await import(new URL('js/ui/AmbientWeather.js', location.href));
            const paint = WeatherSurface.prototype.paint;
            window.previewPaints = 0;
            WeatherSurface.prototype.paint = function () { if (this.preview) { window.previewPaints++;window.previewSurface = this; }return paint.call(this); };
        });
        await settings.page.locator('.weather-settings').scrollIntoViewIfNeeded();
        for(const theme of ['dark','light','minecraft','light-minecraft'])for(const effect of ['none','rain','snow','leaves']){
            await home.page.evaluate(({theme,effect})=>{weatherSettings.set('theme',theme);weatherSettings.set('weatherEffect',effect);},{theme,effect});
            await settings.page.waitForFunction(effect=>document.querySelector(`[data-weather-effect="${effect}"]`).getAttribute('aria-pressed')==='true',effect);
            const visible=await settings.page.locator('[data-leaf-options]').isVisible();
            expect(visible===(effect==='leaves'),'Leaf varieties visible only for selected leaves: '+theme+' / '+effect);
        }
        await home.page.evaluate(()=>{weatherSettings.set('theme','dark');weatherSettings.set('weatherEffect','rain');});
        await settings.page.waitForFunction(()=>document.querySelector('[data-weather-effect="rain"]').getAttribute('aria-pressed')==='true');
        await settings.page.hover('[data-weather-effect="leaves"]');
        await settings.page.waitForFunction(()=>window.previewSurface?.field?.effect==='leaves');
        expect(await home.page.evaluate(()=>weatherSettings.get('weatherEffect')==='rain'),'Hover previews a different effect without applying it to other windows');
        expect(!await settings.page.locator('[data-leaf-options]').isVisible(),'Hover preview does not expose unrelated leaf controls');
        await settings.page.focus('[data-weather-effect="snow"]');
        await settings.page.waitForFunction(()=>previewSurface.field.effect==='snow');
        expect(await home.page.evaluate(()=>weatherSettings.get('weatherEffect')==='rain'),'Keyboard focus previews weather without changing the saved effect');
        await settings.page.click('[data-weather-effect="snow"]');
        await home.page.waitForFunction(() => weatherSettings.get('weatherEffect') === 'snow');
        expect(await settings.page.locator('[data-weather-effect="snow"]').getAttribute('aria-pressed') === 'true', 'Weather selection synchronizes between native windows');
        await settings.page.waitForFunction(() => { const canvas = document.querySelector('.weather-preview-canvas');return !canvas.hidden && canvas.width > 1; });
        expect(await settings.page.evaluate(() => document.querySelector('#ambient-weather').hidden), 'Home-only mode keeps settings clear while its live preview runs');
        await settings.page.selectOption('#setting-weather-density', 'dense');
        await home.page.waitForFunction(() => weatherSettings.get('weatherDensity') === 'dense');
        await home.page.waitForFunction(() => weatherSurface.blend === 1);
        await home.page.evaluate(() => { window.originalWeatherParticle = weatherSurface.field.particles[0]; });
        await settings.page.evaluate(() => {
            const input = document.querySelector('[data-weather-range="weatherSpeed"]');
            input.value = '150';input.dispatchEvent(new Event('input', {bubbles: true}));
        });
        expect(await settings.page.evaluate(() => previewSurface.settings.weatherSpeed === 150)
            && await home.page.evaluate(() => weatherSettings.get('weatherSpeed') === 100), 'Dragging adjusts the preview before committing shared settings');
        await settings.page.evaluate(() => document.querySelector('[data-weather-range="weatherSpeed"]').dispatchEvent(new Event('change', {bubbles: true})));
        await home.page.waitForFunction(() => weatherSettings.get('weatherSpeed') === 150);
        for (const [key, value] of [['weatherWind', 70], ['weatherOpacity', 40]]) {
            await settings.page.evaluate(({key, value}) => {
                const input = document.querySelector(`[data-weather-range="${key}"]`);
                input.value = String(value);input.dispatchEvent(new Event('input', {bubbles: true}));input.dispatchEvent(new Event('change', {bubbles: true}));
            }, {key, value});
            await home.page.waitForFunction(({key, value}) => weatherSettings.get(key) === value, {key, value});
        }
        expect(await home.page.evaluate(() => weatherSurface.field.speedFactor === 1.5 && weatherSurface.field.wind === .7 && weatherSurface.opacity === .4
            && weatherSurface.field.particles.includes(originalWeatherParticle)), 'Speed, wind and visibility update without restarting the particle field');
        await settings.page.locator('.weather-preview').scrollIntoViewIfNeeded();
        await settings.page.waitForFunction(() => window.previewSurface && !previewSurface.canvas.hidden);
        await settings.page.click('[data-weather-pause]');
        let previewCount = await settings.page.evaluate(() => previewPaints);await delay(180);
        expect(await settings.page.evaluate(() => previewSurface.previewPaused && !previewSurface.canvas.hidden && previewPaints) === previewCount
            && await home.page.evaluate(() => weatherSurface.frame !== 0), 'Preview pause freezes its image while the main-menu weather continues');
        await settings.page.click('[data-weather-pause]');
        await settings.page.waitForFunction(count => previewPaints > count, previewCount);
        await settings.page.click('[data-weather-reset]');
        await home.page.waitForFunction(() => weatherSettings.get('weatherSpeed') === 100 && weatherSettings.get('weatherWind') === -15 && weatherSettings.get('weatherOpacity') === 75);
        expect(await home.page.evaluate(() => weatherSettings.get('weatherEffect') === 'snow' && weatherSettings.get('weatherDensity') === 'normal'), 'Reset restores effect parameters while preserving the selected weather');
        expect(await home.page.evaluate(() => {
            const outgoing = weatherSurface.field;
            weatherSettings.set('weatherEffect', 'leaves');
            return weatherSurface.previousField === outgoing && weatherSurface.field.effect === 'leaves' && weatherSurface.blend < 1;
        }), 'Switching weather crossfades the outgoing and incoming particle fields');
        await home.page.waitForFunction(() => weatherSurface.blend === 1 && weatherSurface.previousField === null);
        for (const season of ['spring','summer','autumn','all']) {
            await settings.page.selectOption('#setting-weather-leaves',season);
            await home.page.waitForFunction(season=>weatherSurface.settings.weatherLeaves===season,season);
        }
        expect(true,'Leaf season selection synchronizes between preview and main window');
        expect(true, 'The completed crossfade releases its outgoing particle field');
        expect(await home.page.evaluate(()=>getComputedStyle(weatherSurface.canvas).zIndex==='30'&&weatherSurface.obstacles.index.shapes.length>0),'Weather remains visible above panels with protected control regions');
        const clip=await home.page.locator('#btn-hero-create').evaluate(button=>{const r=button.getBoundingClientRect();return {x:r.x+15,y:r.y+12,width:r.width-30,height:r.height-24};});
        await home.page.evaluate(()=>weatherSurface.stop());
        const buttonBefore=await home.page.screenshot({clip});
        await home.page.evaluate(()=>{
            const surface=weatherSurface,r=document.querySelector('#btn-hero-create').getBoundingClientRect();window.weatherParticlesBeforeProtection=surface.field.particles;
            surface.field.particles=[{...surface.field.particles[0],x:r.left+r.width/2,y:r.top+r.height/2,size:4}];surface.paint();
        });
        expect(buttonBefore.equals(await home.page.screenshot({clip})),'Weather leaves the button interior unchanged');
        expect(await home.page.evaluate(()=>{
            const c=weatherSurface.canvas,pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
            weatherSurface.field.particles=weatherParticlesBeforeProtection;return !pixels.some((value,index)=>index%4===3&&value)&&weatherSurface.obstacles.visibility(document.querySelector('#btn-hero-create').getBoundingClientRect().left+50,document.querySelector('#btn-hero-create').getBoundingClientRect().top+20)===0;
        }),'A particle entirely inside a button is fully transparent');
        expect(await home.page.evaluate(()=>weatherSurface.particleScale===2),'Weather particles default to double their previous size');
        await settings.page.locator('[data-weather-range="weatherSize"]').evaluate(input=>{input.value='300';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
        await home.page.waitForFunction(()=>weatherSurface.particleScale===3);
        expect(await home.page.evaluate(()=>weatherSettings.get('weatherSize')===300&&weatherSurface.particleScale===3),'Particle size can be changed manually and synchronizes between windows');
        await settings.page.locator('[data-weather-range="weatherSize"]').evaluate(input=>{input.value='200';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
        expect(await home.page.evaluate(async()=>{
            const scroller=document.querySelector('.workspace-layout'),grid=document.querySelector('.launcher-grid-layout');grid.style.paddingBottom='1400px';
            // Freeze natural motion so scrolling is the only possible source of displacement.
            weatherSurface.stop();
            const fields=[weatherSurface.field,weatherSurface.previousField].filter(Boolean);
            const positions=()=>fields.map(field=>field.particles.map(p=>[p.x,p.y]));
            const before=JSON.stringify(positions());
            scroller.scrollTop=180;await new Promise(resolve=>setTimeout(resolve,80));
            const stable=scroller.scrollTop>0&&JSON.stringify(positions())===before;
            scroller.scrollTop=0;grid.style.paddingBottom='';weatherSurface.sync();return stable;
        }),'Scrolling content does not displace current or transitioning weather particles');
        await settings.page.selectOption('#setting-weather-density', 'dense');
        const editor = makeWindow(1200, 800, {label: 'buttons'});windows.push(editor);
        await editor.loadFile(path.join(root, 'src/renderer/editor.html'), {query: {new: 'true', type: 'canvas', width: '32', height: '32', name: 'Weather QA'}});
        await editor.showInactive();
        await editor.cdp.send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'no-preference'}]});
        await editor.page.evaluate(async () => {
            const {WeatherSurface}=await import(new URL('js/ui/AmbientWeather.js',location.href));
            const paint=WeatherSurface.prototype.paint;
            WeatherSurface.prototype.paint=function(){if(!this.preview)window.weatherSurface=this;return paint.call(this);};
            const app = window.mollyEditor;
            const layer = app.layerManager.addLayer('Art');
            layer.ctx.fillStyle = '#BA7831';layer.ctx.fillRect(3, 4, 9, 8);layer.invalidateSource();
            window.beforeWeatherPng = app.renderer.exportToPNG();
            window.beforeWeatherProject = JSON.stringify(app.projectManager.serializeProject());
        });
        await settings.page.selectOption('#setting-weather-scope', 'all');
        await editor.page.waitForFunction(() => !document.querySelector('#ambient-weather').hidden);
        await delay(180);
        expect(await editor.page.evaluate(() => {
            const app = window.mollyEditor;
            return beforeWeatherPng === app.renderer.exportToPNG()
                && beforeWeatherProject === JSON.stringify(app.projectManager.serializeProject());
        }), 'Weather never modifies saved project or exported PNG pixels');
        expect(await editor.page.evaluate(() => {
            const surface=window.weatherSurface,work=document.querySelector('#workspace').getBoundingClientRect(),canvas=document.querySelector('#canvas-wrapper').getBoundingClientRect();
            surface.obstacles.invalidate();surface.obstacles.update();
            return surface.obstacles.visibility(canvas.left+canvas.width/2,canvas.top+canvas.height/2)===0;
        }), 'The project canvas remains protected from weather');
        expect(await editor.page.evaluate(()=>{
            const scene=window.weatherSurface.obstacles,work=document.querySelector('#workspace').getBoundingClientRect();
            for(let y=work.top+60;y<work.bottom-40;y+=20)for(let x=work.left+30;x<work.right-30;x+=20)if(scene.visibility(x,y)!==0)return false;
            return true;
        }),'The entire canvas workspace, including the empty background, hides weather');
        expect(await editor.page.evaluate(()=>{
            const scene=window.weatherSurface.obstacles;
            return ['.top-bar','.options-bar','#main-toolbar'].every(selector=>{
                const r=document.querySelector(selector).getBoundingClientRect();
                for(let y=r.top+3;y<r.bottom-3;y+=3)for(let x=r.left+3;x<r.right-3;x+=3)if(scene.visibility(x,y)===1)return true;
                return false;
            });
        }),'Weather can appear in free space in the top and left toolbars');
        expect(await editor.page.evaluate(()=>{
            const r=document.querySelector('#main-right-panel').getBoundingClientRect(),scene=window.weatherSurface.obstacles;
            for(let y=r.top+3;y<r.bottom-3;y+=3)for(let x=r.left+3;x<r.right-3;x+=3)if(scene.visibility(x,y)===1)return true;
            return false;
        }),'Weather can appear in free inspector background between protected panels');
        await settings.page.selectOption('#setting-weather-scope', 'home');
        await home.page.evaluate(() => weatherSettings.set('animationsEnabled', false));
        await home.page.waitForFunction(() => document.querySelector('#ambient-weather').hidden);
        let count = await home.page.evaluate(() => weatherPaints);await delay(180);
        expect(await home.page.evaluate(() => weatherPaints) === count, 'Turning animations off stops drawing completely');
        await home.page.evaluate(() => weatherSettings.set('animationsEnabled', true));
        await home.page.waitForFunction(() => !document.querySelector('#ambient-weather').hidden);
        await home.cdp.send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'reduce'}]});
        await home.page.waitForFunction(() => document.querySelector('#ambient-weather').hidden);
        count = await home.page.evaluate(() => weatherPaints);await delay(180);
        expect(await home.page.evaluate(() => weatherPaints) === count, 'System reduced-motion preference stops the animation loop');
        await home.cdp.send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'no-preference'}]});
        await home.page.waitForFunction(() => !document.querySelector('#ambient-weather').hidden);
        await evaluateMain(() => globalThis.__mollyTestRuntime.windows.get('main').hide());
        await home.page.waitForFunction(() => document.querySelector('#ambient-weather').hidden);
        count = await home.page.evaluate(() => weatherPaints);await delay(180);
        expect(await home.page.evaluate(() => weatherPaints) === count, 'Native hidden windows stop drawing even with background throttling disabled');
        await home.showInactive();
        await home.page.waitForFunction(() => !document.querySelector('#ambient-weather').hidden);
        await evaluateMain(() => globalThis.__mollyTestRuntime.windows.get('main').minimize());
        await home.page.waitForFunction(() => document.querySelector('#ambient-weather').hidden);
        count = await home.page.evaluate(() => weatherPaints);await delay(180);
        expect(await home.page.evaluate(() => weatherPaints) === count, 'Minimized windows stop drawing');
        await evaluateMain(() => globalThis.__mollyTestRuntime.windows.get('main').restore());
        await home.page.waitForFunction(() => !document.querySelector('#ambient-weather').hidden);
        await home.cdp.send('Emulation.setDeviceMetricsOverride', {width: 3840, height: 2160, deviceScaleFactor: 2, mobile: false});
        await delay(180);
        expect(await home.page.evaluate(() => { const canvas = document.querySelector('#ambient-weather');return canvas.width * canvas.height <= 4e6; }), 'HiDPI 4K windows respect the backing-store memory budget');
        await home.page.evaluate(() => weatherSettings.set('weatherQuality', 'economy'));
        expect(await home.page.evaluate(() => weatherSurface.canvas.width * weatherSurface.canvas.height <= 1.2e6 && weatherSurface.field.particles.length <= 132
            && weatherSurface.budget.fps(weatherSettings.get('weatherQuality')) === 30), 'Economy mode lowers resolution, particle population and frame rate');
        await home.page.evaluate(() => weatherSettings.set('weatherQuality', 'auto'));
        await home.resize();
        await fs.mkdir(path.join(root, '.test-output/weather'), {recursive: true});
        for (const theme of ['dark', 'light', 'minecraft', 'light-minecraft']) {
            for (const effect of ['rain', 'snow', 'leaves']) {
                await home.page.evaluate(({theme, effect}) => { weatherSettings.set('theme', theme);weatherSettings.set('weatherEffect', effect); }, {theme, effect});
                await settings.page.waitForFunction(effect => document.querySelector(`[data-weather-effect="${effect}"]`).getAttribute('aria-pressed') === 'true', effect);
                await settings.page.locator('.weather-settings').scrollIntoViewIfNeeded();
                await delay(450);
                await settle(settings);
                await fs.writeFile(path.join(root, `.test-output/weather/${theme}-${effect}.png`), (await settings.webContents.capturePage()).toPNG());
                if (theme === 'dark') {
                    await settle(home);
                    await fs.writeFile(path.join(root, `.test-output/weather/menu-${effect}.png`), (await home.webContents.capturePage()).toPNG());
                }
            }
        }
        expect(true, 'All three effects render in dark, light and both Minecraft themes');
        await home.page.evaluate(() => weatherSettings.set('language', 'en'));
        await settings.page.waitForFunction(() => document.querySelector('#weather-settings-title').textContent === 'Atmospheric effects');
        expect((await settings.page.locator('[data-weather-effect="leaves"]').innerText()).includes('Leaves'), 'Weather settings translate live into English');
        expect((await settings.page.locator('#setting-weather-leaves').innerText()).includes('Summer leaves'), 'Season choices translate live into English');
        await settings.page.selectOption('#setting-weather-quality', 'economy');
        await settings.page.locator('.weather-parameters').scrollIntoViewIfNeeded();
        await fs.writeFile(path.join(root, '.test-output/weather/controls-en.png'), (await settings.webContents.capturePage()).toPNG());
        settings.setContentSize(760, 560);await settle(settings);
        expect(await settings.page.evaluate(() => {
            const section = document.querySelector('.weather-settings');
            return section.scrollWidth <= section.clientWidth + 1 && [...section.querySelectorAll('input,select,button')].every(control => {
                const rect = control.getBoundingClientRect(), parent = section.getBoundingClientRect();
                return rect.left >= parent.left && rect.right <= parent.right;
            });
        }), 'Weather controls stay inside the panel in the minimum-size settings window');
        await fs.writeFile(path.join(root, '.test-output/weather/controls-compact.png'), (await settings.webContents.capturePage()).toPNG());
        await settings.page.evaluate(() => { window.retiredPreview = previewSurface; });
        await settings.page.click('#settings-tab-about');
        previewCount = await settings.page.evaluate(() => previewPaints);await delay(180);
        expect(await settings.page.evaluate(() => retiredPreview.disposed && retiredPreview.canvas.width === 1 && previewPaints) === previewCount,
            'Leaving the settings section disposes the preview and stops its callbacks');
        await settings.page.click('#settings-tab-effects');
        await settings.page.locator('.weather-settings').scrollIntoViewIfNeeded();
        await settings.page.click('[data-weather-effect="none"]');
        await home.page.waitForFunction(() => document.querySelector('#ambient-weather').hidden);
        expect(await home.page.evaluate(() => { const canvas = document.querySelector('#ambient-weather'),mask=weatherSurface.obstacles.mask;return canvas.width===1&&canvas.height===1&&mask.width===1&&mask.height===1; }), 'Disabling releases both particle and opacity-mask surfaces');
        for (const window of windows) if (window.__testErrors.length) throw Error(window.__testErrors.join('\n'));
        await fs.writeFile(path.join(root, '.test-output/weather/report.json'), JSON.stringify({passed: checks.length, checks}, null, 2));
        console.log(JSON.stringify({passed: checks.length, checks}, null, 2));
    } catch (error) { console.error(error);process.exitCode = 1; }
    finally { for (const window of windows) window.destroy();app.exit(process.exitCode || 0); }
})();
