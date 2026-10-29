import {measureAsync, recordFailure} from './Performance.mjs';

const THRESHOLD = 256 * 1024;
let worker, disabled = false, sequence = 0;
const pending = new Map();
const unavailable = () => Object.assign(Error('Project codec unavailable'), {code: 'CODEC_UNAVAILABLE'});
const encodeSync = (operation, payload) => operation === 'parse' ? JSON.parse(payload.replace(/^\uFEFF/, '')) : JSON.stringify(payload);

function stop() {
    worker?.terminate();
    worker = null;
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(unavailable()); }
    pending.clear();
}

function background(operation, payload, transfer = []) {
    if (disabled || typeof Worker === 'undefined') {
        if (operation === 'png') { payload.close(); return Promise.resolve(null); }
        return Promise.resolve(encodeSync(operation, payload));
    }
    if (!worker) {
        try {
            worker = new Worker(new URL('../workers/ProjectCodecWorker.mjs', import.meta.url), {type: 'module'});
            worker.onmessage = ({data}) => {
                const task = pending.get(data.id);
                if (!task) return;
                pending.delete(data.id);
                clearTimeout(task.timer);
                if (data.ok) task.resolve(data.result);
                else task.reject(Object.assign(new Error(data.error), {name: data.name || 'Error'}));
            };
            worker.onerror = () => { disabled = true; stop(); };
        } catch { disabled = true; return background(operation, payload, transfer); }
    }
    return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { disabled = true; stop(); }, 30000);
        pending.set(id, {resolve, reject, timer});
        try { worker.postMessage({id, operation, payload}, transfer); }
        catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
    });
}

async function backgroundJSON(operation, payload) {
    try { return await background(operation, payload); }
    catch (error) {
        // Invalid JSON is a document error, not a reason to retry parsing it.
        if (error.code !== 'CODEC_UNAVAILABLE' && error.name !== 'DataCloneError') throw error;
        recordFailure('project-codec', error);
        return encodeSync(operation, payload);
    }
}

export function encodeProject(document) {
    const bytes = (document?.layers || []).reduce((size, layer) => size + (layer.dataUrl?.length || 0) + (layer.sourceDataUrl?.length || 0), 0);
    return measureAsync('project.encode', () => bytes < THRESHOLD ? JSON.stringify(document) : backgroundJSON('stringify', document));
}

export function decodeProject(text) {
    return measureAsync('project.decode', () => text.length < THRESHOLD ? encodeSync('parse', text) : backgroundJSON('parse', text));
}

export function codecStatus() { return {worker: !!worker, disabled, pending: pending.size, threshold: THRESHOLD}; }
if (typeof window !== 'undefined') window.addEventListener('pagehide', stop, {once: true});

export async function encodeCanvasPNG(canvas) {
    if (disabled || typeof Worker === 'undefined' || typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return null;
    return measureAsync('project.png', async () => {
        const bitmap = await createImageBitmap(canvas);
        try { return await background('png', bitmap, [bitmap]); }
        finally { bitmap.close(); }
    });
}
