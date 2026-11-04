import {applyHistoryStep} from './typed/HistoryCursor.mjs';
/**
 * History - Robust Undo / Redo engine for MollyStudio.
 * Manages action history stacks, emits update events, and ensures seamless undo/redo
 * across drawing, transforms, layer actions, and floating selections.
 */
export default class History {
    constructor(bus) {
        this.bus = bus;
        this.state = {undoStack: [], redoStack: []};
        this.limit = 50;
        this.memoryBudgetBytes = 64 * 1024 * 1024;

        this.setupListeners();
    }

    get undoStack() { return this.state.undoStack; }
    set undoStack(value) { this.state.undoStack = value; }
    get redoStack() { return this.state.redoStack; }
    set redoStack(value) { this.state.redoStack = value; }
    bindState(state) { this.state = state; }

    /** Called by a restore command after it has been popped, before the cursor moves. */
    trackRestore(command, undo, previous) {
        const state=this.state, source=undo?state.undoStack:state.redoStack, destination=undo?state.redoStack:state.undoStack;
        const same=(first,second)=>first.length===second.length&&first.every((item,index)=>item===second[index]);
        const beforeSource=[...source,command],afterDestination=[...destination,command];
        const checkpoint=previous?.state===state?previous:{state,undo:[...(undo?beforeSource:destination)],redo:[...(undo?destination:beforeSource)]};
        const expectedUndo=[...(undo?source:afterDestination)],expectedRedo=[...(undo?afterDestination:source)];
        return {checkpoint,rollback:()=>{
            // A new edit invalidates this repair. A different active project does not.
            if(!same(state.undoStack,expectedUndo)||!same(state.redoStack,expectedRedo))return false;
            state.undoStack=[...checkpoint.undo];state.redoStack=[...checkpoint.redo];
            if(this.state===state)this.notifyChanged();return true;
        }};
    }

    setupListeners() {
        if (typeof document === 'undefined') return;

        const btnUndo = document.getElementById('btn-undo');
        const btnRedo = document.getElementById('btn-redo');

        if (btnUndo) {
            btnUndo.disabled = true;
            btnUndo.addEventListener('click', () => {const menu=window.mollyEditor?.menuBar;return menu?menu.handleAction('edit-undo'):this.undo();});
        }
        if (btnRedo) {
            btnRedo.disabled = true;
            btnRedo.addEventListener('click', () => {const menu=window.mollyEditor?.menuBar;return menu?menu.handleAction('edit-redo'):this.redo();});
        }

        this.bus.on('HISTORY_CHANGED', ({ canUndo, canRedo }) => {
            if (btnUndo) btnUndo.disabled = !canUndo;
            if (btnRedo) btnRedo.disabled = !canRedo;
        });

        // MenuBar owns keyboard shortcuts so each undo/redo is applied exactly once.
    }

    notifyChanged() {
        this.bus.emit('HISTORY_CHANGED', {
            canUndo: this.canUndo(),
            canRedo: this.canRedo(),
            entries: this.getEntries(),
            undoCount: this.undoStack.length,
            redoCount: this.redoStack.length
        });
    }

    push(command) {
        if (!command) return false;
        const memoryBytes = estimateCommandBytes(command);
        if (memoryBytes > this.memoryBudgetBytes) {
            // Older pixel snapshots cannot be applied safely across an untracked edit.
            this.undoStack = [];
            this.redoStack = [];
            this.notifyChanged();
            globalThis.window?.mollyEditor?.showToast?.(
                'Изменение слишком велико для отмены. История очищена; сохраните проект.', 'warning'
            );
            return false;
        }
        command.historyMemoryBytes = memoryBytes;
        this.undoStack.push(command);
        this.redoStack = [];

        while (this.undoStack.length > this.limit || this.getUndoMemoryBytes() > this.memoryBudgetBytes) {
            this.undoStack.shift();
        }
        this.notifyChanged();
        return true;
    }

    cancelPendingEdit() {
        const app=globalThis.window?.mollyEditor,tools=app?.tools,title=app?.titleEditor,viewport=title?.viewport;
        let cancelled=tools?.cancelPointer?.()===true;
        if(title?.project?.()&&viewport?.drag){viewport.cancelDrag();cancelled=true;}
        else if(title?.project?.()&&viewport?.cameraDirty&&title.pending?.project===title.project()){
            const {project,before}=title.pending;clearTimeout(viewport.cameraTimer);viewport.cameraDirty=false;title.pending=null;
            title.safeApply(project,before);title.sync();cancelled=true;
        }
        if (tools) {
            const moveTool = tools.tools?.move;
            if (moveTool && moveTool.transformMode) {
                moveTool.cancelTransform();
                cancelled=true;
            }
            const marquee = tools.tools?.marquee;
            if (marquee && (marquee.hasFloating?.() || marquee.floatingData || marquee.floatingCanvas)) {
                marquee.cancelFloating();
                cancelled=true;
            }
        }
        if(cancelled){this.bus.emit('CANVAS_UPDATED');this.notifyChanged();}
        return cancelled;
    }

    undo() {
        const text=globalThis.window?.mollyEditor?.tools?.tools?.text?.canvasEditor;
        if(text?.active)return text.undo(true);
        // Cancelling the current gesture is one undo, not an extra undo of a
        // previously committed operation as well.
        try{if(this.cancelPendingEdit())return true;}
        catch(error){this.reportFailure('отменить незавершённое действие',error);this.notifyChanged();return false;}

        if (this.undoStack.length === 0) return false;

        const moved=applyHistoryStep(this.undoStack,this.redoStack,true,error=>this.reportFailure('отменить действие',error));
        if(moved)this.bus.emit('CANVAS_UPDATED');
        this.notifyChanged();return moved;
    }

    redo() {
        const text=globalThis.window?.mollyEditor?.tools?.tools?.text?.canvasEditor;
        if(text?.active)return text.undo(false);
        try{if(this.cancelPendingEdit())return true;}
        catch(error){this.reportFailure('отменить незавершённое действие',error);this.notifyChanged();return false;}

        if (this.redoStack.length === 0) return false;

        const moved=applyHistoryStep(this.redoStack,this.undoStack,false,error=>this.reportFailure('повторить действие',error));
        if(moved)this.bus.emit('CANVAS_UPDATED');
        this.notifyChanged();return moved;
    }

    canUndo() {
        const text=globalThis.window?.mollyEditor?.tools?.tools?.text?.canvasEditor;
        if(text?.active)return !text.composing&&(!!text.drag||!!text.property||text.history.canUndo);
        return this.undoStack.length > 0;
    }

    reportFailure(action,error) {
        console.error(`History failed to ${action}:`,error);
        const message=error instanceof AggregateError
            ? 'Не удалось полностью восстановить состояние. Проверьте документ перед сохранением.'
            : `Не удалось ${action}. Шаг истории сохранён для повторной попытки.`;
        globalThis.window?.mollyEditor?.showToast?.(message,'error');
    }

    canRedo() {
        const text=globalThis.window?.mollyEditor?.tools?.tools?.text?.canvasEditor;
        if(text?.active)return !text.composing&&text.history.canRedo;
        return this.redoStack.length > 0;
    }

    clear() {
        this.undoStack = [];
        this.redoStack = [];
        this.notifyChanged();
    }

    getEntries() {
        const entries = [];
        // Initial clean state
        entries.push({
            index: 0,
            name: 'Начало доступной истории',
            icon: 'image',
            isCurrent: this.undoStack.length === 0,
            isFuture: false
        });

        // Applied undoable actions
        for (let i = 0; i < this.undoStack.length; i++) {
            const cmd = this.undoStack[i];
            const isLatest = (i === this.undoStack.length - 1);
            entries.push({
                index: i + 1,
                name: cmd.name || cmd.constructor?.name?.replace('Command', '') || 'Действие',
                icon: cmd.icon || 'edit',
                isCurrent: isLatest,
                isFuture: false
            });
        }

        // Undone actions (available for redo)
        for (let i = this.redoStack.length - 1; i >= 0; i--) {
            const cmd = this.redoStack[i];
            const stepIndex = this.undoStack.length + (this.redoStack.length - i);
            entries.push({
                index: stepIndex,
                name: cmd.name || cmd.constructor?.name?.replace('Command', '') || 'Действие',
                icon: cmd.icon || 'edit',
                isCurrent: false,
                isFuture: true
            });
        }

        return entries;
    }

    getUndoMemoryBytes() {
        return estimateHistoryBytes(this.undoStack);
    }

    jumpTo(targetIdx) {
        const text=globalThis.window?.mollyEditor?.tools?.tools?.text?.canvasEditor;
        if(text?.active&&text.finish(true)===false)return false;
        try{this.cancelPendingEdit();}
        catch(error){this.reportFailure('отменить незавершённое действие',error);this.notifyChanged();return false;}
        const currentIdx = this.undoStack.length;
        targetIdx = Math.max(0, Math.min(currentIdx + this.redoStack.length, Math.floor(Number(targetIdx) || 0)));
        if (targetIdx === currentIdx) return;

        if (targetIdx < currentIdx) {
            const steps = currentIdx - targetIdx;
            for (let i = 0; i < steps; i++) {
                if (!this.undo()) break;
            }
        } else {
            const steps = targetIdx - currentIdx;
            for (let i = 0; i < steps; i++) {
                if (!this.redo()) break;
            }
        }
    }
}

export function estimateHistoryBytes(commands) {
    const seen = new Set();
    return commands.reduce((total, command) => total + estimateCommandBytes(command, seen), 0);
}

export function estimateCommandBytes(command, seen = new Set()) {
    if (!command || seen.has(command)) return 0;
    seen.add(command);
    let total = 0;
    const countImage = image => {
        if (!image || seen.has(image)) return;
        seen.add(image);
        if (image.data && typeof image.data.byteLength==='number') total += image.data.byteLength;
        else if (image.width && image.height) total += image.width * image.height * 4;
        if (image.mollySnapshot?.sourceCanvas) countImage(image.mollySnapshot.sourceCanvas);
        if(image.mollySnapshot){const {sourceCanvas,...state}=image.mollySnapshot;total+=JSON.stringify(state).length*2;}
    };
    const imageDataFields = [
        'beforeData', 'afterData', 'lowerBeforeData', 'lowerAfterData'
    ];
    for (const field of imageDataFields) {
        countImage(command[field]);
    }
    countImage(command.oldSnap);
    countImage(command.newSnap);
    const countStructured = value => {
        if (typeof value === 'string') return value.length * 2;
        if (typeof value === 'number') return 8;
        if (typeof value === 'boolean') return 4;
        if (!value || typeof value !== 'object' || seen.has(value)) return 0;
        if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return 0;
        seen.add(value);
        return 32 + Object.entries(value).reduce((bytes, [key, item]) => bytes + key.length * 2 + countStructured(item), 0);
    };
    for (const field of ['before', 'after', 'oldTextData', 'newTextData', 'oldFX', 'newFX']) total += countStructured(command[field]);
    for (const child of command.commands || []) total += estimateCommandBytes(child, seen);
    if (Array.isArray(command?.oldLayers)) {
        const current = new Set(command.newLayers || []);
        for (const layer of command.oldLayers) {
            if (!current.has(layer)) { countImage(layer.canvas || layer); countImage(layer.sourceCanvas); }
        }
    }
    if (['RemoveLayerCommand', 'AddLayerCommand'].includes(command.constructor?.name) && command.layer) {
        countImage(command.layer.canvas || command.layer);
        countImage(command.layer.sourceCanvas);
    }
    countImage(command.upperLayer?.canvas);
    countImage(command.upperLayer?.sourceCanvas);
    return total;
}
