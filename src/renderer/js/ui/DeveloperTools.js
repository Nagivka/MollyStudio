import {layersAtPoint} from '../graphics/LayerPicking.mjs';
import {translate} from '../core/Locale.mjs';

export const developerChannel = 'molly-developer-tools';
const events = ['REQUEST_TOOL_CHANGE', 'LAYER_ADDED', 'LAYER_REMOVED', 'LAYER_ACTIVE_CHANGED', 'CANVAS_UPDATED'];
const limit = 100;

export function installDeveloperTools(app) {
    const canvas = document.getElementById('main-canvas');
    const channel = new BroadcastChannel(developerChannel);
    const readout = document.createElement('output');
    const outline = document.createElement('div');
    const marker = document.createElement('div');
    for (const [node, kind] of [[readout,'readout'],[outline,'outline'],[marker,'point']]) {
        node.className = 'developer-canvas-' + kind;
        node.hidden = true;
        document.body.append(node);
    }
    const settings = app.settingsManager;
    let pointer, frame = 0, recording = false, entries = [];
    const record = event => {
        if (!recording || !settings.get('developerUnlocked')) return;
        entries.push({ms: Math.round(performance.now()), event});
        if (entries.length > limit) entries.shift();
    };
    for (const event of events) app.bus.on(event, () => record(event));
    window.addEventListener('error', () => record('ERROR'));
    window.addEventListener('unhandledrejection', () => record('UNHANDLED_REJECTION'));
    channel.onmessage = ({data}) => {
        if (!settings.get('developerUnlocked') || typeof data?.id !== 'string') return;
        if (data.action === 'start') { entries = []; recording = true; }
        else if (data.action === 'stop') recording = false;
        else return;
        channel.postMessage({id: data.id, entries});
    };
    const position = (node, x, y) => {
        node.style.left = x + 'px';
        node.style.top = y + 'px';
    };
    const draw = () => {
        frame = 0;
        readout.hidden = outline.hidden = marker.hidden = true;
        if (!settings.get('developerUnlocked') || app.getActiveProject()?.type === 'title') return;
        const hits = settings.get('developerCanvasHits');
        const pixels = settings.get('developerPixelGrid');
        const rect = canvas.getBoundingClientRect();
        if ((!hits && !pixels) || !rect.width || !rect.height) return;
        const sx = rect.width / canvas.width, sy = rect.height / canvas.height, dpr = devicePixelRatio;
        const lines = [];
        readout.classList.toggle('developer-pixel-fractional', pixels &&
            [sx*dpr, sy*dpr, rect.left*dpr, rect.top*dpr].some(value => Math.abs(value-Math.round(value))>.02));
        if (pixels) {
            const error = value => (value - Math.round(value)).toFixed(2);
            lines.push(`DPR ${dpr} · ${(sx*dpr).toFixed(2)} × ${(sy*dpr).toFixed(2)} px`,
                `${translate('Смещение от сетки')}: ${error(rect.left*dpr)}, ${error(rect.top*dpr)} px`);
        }
        if (hits) {
            const bounds = app.layerManager.getActiveLayer()?.getBounds?.();
            if (bounds) {
                position(outline, rect.left+bounds.x*sx, rect.top+bounds.y*sy);
                outline.style.width = bounds.w*sx+'px';
                outline.style.height = bounds.h*sy+'px';
                outline.hidden = false;
            }
            if (pointer) {
                const x = Math.floor((pointer.x-rect.left)/sx), y = Math.floor((pointer.y-rect.top)/sy);
                const layers = layersAtPoint(app.layerManager.getLayers(), x, y, {canPick: layer => app.layerManager.isEditable?.(layer)!==false});
                lines.push(`X ${x} · Y ${y}`, layers.map(layer=>layer.name).join(' → ') || '—');
                position(marker, rect.left+x*sx, rect.top+y*sy);
                marker.hidden = false;
            }
        }
        readout.textContent = lines.join('\n');
        readout.hidden = !lines.length;
    };
    const schedule = () => {
        if (!frame && (settings.get('developerCanvasHits') || settings.get('developerPixelGrid') || !readout.hidden || !outline.hidden)) frame=requestAnimationFrame(draw);
    };
    const workspace = document.getElementById('canvas-wrapper');
    workspace.addEventListener('pointermove', event => { pointer={x:event.clientX,y:event.clientY}; schedule(); });
    workspace.addEventListener('pointerleave', () => { pointer=null; schedule(); });
    for (const event of ['CANVAS_UPDATED','LAYER_ACTIVE_CHANGED','LAYOUT_AUTO_SCALED','TEXT_VIEWPORT_CHANGED','PROJECT_SWITCHED']) app.bus.on(event,schedule);
    app.bus.on('SETTINGS_CHANGED', ({key}) => {
        if (!settings.get('developerUnlocked')) { recording=false; entries=[]; }
        if (key==='all' || key.startsWith('developer')) {
            schedule();
            app.titleEditor?.viewport?.redraw();
        }
    });
    window.addEventListener('pagehide', () => channel.close(), {once:true});
    schedule();
}
