const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..');
const media=require('./data/forum-media.json'),names=media.map(photo=>photo.file);
(async()=>{
    const browser=await chromium.launch({channel:'chrome',headless:true});
    const errors=[],network=[];let checks=0;
    const expect=(value,message)=>{assert.ok(value,message);checks++;};
    try{
        const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
        await context.route(/^https?:/,route=>{network.push(route.request().url());return route.abort();});
        await context.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copiedText=text;},write:async items=>{window.copiedHTML=await(await items[0].getType('text/html')).text();window.copiedPlain=await(await items[0].getType('text/plain')).text();}}});});
        const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
        await page.goto(pathToFileURL(path.join(root,'forum-description.html')).href);
        expect(await page.locator('article figure').count()===media.length,'All screenshots and illustration boards are present');
        expect(await page.evaluate(()=>[...document.querySelectorAll('article img')].every(image=>image.src.startsWith('data:image/png;base64,'))),'Photos embedded in the HTML');
        await page.locator('#copy-text').click();
        await page.waitForFunction(()=>typeof window.copiedText==='string');
        expect(await page.evaluate(()=>copiedText.includes('[CENTER]')&&copiedText.includes('[COLOR=#5CA7DF]')&&!copiedText.includes('[IMG]')&&!copiedText.includes('[ATTACH')),'Text copy uses BBCode formatting without photos');
        expect(await page.evaluate(()=>copiedText.includes('Рабочий холст')&&!copiedText.includes('Как вставить с фотографиями')),'BBCode excludes preparation controls');
        expect(await page.locator('article .meta, article .note, article ol').count()===0,'Removed metadata, server notice and launch instructions stay absent');
        expect(await page.evaluate(()=>!copiedText.includes('Как запустить')&&!copiedText.includes('Portable:')&&!copiedText.includes('команды и действия меню')),'Removed sections cannot reappear in copied text');
        expect(await page.evaluate(()=>['выделение и преобразование','цвета и фактуры','автошейдинг','miniMessage','liquid glass','смещение по x/y'].every(text=>copiedText.toLowerCase().includes(text.toLowerCase()))),'Publication presents specific editing and customization capabilities');
        expect(await page.evaluate(()=>!document.querySelector('article').textContent.includes('{{')),'No unresolved template placeholders');
        expect(await page.locator('article').innerText().then(text=>!text.includes('1.3.0')&&!text.includes('все иллюстрации здесь сделаны в Minecraft-теме')),'No stale release or screenshot-theme claims');
        expect(await page.locator('#copy-bbcode').isDisabled(),'BBCode with images requires public links or attachment IDs');
        const fields=page.locator('[data-attachment]');
        await fields.nth(0).fill('javascript:alert(1)');expect(await fields.nth(0).getAttribute('aria-invalid')==='true','Non-image protocols rejected');
        const tags=names.map((name,i)=>`[ATTACH type="full" alt="${name}"]${90001+i}[/ATTACH]`).reverse();
        await page.locator('#attachment-batch').fill(tags.join('\n'));
        expect(await page.locator('#copy-bbcode').isEnabled(),'One batch unlocks all image references');
        expect(await fields.evaluateAll(nodes=>nodes.map(node=>node.value).join(','))===names.map((_,i)=>String(90001+i)).join(','),'Named uploads map correctly even in reverse order');
        await page.locator('#attachment-batch').fill(names.map((_,i)=>`[ATTACH]${91001+i}[/ATTACH]`).join('\n'));
        expect(await fields.nth(names.length-1).inputValue()===String(91000+names.length)&&await fields.nth(0).inputValue()==='91001','Unnamed complete uploads map in ZIP filename order');
        const prior=await fields.evaluateAll(nodes=>nodes.map(node=>node.value).join(','));
        await page.locator('#attachment-batch').fill(Array(names.length).fill('[ATTACH]77777[/ATTACH]').join('\n'));
        expect(await fields.evaluateAll(nodes=>nodes.map(node=>node.value).join(','))===prior,'Duplicate attachment tags cannot overwrite the whole mapping');
        await page.locator('#attachment-batch').fill('01-launcher.png https://black-minecraft.com/attachments/01-launcher-png.91001/');
        expect((await fields.nth(0).inputValue()).includes('01-launcher-png'),'A named URL can update just its matching photo');
        await fields.nth(0).fill('90001');
        await fields.nth(1).fill('https://black-minecraft.com/attachments/buttons-png.90002/');
        await fields.nth(2).fill('[ATTACH type="full"]90003[/ATTACH]');
        await fields.nth(3).fill('[IMG]https://black-minecraft.com/attachments/designs-png.90004/[/IMG]');
        await page.locator('#copy-bbcode').click();
        await page.waitForFunction(()=>typeof window.copiedText==='string');
        const bb=await page.evaluate(()=>copiedText);
        expect((bb.match(/\[ATTACH type="full"\]/g)||[]).length===names.length-2&&(bb.match(/\[IMG\]/g)||[]).length===2,'All attachment references inserted');
        expect(!/data:image|file:\/\/|C:\\Users|data-attachment/.test(bb),'Publication contains no local paths or embedded image blobs');
        expect(bb.includes('[SIZE=7][B]MollyStudio')&&bb.includes('[COLOR=#5CA7DF]')&&bb.includes('[LIST]')&&bb.includes('Vanilla и Bedrock'),'Forum formatting and current features preserved');
        await page.reload();expect(await page.locator('#copy-bbcode').isEnabled(),'Attachment mapping survives reload');
        const download=page.waitForEvent('download');await page.locator('#download-all').click();
        const zip=await download;await fs.mkdir(path.join(root,'.test-output'),{recursive:true});const archive=path.join(root,'.test-output/forum-screenshots.zip');await zip.saveAs(archive);
        expect(zip.suggestedFilename()==='MollyStudio-1.4.0.0-forum-images.zip','Image archive uses the current build version');
        const data=await fs.readFile(archive);let offset=0,count=0;
        while(data.readUInt32LE(offset)===0x04034b50){const size=data.readUInt32LE(offset+18),length=data.readUInt16LE(offset+26),extra=data.readUInt16LE(offset+28),name=data.toString('utf8',offset+30,offset+30+length),start=offset+30+length+extra;assert.deepEqual(data.subarray(start,start+size),await fs.readFile(path.join(root,'forum-media',name)));offset=start+size;count++;}
        expect(count===names.length&&data.readUInt32LE(offset)===0x02014b50,'ZIP has all byte-identical PNG images');
        await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw Error('Denied for fallback test');};});
        await page.locator('#copy-text').click();await page.locator('#bbcode').waitFor({state:'visible'});
        expect(!(await page.locator('#bbcode').inputValue()).includes('[ATTACH'),'Clipboard fallback respects text-only mode');
        await page.locator('#show-code').click();expect((await page.locator('#bbcode').inputValue()).includes('[ATTACH'),'Code preview includes images when all attachments are ready');
        for(const width of [1440,960,390]){
            await page.setViewportSize({width,height:1000});await page.locator('article img').last().scrollIntoViewIfNeeded();
            expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow at '+width);
            await page.screenshot({path:path.join(root,'.test-output',`forum-page-${width}.png`),fullPage:true});
        }
        await page.setViewportSize({width:1440,height:1000});await page.locator('article img').first().click();expect(await page.locator('#viewer').evaluate(dialog=>dialog.open),'Screenshot opens at a larger size');await page.keyboard.press('Escape');
        expect(await page.locator('#viewer').evaluate(dialog=>!dialog.open),'Screenshot viewer closes with Escape');
        await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(root,'.test-output/forum-page-overview.png')});
        expect(errors.length===0,'No page errors: '+errors.join('; '));expect(network.length===0,'No network dependency');
        const report={passed:checks,errors,externalRequests:network};await fs.writeFile(path.join(root,'.test-output/forum-page.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
    }catch(error){console.error(error);process.exitCode=1;}
    finally{await browser.close();}
})();
