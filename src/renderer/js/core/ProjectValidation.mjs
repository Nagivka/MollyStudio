import {normalizeTitleDocument} from './TitleDocument.mjs';
import {migrateProjectDocument} from './ProjectMigrations.mjs';
import { validatePrefixDocument } from './PrefixDocument.mjs';

export const MAX_PROJECT_DIMENSION = 4096;
export const MAX_PROJECT_LAYERS = 512;
export const MAX_PROJECT_PIXEL_COUNT = 64 * 1024 * 1024;
export const MAX_PROJECT_DATA_BYTES = 512 * 1024 * 1024;

export function parseProjectJSON(text) {
    if (typeof text !== 'string') throw new TypeError('Файл проекта должен содержать текст JSON.');
    return migrateProjectDocument(JSON.parse(text.replace(/^\uFEFF/, ''))).document;
}

export function validateProjectDocument(project) {
    if (!project || typeof project !== 'object' || Array.isArray(project)) {
        throw new Error('Файл проекта повреждён: данные проекта не найдены.');
    }
    if (project.name != null && typeof project.name !== 'string') throw new Error('Название проекта должно быть текстом.');
    if (!Array.isArray(project.layers) || project.layers.length > MAX_PROJECT_LAYERS) {
        throw new Error(`Файл проекта должен содержать не более ${MAX_PROJECT_LAYERS} слоёв.`);
    }
    if(project.type!=null&&!['gui','canvas','prefix','title'].includes(project.type))throw new Error('Этот тип проекта больше не поддерживается.');
    if (Number(project.mollyVersion) > 2) {
        throw new Error('Этот файл создан в более новой версии MollyStudio. Обновите приложение.');
    }


    const width = readDimension(project.config?.width, 256);
    if(project.type==='title'){if(!project.titleData||typeof project.titleData!=='object'||Array.isArray(project.titleData))throw Error('Повреждены параметры надписи.');normalizeTitleDocument(project.titleData);}
    if (project.type === 'prefix') validatePrefixDocument(project.prefixData);
    const height = readDimension(project.config?.height, 256);
    const seenIds = new Set();
    let pixels = 0;
    let encodedBytes = 0;
    const layersById = new Map(project.layers.filter(layer => layer?.id != null).map(layer => [String(layer.id), layer]));

    for (const layer of project.layers) {
        if (!layer || typeof layer !== 'object' || Array.isArray(layer)) {
            throw new Error('Файл проекта повреждён: найден некорректный слой.');
        }
        const layerWidth = readDimension(layer.width, width);
        const layerHeight = readDimension(layer.height, height);
        pixels += layerWidth * layerHeight;
        if (pixels > MAX_PROJECT_PIXEL_COUNT) {
            throw new Error('Проект слишком велик для безопасной загрузки. Уменьшите число слоёв или размер холста.');
        }
        if (layer.id != null) {
            const id = String(layer.id);
            if (seenIds.has(id)) throw new Error('Файл проекта повреждён: найдены повторяющиеся слои.');
            seenIds.add(id);
        }
        if (layer.opacity != null && (!Number.isFinite(Number(layer.opacity)) || Number(layer.opacity) < 0 || Number(layer.opacity) > 1)) {
            throw new Error('Файл проекта содержит некорректную прозрачность слоя.');
        }
        if (layer.type != null && !['bitmap', 'text', 'group'].includes(layer.type)) throw new Error('Неизвестный тип слоя.');
        if(layer.buttonData!=null&&(typeof layer.buttonData!=='object'||Array.isArray(layer.buttonData)||JSON.stringify(layer.buttonData).length>4096))throw new Error('Некорректные параметры кнопки.');
        if (layer.textData != null) {
            const text = layer.textData;
            if (typeof text !== 'object' || Array.isArray(text) || typeof text.text !== 'string' || text.text.length > 4096) {
                throw new Error('Некорректный текст слоя (предел — 4096 символов).');
            }
            if (!['minecraft', 'smallcaps', 'square', 'minecraft-ten', 'other'].includes(text.fontId)) throw new Error('Неизвестный шрифт текста.');
            for (const key of ['x', 'y', 'letterSpacing', 'shadowOffsetX', 'shadowOffsetY', 'gradientAngle', 'shearX']) validateCoordinate(text[key]);
            for(const [key,min,max] of [['maxWidth',0,4096],['frameHeight',0,4096],['fontSize',6,96],['lineHeight',1,256],['scaleX',Number.MIN_VALUE,1000000],['scaleY',Number.MIN_VALUE,1000000]]){
                if(text[key]!=null&&(typeof text[key]!=='number'||!Number.isFinite(text[key])||text[key]<min||text[key]>max))throw new Error('Некорректный параметр текста: '+key);
            }
            if(text.align!=null&&!['left','center','right'].includes(text.align))throw new Error('Некорректное выравнивание текста.');
            if(text.rotation!=null&&(typeof text.rotation!=='number'||!Number.isFinite(text.rotation)||Math.abs(text.rotation)>360))throw new Error('Некорректный поворот текста.');
            for(const key of ['flipX','flipY','autoLeading'])if(text[key]!=null&&typeof text[key]!=='boolean')throw new Error('Некорректное отражение текста.');
            if (text.gradientColors != null && (!Array.isArray(text.gradientColors) || text.gradientColors.length < 2 || text.gradientColors.length > 32
                || text.gradientColors.some(color => !/^#[\da-f]{6}$/i.test(color)))) throw new Error('Некорректные цвета градиента текста.');
        }
        for (const key of ['x0', 'y0', 'x1', 'y1', 'radius', 'strokeWidth', 'stroke']) validateCoordinate(layer.shapeData?.[key]);
        if (layer.sourceRect) {
            for (const key of ['x', 'y', 'w', 'h']) validateCoordinate(layer.sourceRect[key]);
            if (!(layer.sourceRect.w > 0 && layer.sourceRect.h > 0)) throw new Error('Некорректная область исходного изображения.');
        }
        const ancestors = new Set(layer.id == null ? [] : [String(layer.id)]);
        let parentId = layer.groupId;
        while (parentId != null) {
            const key = String(parentId);
            const parent = layersById.get(key);
            if (ancestors.has(key) || !parent || !(parent.isGroup || parent.type === 'group')) throw new Error('Повреждена структура групп слоёв.');
            ancestors.add(key);
            parentId = parent.groupId;
        }
        for (const [imageKey, imageData] of Object.entries({ dataUrl: layer.dataUrl, sourceDataUrl: layer.sourceDataUrl })) {
            if (imageData == null || imageData === '') continue;
            if (typeof imageData !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(imageData)) {
                throw new Error('Файл проекта содержит повреждённое изображение слоя.');
            }
            encodedBytes += imageData.length;
            if (encodedBytes > MAX_PROJECT_DATA_BYTES) {
                throw new Error('Файл проекта превышает безопасный предел размера 512 МБ.');
            }
            const image = readPngDimensions(imageData);
            if (imageKey === 'dataUrl' && (image.width !== layerWidth || image.height !== layerHeight)) {
                throw new Error('Размер изображения слоя не соответствует документу.');
            }
            if (imageKey === 'sourceDataUrl') pixels += image.width * image.height;
            if (pixels > MAX_PROJECT_PIXEL_COUNT) throw new Error('Исходные изображения проекта требуют слишком много памяти.');
        }
    }

    return { width, height, layerCount: project.layers.length, pixelCount: pixels, encodedBytes };
}

function validateCoordinate(value) {
    if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e6)) throw new Error('Некорректные координаты или параметры слоя.');
}

/** Inspect IHDR before asking the browser to allocate the decoded bitmap. */
export function readPngDimensions(dataUrl) {
    let bytes;
    try { bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1, dataUrl.indexOf(',') + 45)), char => char.charCodeAt(0)); }
    catch (_) { throw new Error('Файл проекта содержит повреждённое изображение PNG.'); }
    const signature = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
    if (bytes.length < 33 || signature.some((byte, index) => bytes[index] !== byte)) throw new Error('Файл проекта содержит повреждённое изображение PNG.');
    const view = new DataView(bytes.buffer);
    return { width: readDimension(view.getUint32(16), 0), height: readDimension(view.getUint32(20), 0) };
}

function readDimension(value, fallback) {
    if (value == null) return fallback;
    const dimension = Number(value);
    if (!Number.isInteger(dimension) || dimension < 1 || dimension > MAX_PROJECT_DIMENSION) {
        throw new Error(`Размер холста должен находиться в диапазоне от 1 до ${MAX_PROJECT_DIMENSION} пикселей.`);
    }
    return dimension;
}
