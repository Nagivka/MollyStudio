// Compare every retained symbol at its actual UI sizes and variation settings.
const fs = require('node:fs/promises'), path = require('node:path');
const {PNG} = require('pngjs');
const {app, root, ready, makeWindow, settle} = require('./lib/electron-harness.cjs');
(async () => {
    let win;
    const timer = setTimeout(() => app.exit(1), 300000);
    try {
        const candidate = path.resolve(process.argv[2] || path.join(root, 'src/renderer/assets/fonts/MaterialSymbolsRounded.woff2'));
        const manifest = JSON.parse(await fs.readFile(process.argv[3] || path.join(root, 'scripts/data/material-symbols.json'), 'utf8'));
        const original = await fs.readFile(path.join(root, 'design/font-sources/MaterialSymbolsRounded.woff2'));
        const optimized = await fs.readFile(candidate);
        await ready();
        win = makeWindow(1100, 1100);
        await win.loadFile(path.join(root, 'src/renderer/index.html'));
        await settle(win);
        await win.page.goto('about:blank');
        await win.showInactive();
        await win.page.evaluate(async ({original, optimized, names}) => {
            document.body.replaceChildren();
            document.body.style.cssText = 'margin:0;background:white;overflow:hidden';
            const style = document.createElement('style');
            style.textContent = '*{animation:none!important;transition:none!important;}';
            document.head.append(style);
            for (const [family, base64] of [['FullIcons', original], ['CompactIcons', optimized]]) {
                const font = new FontFace(family, `url(data:font/woff2;base64,${base64})`, {weight: '100 700'});
                await font.load(); document.fonts.add(font);
            }
            const atlas = document.createElement('div'); atlas.id = 'icon-atlas';
            atlas.style.cssText = 'position:fixed;left:0;top:0;display:grid;grid-template-columns:repeat(20,48px);width:960px;background:white;color:black;font-synthesis:none;';
            for (const name of names) {
                const cell = document.createElement('span'); cell.textContent = name;
                cell.style.cssText = 'display:flex;align-items:center;justify-content:center;width:48px;height:48px;line-height:1;font-feature-settings:"liga" 1;white-space:nowrap;overflow:hidden;';
                atlas.append(cell);
            }
            document.body.append(atlas);
        }, {original: original.toString('base64'), optimized: optimized.toString('base64'), names: manifest.names});
        const results = [];
        for (const size of [16, 20, 24]) for (const weight of [100, 400, 500, 600, 700]) for (const fill of [0, 1]) {
            const capture = async family => {
                await win.page.evaluate(({family, size, weight, fill}) => {
                    const atlas = document.getElementById('icon-atlas');
                    atlas.style.fontFamily = family; atlas.style.fontSize = `${size}px`;
                    atlas.style.fontVariationSettings = `"FILL" ${fill}, "wght" ${weight}`;
                }, {family, size, weight, fill});
                await win.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                const {data} = await win.cdp.send('Page.captureScreenshot', {format:'png', clip:{x:0,y:0,width:960,height:Math.ceil(manifest.names.length/20)*48,scale:1},captureBeyondViewport:true});
                return PNG.sync.read(Buffer.from(data,'base64'));
            };
            const full = await capture('FullIcons'), compact = await capture('CompactIcons');
            if (full.width !== compact.width || full.height !== compact.height || !full.data.equals(compact.data)) {
                const dir = path.join(root, '.test-output/font-subset'); await fs.mkdir(dir, {recursive:true});
                await fs.writeFile(path.join(dir, `full-${size}-${weight}-${fill}.png`), PNG.sync.write(full));
                await fs.writeFile(path.join(dir, `compact-${size}-${weight}-${fill}.png`), PNG.sync.write(compact));
                throw Error(`Icon rendering changed at size ${size}, weight ${weight}, fill ${fill}.`);
            }
            results.push({size, weight, fill, symbols: manifest.names.length, identical: true});
        }
        const result = {passed: true, symbols: manifest.names.length, cases: results.length,
            iconComparisons: results.length * manifest.names.length, results};
        await fs.writeFile(path.join(root, '.test-output/font-subset.json'), JSON.stringify(result, null, 2));
        console.log(JSON.stringify({passed:true,symbols:result.symbols,cases:result.cases,iconComparisons:result.iconComparisons}));
    } catch (error) {console.error(error); process.exitCode = 1;}
    finally {clearTimeout(timer); win?.destroy(); app.exit(process.exitCode || 0);}
})();
