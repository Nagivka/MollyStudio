const table=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let n=0;n<8;n++)c=c&1?0xEDB88320^(c>>>1):c>>>1;return c>>>0;});
export function crc32(bytes) {let c=0xFFFFFFFF;for(const byte of bytes)c=table[(c^byte)&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}

/** PNGs are already compressed; store them in ZIP without another dependency. */
export function createExportArchive(files) {
    if(files.length>1000)throw Error('Слишком много файлов в архиве.');
    const encoder=new TextEncoder(),local=[],central=[],names=new Set();let offset=0,total=0;
    for(const file of files){
        const validName=typeof file.name==='string'&&file.name.length<=240&&!/[\\\u0000-\u001F:]/.test(file.name)
            &&!file.name.includes('/')&&file.name&&file.name!=='.'&&file.name!=='..';
        if(!validName||names.has(file.name.toLowerCase()))throw Error('Недопустимое или повторяющееся имя файла в архиве.');
        names.add(file.name.toLowerCase());const name=encoder.encode(file.name),data=file.data instanceof Uint8Array?file.data:encoder.encode(file.data);
        total+=data.byteLength;if(total>128*1024*1024)throw Error('Архив превышает 128 МБ. Экспортируйте меньшими наборами.');
        const crc=crc32(data),header=new Uint8Array(30+name.length),h=new DataView(header.buffer);
        h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint16(12,33,true);h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,name.length,true);header.set(name,30);local.push(header,data);
        const directory=new Uint8Array(46+name.length),d=new DataView(directory.buffer);
        d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(14,33,true);d.setUint32(16,crc,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);directory.set(name,46);central.push(directory);offset+=header.length+data.length;
    }
    const centralSize=central.reduce((sum,b)=>sum+b.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);
    e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
    const output=new Uint8Array(offset+centralSize+end.length);let cursor=0;for(const bytes of [...local,...central,end]){output.set(bytes,cursor);cursor+=bytes.length;}return output;
}
