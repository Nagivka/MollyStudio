import { createMenuConfig, validateMenuConfig, normalizeMenuPlugin } from './MenuDocument.mjs';

const DEFAULT_GUI_NAME = 'GUI Меню';
const DEFAULT_CANVAS_NAME = 'Холст 1';
const MAX_CANVAS_DIMENSION = 4096;

function readValue(source, id, fallback = '') {
    const element = source?.getElementById?.(id) ?? source?.querySelector?.(`#${id}`);
    return element?.value ?? fallback;
}

function validateDimensions(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height)
        || width < 1 || width > MAX_CANVAS_DIMENSION
        || height < 1 || height > MAX_CANVAS_DIMENSION) {
        throw new RangeError(`Размер холста должен быть целым числом от 1 до ${MAX_CANVAS_DIMENSION}.`);
    }
}

export function createGuiProject({
    name = DEFAULT_GUI_NAME,
    template = 'container_54',
    style = 'default',
    frame = true
} = {}) {
    const cleanName = String(name || DEFAULT_GUI_NAME).trim() || DEFAULT_GUI_NAME;
    const templateId = String(template || 'container_54');
    if (!/^(?:none|container_(?:9|18|27|36|45|54)|gui_container\/[a-z0-9_]+\.png)$/.test(templateId)) throw new Error('Неизвестная заготовка GUI.');
    const selectedStyle = normalizeGuiStyle(style);
    const resolvedTemplate = resolveGuiTemplate({ template: templateId, style: selectedStyle, frame });
    const hasFrame = resolvedTemplate.hasFrame;

    let width = 256;
    let height = 256;
    if (templateId === 'gui_container/villager.png') {
        width = 512;
        height = 256;
    } else if (templateId === 'gui_container/gamemode_switcher.png') {
        width = 128;
        height = 128;
    }

    return {
        name: cleanName,
        type: 'gui',
        template: resolvedTemplate.template,
        width,
        height,
        bg: 'transparent',
        hasFrame,
        isNew: true
    };
}

export function resolveGuiTemplate({ template = 'container_54', style = 'default', frame = true } = {}) {
    const templateId = String(template || 'container_54');
    if (!/^(?:none|container_(?:9|18|27|36|45|54)|gui_container\/[a-z0-9_]+\.png)$/.test(templateId)) throw new Error('Неизвестная заготовка GUI.');
    const selectedStyle = normalizeGuiStyle(style);
    const hasFrame = !templateId.startsWith('gui_container/')
        && templateId !== 'none'
        && Boolean(frame);

    let resolvedPath = 'none';
    if (templateId !== 'none') {
        if (templateId.startsWith('gui_container/')) resolvedPath = templateId;
        else resolvedPath = `container/${selectedStyle}/${templateId}${hasFrame ? '_frame' : ''}.png`;
    }
    return { template: resolvedPath, hasFrame };
}

function normalizeGuiStyle(style) {
    const value = String(style || 'default').toLowerCase();
    return value === 'bedrock' ? 'bedrock' : 'default';
}

export function createCanvasProject({
    name = DEFAULT_CANVAS_NAME,
    width = 32,
    height = 32,
    bg = 'transparent'
} = {}) {
    const dimensions = { width: Number(width), height: Number(height) };
    validateDimensions(dimensions.width, dimensions.height);
    return {
        name: String(name || DEFAULT_CANVAS_NAME).trim() || DEFAULT_CANVAS_NAME,
        type: 'canvas',
        template: 'none',
        ...dimensions,
        bg: ['transparent', 'white', 'black'].includes(bg) ? bg : 'transparent',
        hasFrame: false,
        isNew: true
    };
}

export function createProjectFromForm(source, type) {
    if (type === 'prefix') return createPrefixProject({ name: readValue(source, 'new-prefix-name', 'Префиксы 1') });
    if (type === 'deluxemenu') return createDeluxeMenuProject({ name: readValue(source, 'new-deluxemenu-name', 'Меню 1'), menuPlugin: readValue(source, 'new-menu-plugin', 'deluxemenus') || 'deluxemenus' });
    if (type === 'canvas') {
        return createCanvasProject({
            name: readValue(source, 'new-canvas-name', DEFAULT_CANVAS_NAME),
            width: readValue(source, 'new-canvas-w', 32),
            height: readValue(source, 'new-canvas-h', 32),
            bg: readValue(source, 'new-canvas-bg', 'transparent')
        });
    }

    return createGuiProject({
        name: readValue(source, 'new-proj-name', DEFAULT_GUI_NAME),
        template: readValue(source, 'new-proj-template', 'container_54'),
        style: readValue(source, 'new-proj-style', 'default'),
        frame: readValue(source, 'new-proj-frame', 'yes') === 'yes'
    });
}

export function normalizeProjectData(data = {}) {
    if (data.type === 'prefix') return createPrefixProject(data);
    if (data.type === 'deluxemenu') return createDeluxeMenuProject(data);
    const type = data.type === 'canvas' ? 'canvas' : 'gui';
    if (type === 'canvas') {
        return createCanvasProject({
            name: data.name,
            width: data.width ?? 32,
            height: data.height ?? 32,
            bg: data.bg
        });
    }

    const template = String(data.template || 'container/default/container_54.png');
    if (!/^(?:none|container\/(?:default|bedrock)\/container_(?:9|18|27|36|45|54)(?:_frame)?\.png|gui_container\/[a-z0-9_]+\.png)$/.test(template)) throw new Error('Неизвестная заготовка GUI.');
    const defaultSize = template === 'gui_container/villager.png'
        ? { width: 512, height: 256 }
        : template === 'gui_container/gamemode_switcher.png'
            ? { width: 128, height: 128 }
            : { width: 256, height: 256 };
    const width = Number(data.width ?? defaultSize.width);
    const height = Number(data.height ?? defaultSize.height);
    validateDimensions(width, height);
    return {
        name: String(data.name || DEFAULT_GUI_NAME).trim() || DEFAULT_GUI_NAME,
        type,
        template,
        width,
        height,
        bg: 'transparent',
        hasFrame: template.startsWith('gui_container/')
            ? false
            : Boolean(data.hasFrame ?? template.includes('_frame')),
        isNew: true
    };
}

export function createPrefixProject({ name = 'Префиксы 1' } = {}) {
    return { name: String(name || 'Префиксы 1').trim() || 'Префиксы 1', type: 'prefix', template: 'none', width: 64, height: 16, bg: 'transparent', hasFrame: false, isNew: true };
}

export function createDeluxeMenuProject({ name = 'Меню 1', menuPlugin = 'deluxemenus', deluxeData } = {}) {
    normalizeMenuPlugin(menuPlugin);
    return {
        name: String(name || 'Меню 1').trim() || 'Меню 1',
        type: 'deluxemenu', template: 'none', width: 256, height: 256,
        bg: 'transparent', hasFrame: false, menuPlugin, deluxeData: validateMenuConfig(deluxeData ?? createMenuConfig(menuPlugin), menuPlugin), isNew: true
    };
}

export function buildEditorUrl(data, base = 'editor.html') {
    const project = normalizeProjectData(data);
    const params = new URLSearchParams({
        new: 'true',
        type: project.type,
        name: project.name,
        template: project.template,
        width: String(project.width),
        height: String(project.height),
        bg: project.bg
    });
    if (project.type === 'deluxemenu') params.set('menuPlugin', project.menuPlugin);
    return `${base}?${params.toString()}`;
}

