const fs = require('node:fs/promises');
const path = require('node:path');
const {app, root, ready, makeWindow, settle} = require('./lib/electron-harness.cjs');

// Render actual application classes, then exercise native pointer/keyboard
// input. Geometry assertions catch clipping and state-dependent layout jumps.
(async () => {
    let win;
    const checks = [], timer = setTimeout(() => app.exit(1), 180000);
    const output = path.join(root, '.test-output/minecraft-controls');
    try {
        await fs.mkdir(output, {recursive: true});
        await ready(); win = makeWindow(1100, 800);
        await win.loadFile(path.join(root, 'src/renderer/index.html'));
        await win.showInactive();
        await win.page.evaluate(() => {
            const fixture = document.createElement('section');
            fixture.id = 'bedrock-fixture';
            fixture.style.cssText = 'position:fixed;inset:24px;width:calc(100% - 48px);height:calc(100% - 48px);z-index:10000;overflow:auto;display:grid;align-content:start;gap:24px;padding:24px;background:var(--md-surface-container);';
            fixture.innerHTML = `
                <h2 style="margin:0">Minecraft · Контролы</h2>
                <div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap">
                    <label class="md-switch"><input id="lever" type="checkbox"><span class="md-switch-track"><span class="md-switch-thumb"></span></span><span>Переключатель</span></label>
                    <label class="m3-switch"><input id="disabled-lever" type="checkbox" disabled><span class="m3-switch-track"><span class="m3-switch-thumb"></span></span><span>Недоступно</span></label>
                </div>
                <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
                    <button id="action" class="md-btn primary"><span>Создать</span></button>
                    <button class="md-btn"><span>Импортировать</span></button>
                    <button class="md-btn danger"><span>Удалить</span></button>
                    <button id="disabled-action" class="md-btn" disabled><span>Недоступно</span></button>
                </div>
                <div class="m3-segmented-button" role="group" aria-label="Сложность">
                    <button class="m3-segment-item active" aria-pressed="true">Мирно</button>
                    <button class="m3-segment-item" aria-pressed="false">Нормально</button>
                    <button class="m3-segment-item" disabled>Недоступно</button>
                </div>
                <div class="inspector-tabs" style="display:flex"><button class="inspector-tab active" role="tab" aria-selected="true">Свойства</button><button class="inspector-tab" role="tab" aria-selected="false">Слои</button></div>
                <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px">
                    <input id="text-field" class="md-input" value="Мой проект" aria-label="Название">
                    <select id="chooser" class="md-select" aria-label="Режим"><option>Длинное название режима</option><option>Другой режим</option></select>
                </div>
                <input id="scale" type="range" min="0" max="5" value="2" aria-label="Масштаб" style="width:100%;margin:16px 0">
                <button class="ui-disclosure-trigger" aria-expanded="false">Техническая информация<span class="ui-disclosure-indicator"></span></button>`;
            fixture.querySelectorAll('.m3-segment-item:not(:disabled)').forEach(button => button.addEventListener('click', () => {
                fixture.querySelectorAll('.m3-segment-item').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
            }));
            document.body.append(fixture);
        });
        for (const theme of ['minecraft', 'light-minecraft']) {
            for (const density of ['editor', 'settings']) {
                for (const [width, height, zoom] of [[1100,800,1], [1000,760,1.25], [960,720,1.5]]) {
                    win.setContentSize(width, height); win.webContents.setZoomFactor(zoom);
                    await win.page.evaluate(({theme,density}) => {
                        document.documentElement.dataset.theme = theme;
                        document.documentElement.classList.add('no-animations');
                        document.querySelector('#bedrock-fixture').className = density === 'settings' ? 'settings-win-shell' : '';
                        document.querySelector('#lever').checked = false;
                    }, {theme,density});
                    await settle(win);
                    const before = await win.page.evaluate(() => {
                        const rect = element => { const r = element.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; };
                        const track = document.querySelector('#lever + span'), thumb = track.firstElementChild;
                        const rows = [...document.querySelectorAll('.m3-segment-item')].map(rect);
                        const action = document.querySelector('#action');
                        const input = document.querySelector('#scale');
                        const cs = getComputedStyle(input), ts = getComputedStyle(thumb);
                        return {track:rect(track),thumb:rect(thumb),rows,action:rect(action),thumbCSS:{width:ts.width,height:ts.height},
                            indicator:[getComputedStyle(track,'::before').opacity,getComputedStyle(track,'::after').opacity],
                            rangeSize:cs.getPropertyValue('--mc-range-thumb-size').trim(), offset:cs.getPropertyValue('--mc-range-fill-offset').trim(),
                            disabledOpacity:getComputedStyle(document.querySelector('#disabled-action')).opacity,
                            field:getComputedStyle(document.querySelector('#text-field')).backgroundColor,
                            select:getComputedStyle(document.querySelector('#chooser')).backgroundColor,
                            tab:getComputedStyle(document.querySelector('.inspector-tab.active')).backgroundColor,
                            segment:getComputedStyle(document.querySelector('.m3-segment-item.active')).backgroundColor,
                            overflow:document.documentElement.scrollWidth-innerWidth};
                    });
                    const context = `${theme}/${density}/${width}x${height}@${zoom}`;
                    const assert = (value, label) => { if (!value) throw Error(context+': '+label+'\n'+JSON.stringify(before)); checks.push(context+': '+label); };
                    assert(Math.abs(before.track.width-60)<0.1 && Math.abs(before.track.height-28)<0.1, '60x28 track');
                    assert(before.thumbCSS.width==='32px' && before.thumbCSS.height==='32px', '32px square lever');
                    assert(Math.abs(before.thumb.y+before.thumb.height/2-before.track.y-before.track.height/2+2)<0.1, 'lever two pixels above track centre');
                    assert(Math.abs(before.thumb.x-before.track.x)<0.1, 'OFF at left edge');
                    assert(before.indicator.join(',')==='0,1', 'OFF indicator only');
                    assert(before.disabledOpacity==='1', 'disabled action stays opaque');
                    assert(before.field!==before.select && before.tab!==before.segment, 'field, chooser, flat tab and selected segment remain distinct');
                    assert(before.rangeSize===(density==='settings'?'32px':'24px') && before.offset.includes(before.rangeSize), 'range fill follows density');
                    assert(before.overflow<=1, 'no document overflow');
                    for (let i=1;i<before.rows.length;i++) {
                        const a=before.rows[i-1],b=before.rows[i];
                        assert(Math.abs(b.x-a.x-a.width)<0.15 && Math.abs(a.height-b.height)<0.15 && Math.abs(a.y-b.y)<0.15, 'segments share border and height '+i);
                    }
                    await win.page.locator('#lever').focus();
                    await win.page.keyboard.press('Space');
                    await settle(win);
                    const after=await win.page.locator('#lever').evaluate(input => {
                        const track=input.nextElementSibling,r=track.firstElementChild.getBoundingClientRect(),t=track.getBoundingClientRect();
                        return {checked:input.checked,x:r.x,y:r.y,right:r.right,trackRight:t.right,before:getComputedStyle(track,'::before').opacity,after:getComputedStyle(track,'::after').opacity};
                    });
                    assert(after.checked && Math.abs(after.x-before.thumb.x-28)<0.1 && Math.abs(after.right-after.trackRight)<0.1, 'Space toggles ON at right edge');
                    assert(Math.abs(after.y-before.thumb.y)<0.1, 'ON preserves corrected vertical offset');
                    assert(after.before==='1' && after.after==='0', 'ON indicator only');
                    await win.page.locator('.m3-segment-item').nth(1).click();
                    assert(await win.page.locator('.m3-segment-item').nth(1).getAttribute('aria-pressed')==='true', 'segment responds to pointer');
                    const segmentFaces=await win.page.locator('.m3-segment-item').evaluateAll(items=>items.map(item=>{
                        const s=getComputedStyle(item);return [s.paddingTop,s.paddingBottom,s.backgroundSize,s.backgroundPosition].join('|');
                    }));
                    assert(segmentFaces.every(face=>face===segmentFaces[0]),'selected segment retains the same caption position and raised face');
                    assert(await win.page.locator('#disabled-lever').isDisabled(), 'disabled lever remains disabled');
                    if(zoom===1){
                        const sample=()=>win.page.locator('#action').evaluate(el=>{
                            const r=el.getBoundingClientRect(),s=getComputedStyle(el),probe=document.createElement('span');
                            probe.style.background='var(--mc-button-bevel)';el.append(probe);
                            const bevel=getComputedStyle(probe).backgroundColor;probe.remove();
                            return {face:s.backgroundColor,bevel,border:s.borderTopColor,rect:[r.x,r.y,r.width,r.height],scale:s.scale,filter:s.filter};
                        });
                        await win.page.mouse.move(2,2);await settle(win);const normal=await sample();
                        await win.page.locator('#action').hover();await settle(win);const hover=await sample();
                        const brightness=color=>color.match(/[\d.]+/g).slice(0,3).map(Number).reduce((a,b)=>a+b,0);
                        assert(brightness(hover.face)<brightness(normal.face)&&brightness(hover.bevel)>brightness(normal.bevel), 'hover darkens only face and brightens bevel');
                        assert(hover.border===normal.border&&hover.rect.join()===normal.rect.join(), 'hover preserves outline and hit area');
                        await win.page.mouse.down();const pressed=await sample();await win.page.mouse.up();
                        assert(pressed.rect.join()===normal.rect.join()&&pressed.scale==='1'&&pressed.filter==='none', 'pressed action does not scale or blur');
                        const disabled=await win.page.locator('#disabled-action').evaluate(el=>getComputedStyle(el).backgroundColor);
                        await win.page.locator('#disabled-action').hover();await settle(win);
                        assert(await win.page.locator('#disabled-action').evaluate(el=>getComputedStyle(el).backgroundColor)===disabled, 'disabled action ignores hover');
                        await win.page.mouse.move(2,2);
                    }
                    if(zoom===1) await fs.writeFile(path.join(output,`${theme}-${density}.png`),(await win.webContents.capturePage()).toPNG());
                }
            }
        }
        // Actual screens also catch theme rules colliding with their page CSS.
        const {inspectInterfaceGeometry}=await import('./lib/interface-geometry.mjs');
        const reports=[];
        for(const screen of ['settings','prefix','canvas']) {
            await win.loadFile(path.join(root,'src/renderer',screen==='settings'?'settings.html':'editor.html'),{query:screen==='settings'?{tab:'tools'}:{new:'true',type:screen,width:'64',height:'64',name:'Minecraft controls QA'}});
            for(const theme of ['minecraft','light-minecraft']) for(const [width,height,zoom] of [[1440,900,1],[1000,760,1],[1280,900,1.5]]) {
                win.setContentSize(width,height);win.webContents.setZoomFactor(zoom);
                await win.page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.classList.add('no-animations');},theme);
                await settle(win);
                const report=await win.page.evaluate(inspectInterfaceGeometry);
                reports.push({screen,theme,width,height,zoom,report});
                const errors=['overlaps','clipped','overflow','pixelFallbacks','dialogsOutside'].filter(key=>report[key].length);
                if(report.rootOverflow>2)errors.push('rootOverflow');
                if(errors.length)throw Error(JSON.stringify({screen,theme,width,height,zoom,errors,report}).slice(0,6500));
                checks.push(`${screen}/${theme}/${width}@${zoom}: layout fits`);
                if(width===1440)await fs.writeFile(path.join(output,`${screen}-${theme}.png`),(await win.webContents.capturePage()).toPNG());
            }
        }
        await win.page.evaluate(()=>document.documentElement.dataset.theme='dark');await settle(win);
        const restored=await win.page.evaluate(()=>!document.querySelector('[data-mc-icon],[data-mc-range]')&&[...document.querySelectorAll('input[type=range]')].every(el=>!el.style.getPropertyValue('--mc-range-fill')));
        if(!restored)throw Error('Leaving Minecraft leaves pixel decorations in the ordinary theme');
        checks.push('Leaving Minecraft removes transient icon and range decoration');
        if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));
        await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:checks.length,checks,reports},null,2));
        console.log(JSON.stringify({passed:checks.length,output}));
    }catch(error){console.error(error);process.exitCode=1;}
    finally{clearTimeout(timer);win?.destroy();app.exit(process.exitCode||0);}
})();
