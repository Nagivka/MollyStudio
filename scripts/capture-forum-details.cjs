const fs = require('node:fs/promises');
const path = require('node:path');
const {app,root,ready,makeWindow,settle} = require('./lib/electron-harness.cjs');

async function illustrate() {
    const {default:PrefixRenderer}=await import(new URL('js/graphics/PrefixRenderer.js',location.href));
    const {SURFACE_TEXTURES}=await import(new URL('js/graphics/SurfaceTexture.mjs',location.href));
    const renderer=new PrefixRenderer();await renderer.load();
    const board=(title,subtitle,rows=2)=>{
        const canvas=document.createElement('canvas');canvas.width=1560;canvas.height=124+rows*270;
        const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
        ctx.fillStyle='#313233';ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.fillStyle='white';ctx.font='28px "Minecraft Ten"';ctx.fillText(title,36,48);
        ctx.fillStyle='#D0D1D4';ctx.font='18px Minecraft';ctx.fillText(subtitle,36,84);
        return {canvas,ctx};
    };
    const cell=(b,index,columns,label)=>{
        const w=Math.floor(1496/columns),x=32+index%columns*w,y=112+Math.floor(index/columns)*270;
        b.ctx.fillStyle='#48494A';b.ctx.fillRect(x,y,w-12,250);
        b.ctx.strokeStyle='#202020';b.ctx.lineWidth=2;b.ctx.strokeRect(x+1,y+1,w-14,248);
        b.ctx.fillStyle='white';b.ctx.font='22px Minecraft';b.ctx.fillText(label,x+20,y+40);
        return {x:x+16,y:y+60,w:w-44,h:172};
    };
    const base={text:'VIP',font:'minecraft',background:'solid',backgroundColors:['#397DAC'],autoShade:true,textShadowMode:'auto',paddingX:8,paddingY:5};
    const paint=(b,rect,options)=>{
        const image=renderer.render({blocks:[{...base,...options}]}).canvas;
        const scale=Math.max(1,Math.min(7,Math.floor(rect.w/image.width),Math.floor(rect.h/image.height)));
        b.ctx.drawImage(image,rect.x+Math.floor((rect.w-image.width*scale)/2),rect.y+Math.floor((rect.h-image.height*scale)/2),image.width*scale,image.height*scale);
        return image;
    };
    const textures=board('Фактуры фона','Одна заливка — девять вариантов поверхности',3);
    SURFACE_TEXTURES.forEach((texture,i)=>paint(textures,cell(textures,i,3,texture.name),{texture:{type:texture.id,amount:55,scale:1,seed:7}}));
    const gradients=board('Цвета и градиенты','Сплошная заливка, переходы и автоматические оттенки краёв');
    [
        ['Сплошной цвет',{background:'solid',backgroundColors:['#4186B9']}],
        ['Два цвета',{background:'gradient',backgroundColors:['#285BB8','#40CDB6'],backgroundAngle:0}],
        ['Три цвета',{background:'gradient',backgroundColors:['#9253C3','#E67EA4','#EDBE59'],backgroundAngle:0}],
        ['Вертикальный',{background:'gradient',backgroundColors:['#2C4D83','#77B9E7'],backgroundAngle:90}],
        ['Диагональный',{background:'gradient',backgroundColors:['#854D9E','#E897BE'],backgroundAngle:45}],
        ['Градиент текста',{background:'solid',backgroundColors:['#343D4B'],textMode:'gradient',textColors:['#54DEFF','#CC8FFF'],textAngle:0}]
    ].forEach(([label,options],i)=>paint(gradients,cell(gradients,i,3,label),options));
    const prefixes=board('Один редактор — разные префиксы','Шрифт, заливка, углы, фаски и тени');
    [
        ['Золотой',{text:'PREMIUM',font:'smallcaps',background:'gradient',backgroundColors:['#A46719','#FFD269'],backgroundAngle:90}],
        ['Холодный',{text:'MVP',font:'minecraft-ten',background:'gradient',backgroundColors:['#3252A0','#39B9CF'],backgroundAngle:0}],
        ['Плоский',{text:'PLAYER',font:'square',bevel:false,backgroundColors:['#3F865C'],radius:0}],
        ['Скруглённый',{text:'HELPER',backgroundColors:['#7755A5'],radiusTopLeft:5,radiusTopRight:5,radiusBottomLeft:5,radiusBottomRight:5}],
        ['Без заливки',{text:'ADMIN',background:'none',borderWidth:0,bevel:false,textMode:'gradient',textColors:['#FFAE8B','#EE5273'],textAngle:0}],
        ['С фактурой',{text:'BUILDER',backgroundColors:['#4D8196'],texture:{type:'grain',amount:40,seed:2},shadow:true,shadowX:2,shadowY:2}]
    ].forEach(([label,options],i)=>paint(prefixes,cell(prefixes,i,3,label),options));
    const transforms=board('Преобразование объектов','Примеры поворота и отражения на пиксельной графике');
    const image=renderer.render({blocks:[{...base,text:'PLAY',font:'minecraft-ten'}]}).canvas;
    ['Оригинал','Отражение по горизонтали','Поворот на 90°','Поворот на 180°'].forEach((label,i)=>{
        const r=cell(transforms,i,2,label),c=transforms.ctx,rotated=i===2;
        const scale=Math.min(5,Math.floor(r.w/(rotated?image.height:image.width)),Math.floor(r.h/(rotated?image.width:image.height)));
        c.save();c.translate(Math.round(r.x+r.w/2),Math.round(r.y+r.h/2));
        if(i===1)c.scale(-1,1);if(i===2)c.rotate(Math.PI/2);if(i===3)c.rotate(Math.PI);
        c.drawImage(image,-Math.floor(image.width*scale/2),-Math.floor(image.height*scale/2),image.width*scale,image.height*scale);c.restore();
    });
    return Object.fromEntries([['14-textures.png',textures],['15-gradients.png',gradients],['16-prefix-examples.png',prefixes],['20-transforms.png',transforms]].map(([name,b])=>[name,b.canvas.toDataURL().split(',')[1]]));
}
(async()=>{
    let win;const timer=setTimeout(()=>app.exit(1),60000);
    try{
        await ready();win=makeWindow(1920,1080);await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'64',height:'64'}});
        await win.page.evaluate(async()=>{mollyEditor.settingsManager.set('theme','minecraft');await document.fonts.ready;});await settle(win);
        for(const [name,data]of Object.entries(await win.page.evaluate(illustrate)))await fs.writeFile(path.join(root,'forum-media',name),Buffer.from(data,'base64'));
        if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));console.log('Rendered four detailed Minecraft-style illustration boards.');
    }catch(error){console.error(error);process.exitCode=1;}finally{clearTimeout(timer);win?.destroy();app.exit(process.exitCode||0);}
})();
