const fs=require('node:fs/promises');
const path=require('node:path');
const {app,root,ready,makeWindow,evaluateMain}=require('./lib/electron-harness.cjs');
async function renderExamples(){
    const app=window.mollyEditor;
    const {getExportRegion}=await import(new URL('./js/graphics/ExportImage.js',location.href).href);
    const board=(height,title,subtitle)=>{
        const canvas=document.createElement('canvas');canvas.width=1560;canvas.height=height;
        const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.fillStyle='#313233';ctx.fillRect(0,0,1560,height);
        ctx.fillStyle='#FFFFFF';ctx.font='28px "Minecraft Ten"';ctx.fillText(title,42,54);
        ctx.fillStyle='#D0D1D4';ctx.font='18px Minecraft';ctx.fillText(subtitle,42,88);return {canvas,ctx};
    };
    const panel=(ctx,x,y,w,h)=>{ctx.fillStyle='#48494A';ctx.fillRect(x,y,w,h);ctx.lineWidth=2;ctx.strokeStyle='#202020';ctx.strokeRect(x+1,y+1,w-2,h-2);ctx.lineWidth=1;};
    const label=(ctx,value,x,y,size=24,color='#FFFFFF')=>{ctx.fillStyle=color;ctx.font=`${size}px Minecraft`;ctx.fillText(value,x,y);};
    const textBoard=board(1150,'Шрифты и оформление текста','Кириллица и латиница • цвет • градиент • тень');
    const variants=[
        ['Minecraft Default','Обычный',{fontId:'minecraft'}],
        ['Minecraft Ten','Объёмный',{fontId:'minecraft-ten'}],
        ['SmallCaps','Капитель',{fontId:'smallcaps'}],
        ['Square','Квадратный',{fontId:'square'}],
        ['Градиент','Цвет и тень',{fontId:'minecraft',colorMode:'gradient',gradientColors:['#55DDFF','#CC88FF'],gradientAngle:0}],
        ['Перенос строк','Текстовая рамка',{fontId:'minecraft',text:'Добро пожаловать!\nWelcome!',maxWidth:160,lineHeight:12}]
    ];
    for(let i=0;i<variants.length;i++){
        const [title,subtitle,settings]=variants[i],y=124+i*170;panel(textBoard.ctx,32,y,1496,150);
        label(textBoard.ctx,title,58,y+53);label(textBoard.ctx,subtitle,58,y+87,16,'#D0D1D4');
        const layer=app.layerManager.addTextLayer('Пример',{text:'Привет! Welcome!',fontId:'minecraft',fontSize:8,x:0,y:0,color:'#FFFFFF',shadow:true,shadowMode:'auto',shadowOffsetX:1,shadowOffsetY:1,...settings});
        app.tools.tools.text.renderTextLayer(layer,false);const region=getExportRegion(layer.canvas,true),scale=Math.min(6,Math.floor(930/region.width),Math.floor(118/region.height));
        textBoard.ctx.drawImage(layer.canvas,region.x,region.y,region.width,region.height,540,y+Math.floor((150-region.height*scale)/2),region.width*scale,region.height*scale);
    }
    const buttonBoard=board(970,'Пять стилей кнопок','Одинаковый размер 132 × 28 px. Слева — сплошная заливка, справа — градиент.');
    const model=app.buttonGeneratorModal;model.autoShadeEnabled=true;model.tintedBorderEnabled=true;model.gradientAngle=90;
    const styles=[['JAVA','default'],['Bedrock','ten'],['FLAT','flat'],['OUTLINE','outline'],['DOUBLE','double']];
    label(buttonBoard.ctx,'Сплошной цвет',340,137,18,'#9DB4CB');label(buttonBoard.ctx,'Градиент',880,137,18,'#9DB4CB');
    for(let i=0;i<styles.length;i++){
        const [name,style]=styles[i],y=162+i*154;panel(buttonBoard.ctx,32,y,1496,136);label(buttonBoard.ctx,name,58,y+76,28);
        for(const [mode,x] of [['solid',312],['gradient',860]]){
            model.colorMode=mode;model.gradientColors=['#5268C7','#22B7C5'];
            const image=model.renderButton(132,28,model.calculateMinecraftShades('#397DAC',true),style,100,false,1,1);
            buttonBoard.ctx.drawImage(image,x,y+26,396,84);image.width=image.height=1;
        }
    }
    const guiBoard=board(650,'Два стиля GUI для Java Edition','Vanilla и Bedrock — каждый с плашкой заголовка и без неё.');
    for(const [index,[style,frame]] of [['default',true],['default',false],['bedrock',true],['bedrock',false]].entries()){
        const x=26+index*384;panel(guiBoard.ctx,x,120,356,500);
        label(guiBoard.ctx,style==='default'?'Vanilla':'Bedrock',x+18,160,27);label(guiBoard.ctx,frame?'С плашкой':'Без плашки',x+18,191,19,'#9DB4CB');
        const image=new Image();image.src=`assets/images/container/${style}/container_27${frame?'_frame':''}.png`;await image.decode();
        const source=document.createElement('canvas');source.width=image.naturalWidth;source.height=image.naturalHeight;source.getContext('2d').drawImage(image,0,0);
        const region=getExportRegion(source,true);guiBoard.ctx.drawImage(source,region.x,region.y,region.width,region.height,x+2,220,region.width*2,region.height*2);source.width=source.height=1;
    }
    return Object.fromEntries([['09-text-variants.png',textBoard],['10-button-styles.png',buttonBoard],['11-gui-styles.png',guiBoard]].map(([name,{canvas}])=>[name,canvas.toDataURL('image/png').split(',')[1]]));
}
(async()=>{let win;const timer=setTimeout(()=>app.exit(1),60000);try{
    await ready();win=makeWindow(1920,1080);await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'1600',height:'200',name:'Примеры оформления'}});
    await evaluateMain(()=>globalThis.__mollyTestRuntime.windows.get('main').setFullScreen(true));
    await win.page.evaluate(async()=>{mollyEditor.settingsManager.set('theme','minecraft');mollyEditor.settingsManager.set('accentColor','auto');await document.fonts.ready;});
    await win.page.waitForFunction(()=>['minecraft','smallcaps','minecraft-ten','square'].every(id=>window.mollyEditor?.tools.tools.text.fontImages[id]));
    await fs.mkdir(path.join(root,'forum-media'),{recursive:true});
    for(const [name,data] of Object.entries(await win.page.evaluate(renderExamples))){
        if(process.argv.includes('--text-only')&&name!=='09-text-variants.png')continue;
        await fs.writeFile(path.join(root,'forum-media',name),Buffer.from(data,'base64'));
    }
    if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));console.log('Saved real-renderer comparisons: text, five button styles and two GUI styles.');
}catch(error){console.error(error);process.exitCode=1;}finally{clearTimeout(timer);win?.destroy();app.exit(process.exitCode||0);}})();
