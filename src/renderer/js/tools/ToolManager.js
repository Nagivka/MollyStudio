import {bindText} from '../core/Locale.mjs';
import {contextClick} from '../core/Platform.mjs';
import BrushTool from './BrushTool.js';
import PencilTool from './PencilTool.js';
import EraserTool from './EraserTool.js';
import BucketTool from './BucketTool.js';
import GradientTool from './GradientTool.js';
import PipetteTool from './PipetteTool.js';
import LineTool from './LineTool.js';
import RectTool from './RectTool.js';
import CircleTool from './CircleTool.js';
import MarqueeTool from './MarqueeTool.js';
import TextTool from './TextTool.js';
import MoveTool from './MoveTool.js';
import HandTool from './HandTool.js';
import { isShortcutTarget } from '../ui/KeyboardNavigation.js';
import { setPressedState } from '../ui/ControlState.js';

export default class ToolManager {
    constructor(bus, layerManager, history) {
        this.bus = bus;
        this.layerManager = layerManager;
        this.history = history;

        this.color = '#3B82F6';
        this.size = 1;
        this.toolSizes = Object.create(null);
        this.currentToolId = 'brush';
        this.symmetryX = false;
        this.symmetryY = false;
        this.pointerSession = null;

        const moveTransformTool = new MoveTool(bus, layerManager, history);
        const marqueeTool = new MarqueeTool(bus, layerManager, history);

        this.tools = {
            'move': moveTransformTool,
            'transform': moveTransformTool,
            'marquee': marqueeTool,
            'lasso': marqueeTool,
            'wand': marqueeTool,
            'brush': new BrushTool(bus, layerManager, history),
            'pencil': new PencilTool(bus, layerManager, history),
            'eraser': new EraserTool(bus, layerManager, history),
            'bucket': new BucketTool(bus, layerManager, history),
            'gradient': new GradientTool(bus, layerManager, history),
            'pipette': new PipetteTool(bus, layerManager, history),
            'line': new LineTool(bus, layerManager, history),
            'rect-empty': new RectTool(bus, layerManager, history, false),
            'rect-filled': new RectTool(bus, layerManager, history, true),
            'circle-empty': new CircleTool(bus, layerManager, history, false),
            'circle-filled': new CircleTool(bus, layerManager, history, true),
            'text': new TextTool(bus, layerManager, history),
            'hand': new HandTool(bus, layerManager, history)
        };

        for (const key of Object.keys(this.tools)) {
            this.tools[key].toolManager = this;
        }

        this.bus.on('COLOR_CHANGED', (hex) => {
            this.color = hex;
            if (this.currentToolId === 'move' || this.currentToolId === 'transform') {
                this.bus.emit('RECOLOR_ACTIVE_LAYER', hex);
            }
        });

        this.bus.on('REQUEST_TOOL_CHANGE', (toolId) => {
            this.setTool(toolId);
        });

        this.bus.on('LAYER_ACTIVE_CHANGED', () => {
            this.updateContextualOptions(this.currentToolId);
        });

        this.setupUI();
    }

    setupUI() {
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && this.pointerSession) {
                this.cancelPointer();
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);
        document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
            setPressedState(btn, this.tools[btn.dataset.tool] === this.tools[this.currentToolId]);
            btn.addEventListener('click', () => {const menu=window.mollyEditor?.menuBar;if(menu)menu.handleAction('tool:'+btn.dataset.tool);else this.setTool(btn.dataset.tool);});
        });

        // Recolor buttons
        document.getElementById('btn-recolor-object')?.addEventListener('click', () => {
            this.bus.emit('RECOLOR_ACTIVE_LAYER', this.color);
        });
        document.getElementById('btn-recolor-line')?.addEventListener('click', () => {
            this.bus.emit('RECOLOR_ACTIVE_LAYER', this.color);
        });
        document.getElementById('btn-recolor-rect-empty')?.addEventListener('click', () => {
            this.bus.emit('RECOLOR_ACTIVE_LAYER', this.color);
        });
        document.getElementById('btn-recolor-rect-filled')?.addEventListener('click', () => {
            this.bus.emit('RECOLOR_ACTIVE_LAYER', this.color);
        });
        document.getElementById('btn-recolor-circle-empty')?.addEventListener('click', () => {
            this.bus.emit('RECOLOR_ACTIVE_LAYER', this.color);
        });
        document.getElementById('btn-recolor-circle-filled')?.addEventListener('click', () => {
            this.bus.emit('RECOLOR_ACTIVE_LAYER', this.color);
        });
        document.getElementById('btn-prop-recolor')?.addEventListener('click', () => {
            const marquee = this.tools['marquee'];
            if (['marquee','lasso','wand'].includes(this.currentToolId) && marquee?.selection) {
                marquee.recolorSelection?.(this.color);
            } else {
                this.bus.emit('RECOLOR_ACTIVE_LAYER', this.color);
            }
        });

        // Pixel perfect toggle in pencil option bar
        document.getElementById('pencil-pixel-perfect')?.addEventListener('change', (e) => {
            window.mollyEditor?.settingsManager?.set('pixelPerfect', e.target.checked);
        });

        // Symmetry controls (X horizontal mirror, Y vertical mirror)
        const syncSymmetryUI = () => {
            document.querySelectorAll('.btn-toggle-symm-x').forEach(btn => {
                setPressedState(btn, this.symmetryX);
            });
            document.querySelectorAll('.btn-toggle-symm-y').forEach(btn => {
                setPressedState(btn, this.symmetryY);
            });
            this.bus.emit('SYMMETRY_CHANGED', { symmetryX: this.symmetryX, symmetryY: this.symmetryY });
        };
        this.syncSymmetryUI = syncSymmetryUI;

        document.querySelectorAll('.btn-toggle-symm-x').forEach(btn => {
            btn.addEventListener('click', () => {
                this.symmetryX = !this.symmetryX;
                syncSymmetryUI();
            });
        });

        document.querySelectorAll('.btn-toggle-symm-y').forEach(btn => {
            btn.addEventListener('click', () => {
                this.symmetryY = !this.symmetryY;
                syncSymmetryUI();
            });
        });

        const sizeBindings = [
            ['brush', 'tool-size', 'tool-size-num', 64],
            ['pencil', 'pencil-size', 'pencil-size-num', 32],
            ['eraser', 'eraser-size', 'eraser-size-num', 64],
            ['line', 'line-size', 'line-size-num', 16],
            ['rect-empty', 'rect-stroke', 'rect-stroke-num', 16],
            ['circle-empty', 'circle-stroke', 'circle-stroke-num', 16]
        ];
        const syncSize = val => {
            const limit = sizeBindings.find(([tool]) => tool === this.currentToolId)?.[3] || 64;
            this.size = Math.max(1, Math.min(limit, parseInt(val, 10) || 1));
            this.toolSizes[this.currentToolId] = this.size;
            for (const [tool, sliderId, numberId] of sizeBindings) {
                const value = this.toolSizes[tool] || 1;
                const slider = document.getElementById(sliderId), number = document.getElementById(numberId);
                if (slider) slider.value = value;
                if (number) number.value = value;
            }
            for (const id of ['prop-shape-stroke-slider', 'prop-shape-stroke-num']) {
                const input = document.getElementById(id);
                if (input) input.value = Math.min(16, this.size);
            }
            this.bus.emit('TOOL_SIZE_CHANGED', this.size);
        };
        this.syncSize = syncSize;

        ['tool-size', 'pencil-size', 'eraser-size', 'line-size', 'rect-stroke', 'circle-stroke', 'prop-shape-stroke-slider'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', (e) => syncSize(e.target.value));
        });

        ['tool-size-num', 'pencil-size-num', 'eraser-size-num', 'line-size-num', 'rect-stroke-num', 'circle-stroke-num', 'prop-shape-stroke-num'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', (e) => syncSize(e.target.value));
        });

        document.addEventListener('keydown', (e) => {
            if (e.defaultPrevented || isShortcutTarget(e.target, e)) return;

            // Shift+X / Shift+Y toggle symmetry modes
            if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
                if (e.code === 'KeyX' || e.key === 'X' || e.key === 'Ч' || e.key === 'ч') {
                    e.preventDefault();
                    this.symmetryX = !this.symmetryX;
                    this.syncSymmetryUI?.();
                    return;
                }
                if (e.code === 'KeyY' || e.key === 'Y' || e.key === 'Н' || e.key === 'н') {
                    e.preventDefault();
                    this.symmetryY = !this.symmetryY;
                    this.syncSymmetryUI?.();
                    return;
                }
            }

            const codeShortcuts = {
                'KeyM': 'marquee',
                'KeyV': 'move',
                'KeyK': 'move',
                'KeyB': 'brush',
                'KeyP': 'pencil',
                'KeyE': 'eraser',
                'KeyG': e.shiftKey ? 'gradient' : 'bucket',
                'KeyI': 'pipette',
                'KeyL': 'line',
                'KeyT': 'text',
                'KeyH': 'hand',
                'KeyU': e.shiftKey ? 'rect-filled' : 'rect-empty',
                'KeyC': e.shiftKey ? 'circle-filled' : 'circle-empty',
                'KeyO': e.shiftKey ? 'circle-filled' : 'circle-empty'
            };

            const targetTool = codeShortcuts[e.code];
            if (targetTool && !e.ctrlKey && !e.altKey && !e.metaKey) {
                e.preventDefault();
                this.setTool(targetTool);
            }
        });

        this.updateContextualOptions('brush');
    }

    setSize(val) {
        if (typeof this.syncSize === 'function') {
            this.syncSize(val);
        }
    }

    changeSize(delta) {
        if (typeof this.syncSize === 'function') {
            this.syncSize(this.size + delta);
        }
    }

    setTool(toolId) {
        const projectType = globalThis.window?.mollyEditor?.getActiveProject?.()?.type;
        if (['prefix','title'].includes(projectType) && !['hand', 'pipette'].includes(toolId)) return;
        const nextTool = this.tools[toolId];
        if (!nextTool) return;

        const previousTool = this.tools[this.currentToolId];
        if (this.pointerSession && (this.pointerSession.tool !== nextTool || this.currentToolId!==toolId)) {
            this.finishPointer();
        }

        if (previousTool !== nextTool && typeof previousTool?.deactivate === 'function') {
            if (previousTool.deactivate() === false) return;
        }

        this.currentToolId = toolId;
        this.syncSize?.(this.toolSizes?.[toolId] || 1);

        document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
            setPressedState(btn, ['marquee','lasso','wand'].includes(toolId)?btn.dataset.tool===toolId:this.tools[btn.dataset.tool] === nextTool);
        });

        this.updateContextualOptions(toolId);
        this.syncSymmetryUI?.();
        this.bus.emit('TOOL_CHANGED', toolId);
        this.tools.marquee?.renderSelectionOverlay?.();
    }

    selectTool(toolId) {
        this.setTool(toolId);
    }

    updateContextualOptions(toolId) {
        document.querySelectorAll('.opt-group').forEach(g => g.classList.remove('visible'));

        const map = {
            'brush': 'opt-bar-brush',
            'pencil': 'opt-bar-pencil',
            'eraser': 'opt-bar-eraser',
            'move': 'opt-bar-move',
            'transform': 'opt-bar-move',
            'marquee': 'opt-bar-marquee',
            'lasso': 'opt-bar-marquee',
            'wand': 'opt-bar-marquee',
            'bucket': 'opt-bar-bucket',
            'gradient': 'opt-bar-gradient',
            'text': 'opt-bar-text',
            'line': 'opt-bar-line',
            'rect-empty': 'opt-bar-rect-empty',
            'rect-filled': 'opt-bar-rect-filled',
            'circle-empty': 'opt-bar-circle-empty',
            'circle-filled': 'opt-bar-circle-filled',
            'hand': 'opt-bar-hand',
            'pipette': 'opt-bar-pipette'
        };

        const targetId = map[toolId];
        document.querySelector('.options-bar')?.classList.toggle('is-empty', ['hand', 'circle-filled'].includes(toolId));
        document.querySelectorAll('[data-wand-options]').forEach(node=>node.hidden=toolId!=='wand');
        document.querySelectorAll('[data-selection-hint]').forEach(node=>bindText(node, ['lasso','wand'].includes(toolId)?'Shift — добавить · Alt — вычесть · M — двигать область':'B — рисовать внутри · Ctrl+D — снять'));
        if (targetId) {
            const el = document.getElementById(targetId);
            if (el) el.classList.add('visible');
        }

        const activeLayer = this.layerManager ? this.layerManager.getActiveLayer() : null;
        const canResample = activeLayer && !['text', 'group'].includes(activeLayer.type) && !activeLayer.isBase && !activeLayer.isGroup;
        const bitmapControls = document.getElementById('move-bitmap-controls');
        if (bitmapControls) {
            bitmapControls.style.display = canResample ? 'inline-flex' : 'none';
        }
    }

    getActiveTool() {
        return this.tools[this.currentToolId] || null;
    }

    onPointerDown(x, y, e) {
        if(contextClick(e))return;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        if (this.pointerSession) this.finishPointer();
        const tool = this.getActiveTool();
        if (!tool) return;
        const layer = this.layerManager.getActiveLayer();
        const session = {
            tool,
            layer,
            x,
            y,
            color: this.color,
            size: this.size,
            event: e
        };
        this.pointerSession = session;
        try {
            tool.onPointerDown(x, y, session.color, session.size, layer, e);
        } catch (error) {
            return this.failGesture(tool,error);
        }
    }

    onPointerMove(x, y, e) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const session = this.pointerSession;
        const tool = session?.tool || this.getActiveTool();
        if (!tool) return;
        const layer = session?.layer ?? this.layerManager.getActiveLayer();
        if (session) Object.assign(session, { x, y, event: e });
        try { tool.onPointerMove(x, y, session?.color ?? this.color, session?.size ?? this.size, layer, e); }
        catch (error) { return this.failGesture(tool,error); }
    }

    onPointerUp(x, y, e) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return this.finishPointer();
        const session = this.pointerSession;
        if (session) {
            Object.assign(session, { x, y, event: e });
            return this.finishPointer();
        }
        const tool = this.getActiveTool();
        if (!tool) return;
        tool.onPointerUp(x, y, this.color, this.size, this.layerManager.getActiveLayer(), e);
    }

    finishPointer() {
        const session = this.pointerSession;
        if (!session) return false;

        this.pointerSession = null;
        return this.withGestureBoundary(() => {
            try {
                session.tool.onPointerUp(
                    session.x,
                    session.y,
                    session.color,
                    session.size,
                    session.layer,
                    session.event
                );
                if(['brush','pencil','bucket','line','rect-empty','rect-filled','circle-empty','circle-filled'].some(id=>this.tools[id]===session.tool))this.bus.emit('COLOR_COMMITTED',session.color);
                return true;
            } catch (error) {
                return this.failGesture(session.tool,error);
            }
        });
    }

    failGesture(tool,error) {
        return this.withGestureBoundary(() => {
            this.pointerSession=null;
            console.error('Tool gesture failed:',error);
            try { tool.cancelAction?.(); }
            catch (cancelError) { console.error('Unable to restore the failed tool gesture:',cancelError); }
            this.bus?.emit('TOOL_GESTURE_CANCELLED');
            globalThis.window?.mollyEditor?.showToast?.('Не удалось завершить действие инструмента. Повторите попытку.','error');
            return false;
        });
    }

    withGestureBoundary(action) {
        const previous=this.settlingGesture;
        this.settlingGesture=true;
        try { return action(); }
        finally {
            this.settlingGesture=previous;
            if(!previous)this.bus?.emit('CANVAS_UPDATED');
        }
    }

    cancelPointer() {
        const session = this.pointerSession;
        if (!session) return false;
        return this.withGestureBoundary(() => {
            this.pointerSession = null;
            session.tool.cancelAction?.();
            this.bus?.emit('TOOL_GESTURE_CANCELLED');
            return true;
        });
    }

    finishDocument({ preserveSelection = false } = {}) {
        if(globalThis.window?.mollyEditor?.titleEditor?.commitPendingEdit?.()===false)return false;
        if (globalThis.window?.mollyEditor?.prefixEditor?.commitPendingEdit?.() === false) return false;
        if (this.pointerSession && !this.finishPointer()) return false;
        if(this.tools.text?.commitPendingEdit?.()===false)return false;
        const marquee = this.tools.marquee;
        if (preserveSelection) {
            if (marquee?.hasFloating()) marquee.commitFloating(marquee.floatingLayer || this.layerManager.getActiveLayer());
        } else marquee?.clearSelection();
        if (marquee?.hasFloating()) return false;
        this.bus.emit('PREVIEW_CLEARED');
        marquee?.renderSelectionOverlay?.();
        return true;
    }

    onHoverMove(x, y, e) {
        const tool = this.getActiveTool();
        if (!tool || typeof tool.onHoverMove !== 'function') return;
        tool.onHoverMove(x, y, e);
    }
}
