import { deflateSync } from 'node:zlib';

export function pngData(width = 32, height = 32) {
    const chunk = (type, data) => {
        const name = Buffer.from(type);
        let crc = 0xffffffff;
        for (const value of Buffer.concat([name, data])) {
            crc ^= value;
            for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
        const header = Buffer.alloc(4), footer = Buffer.alloc(4);
        header.writeUInt32BE(data.length); footer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
        return Buffer.concat([header, name, data, footer]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
    const image = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(Buffer.alloc(height * (width * 4 + 1)))), chunk('IEND', Buffer.alloc(0))]);
    return `data:image/png;base64,${image.toString('base64')}`;
}
