const COLORS=['#000000','#0000AA','#00AA00','#00AAAA','#AA0000','#AA00AA','#FFAA00','#AAAAAA','#555555','#5555FF','#55FF55','#55FFFF','#FF5555','#FF55FF','#FFFF55','#FFFFFF'];

/** Parse the formats produced by our gradient utility without consuming invalid codes. */
export function tokenizeBitmapText(text) {
    text=String(text??'');const tokens=[],styles=new Set();let color=null;
    for(let i=0;i<text.length;){
        const rest=text.slice(i),rgb=rest.match(/^(?:[&§]#[\da-f]{6}|[&§]x(?:[&§][\da-f]){6})/i);
        if(rgb){color='#'+rgb[0].replace(/^[&§](?:#|x)/i,'').replace(/[&§]/g,'').toUpperCase();i+=rgb[0].length;continue;}
        if(/[&§]/.test(text[i])&&i+1<text.length){
            const raw=text[i+1].toLowerCase(),code=({'а':'a','б':'b','с':'c','в':'d','у':'e','ф':'f','к':'r'})[raw]||raw;
            if(/^[\da-f]$/.test(code)){color=COLORS[parseInt(code,16)];i+=2;continue;}
            if(code==='r'){color=null;i+=2;continue;}
            if('klmno'.includes(code)){styles.add(code);i+=2;continue;}
        }
        const start=i;let char=String.fromCodePoint(text.codePointAt(i));i+=char.length;
        if(char==='\r'){if(text[i]==='\n')i++;char='\n';}
        if(char==='\t')for(let n=0;n<4;n++)tokens.push({char:' ',color,start,end:i});else tokens.push({char,color,start,end:i});
    }
    return {tokens,unsupportedStyles:[...styles]};
}

/** Word wrapping, hard breaks and line alignment share the same glyph advances. */
export function layoutBitmapText(tokens,measure,{maxWidth=0,lineHeight=10,align='left',lineBoxHeight=10,sourceText=null,frameHeight=0}={}) {
    const limit=Math.max(0,Math.min(4096,Math.round(Number(maxWidth)||0)));
    const leading=Math.max(1,Math.min(256,Math.round(Number(lineHeight)||10)));
    const lines=[];let line={glyphs:[],width:0,start:0};
    const newline=(end=line.glyphs.at(-1)?.end??line.start,nextStart=end)=>{line.end=end;lines.push(line);line={glyphs:[],width:0,start:nextStart};};
    const append=token=>{const glyph=measure(token.char),advance=Math.max(1,glyph.advance||1);
        if(limit&&line.width&&line.width+advance>limit)newline(token.start,token.start);
        line.glyphs.push({...token,glyph,x:line.width});line.width+=advance;
    };
    let index=0;
    while(index<tokens.length){
        if(tokens[index].char==='\n'){newline(tokens[index].start,tokens[index].end);index++;continue;}
        const start=index,spaces=tokens[index].char===' ';
        while(index<tokens.length&&tokens[index].char!=='\n'&&(tokens[index].char===' ')===spaces)index++;
        const word=tokens.slice(start,index),width=word.reduce((sum,t)=>sum+Math.max(1,measure(t.char).advance||1),0);
        if(limit&&!spaces&&line.width&&line.width+width>limit){
            // Wrapping discards separator spaces, explicit indentation is retained.
            while(line.glyphs.at(-1)?.char===' '){const last=line.glyphs.pop();line.width-=last.glyph.advance;}
            if(line.glyphs.length)newline(word[0].start,word[0].start);
        }
        for(const token of word)append(token);
    }
    newline(sourceText?.length??tokens.at(-1)?.end??line.start);
    const width=limit||Math.max(1,...lines.map(row=>row.width));
    const glyphs=[];
    const inset=limit&&frameHeight>0?Math.max(0,...lines.flatMap(row=>row.glyphs.map(g=>-(g.glyph.offsetY||0)))):0;
    lines.forEach((row,n)=>{
        const shift=align==='center'?Math.round((width-row.width)/2):align==='right'?width-row.width:0;
        row.x=row.offset=shift;row.y=n*leading+inset;
        row.glyphs=row.glyphs.map(g=>({...g,advance:g.glyph.advance}));
        row.glyphs.forEach(g=>glyphs.push({...g,x:g.x+shift,y:row.y+(g.glyph.offsetY||0),line:n}));
    });
    const contentHeight=Math.max(1,(lines.length-1)*leading+lineBoxHeight+inset),height=limit&&frameHeight>0?frameHeight:contentHeight;
    const visibleLines=limit&&frameHeight>0?Math.max(0,Math.min(lines.length,Math.floor((height-lineBoxHeight-inset)/leading)+1)):lines.length;
    const horizontalOverflow=!!limit&&lines.some(row=>row.width>limit);
    const text=sourceText??tokens.map(t=>t.char).join('');
    const boundaries=[...new Set([0,...[...new Intl.Segmenter('ru',{granularity:'grapheme'}).segment(text)].map(g=>g.index+g.segment.length)])];
    return {lines,glyphs,width,height,contentHeight,visibleLines,lineHeight:leading,leading,lineBoxHeight,text,boundaries,
        verticalOverflow:visibleLines<lines.length,horizontalOverflow,overflow:visibleLines<lines.length||horizontalOverflow,
        minRequiredWidth:Math.ceil(Math.max(1,...glyphs.map(g=>g.glyph.advance)))};
}
