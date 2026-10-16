export async function preparePngExport(dataUrl, { scale = 1, trim = false } = {}) {
    if (!trim && scale === 1) return dataUrl;
    const image = new Image();
    await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('Не удалось подготовить изображение к экспорту.'));
        image.src = dataUrl;
    });
    const source = document.createElement('canvas');
    source.width = image.naturalWidth || image.width;
    source.height = image.naturalHeight || image.height;
    const context = source.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    let x = 0, y = 0, width = source.width, height = source.height;
    if (trim) {
        const data = context.getImageData(0, 0, width, height).data;
        let minX = width, minY = height, maxX = -1, maxY = -1;
        for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
            if (!data[(row * width + col) * 4 + 3]) continue;
            minX = Math.min(minX, col); minY = Math.min(minY, row);
            maxX = Math.max(maxX, col); maxY = Math.max(maxY, row);
        }
        x = maxX < 0 ? 0 : minX; y = maxY < 0 ? 0 : minY;
        width = maxX < 0 ? 1 : maxX - minX + 1;
        height = maxY < 0 ? 1 : maxY - minY + 1;
    }
    scale = Math.max(1, Math.min(16, Math.round(Number(scale) || 1)));
    if (width * height * scale * scale > 64 * 1024 * 1024 || Math.max(width, height) * scale > 16384) {
        throw new Error('Уменьшите масштаб экспорта: итоговое изображение слишком велико.');
    }
    const output = document.createElement('canvas');
    output.width = width * scale; output.height = height * scale;
    const target = output.getContext('2d');
    target.imageSmoothingEnabled = false;
    target.drawImage(source, x, y, width, height, 0, 0, output.width, output.height);
    return output.toDataURL('image/png');
}
