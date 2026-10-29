self.onmessage=async event=>{
    const {id,operation,payload}=event.data;
    try{
        let result;
        if(operation==='parse')result=JSON.parse(payload.replace(/^\uFEFF/,''));
        else if(operation==='stringify')result=JSON.stringify(payload);
        else if(operation==='png'){
            const canvas=new OffscreenCanvas(payload.width,payload.height),ctx=canvas.getContext('2d');ctx.drawImage(payload,0,0);payload.close();
            const bytes=new Uint8Array(await(await canvas.convertToBlob({type:'image/png'})).arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=24576)binary+=String.fromCharCode(...bytes.subarray(i,i+24576));result='data:image/png;base64,'+btoa(binary);canvas.width=canvas.height=1;
        }else throw Error('Unknown codec operation');
        self.postMessage({id,ok:true,result});
    }catch(error){payload?.close?.();self.postMessage({id,ok:false,error:error.message,name:error.name});}
};
