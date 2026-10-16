/**
 * History - Robust Undo / Redo engine for MollyStudio.
 * Manages action history stacks, emits update events, and ensures seamless undo/redo
 * across drawing, transforms, layer actions, and floating selections.
 */
export default class History {
    constructor(bus) {
        this.bus = bus;
        this.undoStack = [];
        this.redoStack = [];
        this.limit = 50;
        this.memoryBudgetBytes = 64 * 1024 * 1024;

        this.setupListeners();
    }

    setupListeners() {
        if (typeof document === 'undefined') return;

        const btnUndo = document.getElementById('btn-undo');
        const btnRedo = document.getElementById('btn-redo');

        if (btnUndo) {
            btnUndo.disabled = true;
            btnUndo.addEventListener('click', () => this.undo());
        }
        if (btnRedo) {
            btnRedo.disabled = true;
            btnRedo.addEventListener('click', () => this.redo());
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

    undo() {
        globalThis.window?.mollyEditor?.tools?.cancelPointer?.();
        if (globalThis.window?.mollyEditor?.tools) {
            const moveTool = window.mollyEditor.tools.tools['move'];
            if (moveTool && moveTool.transformMode) {
                moveTool.cancelTransform();
            }
            const marquee = window.mollyEditor.tools.tools['marquee'];
            if (marquee && (marquee.hasFloating?.() || marquee.floatingData || marquee.floatingCanvas)) {
                marquee.cancelFloating();
            }
        }

        if (this.undoStack.length === 0) return false;

        const cmd = this.undoStack.pop();
        try {
            cmd.undo();
        } catch (err) {
            console.error('Error during undo execution:', err);
            this.undoStack.push(cmd);
            this.notifyChanged();
            return false;
        }
        this.redoStack.push(cmd);
        
        this.bus.emit('CANVAS_UPDATED');
        this.notifyChanged();
        return true;
    }

    redo() {
        globalThis.window?.mollyEditor?.tools?.cancelPointer?.();
        if (globalThis.window?.mollyEditor?.tools) {
            const moveTool = window.mollyEditor.tools.tools['move'];
            if (moveTool && moveTool.transformMode) {
                moveTool.cancelTransform();
            }
            const marquee = window.mollyEditor.tools.tools['marquee'];
            if (marquee && (marquee.hasFloating?.() || marquee.floatingData || marquee.floatingCanvas)) {
                marquee.cancelFloating();
            }
        }

        if (this.redoStack.length === 0) return false;

        const cmd = this.redoStack.pop();
        try {
            cmd.execute();
        } catch (err) {
            console.error('Error during redo execution:', err);
            this.redoStack.push(cmd);
            this.notifyChanged();
            return false;
        }
        this.undoStack.push(cmd);
        
        this.bus.emit('CANVAS_UPDATED');
        this.notifyChanged();
        return true;
    }

    canUndo() {
        return this.undoStack.length > 0;
    }

    canRedo() {
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
            name: 'Исходный холст',
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
        return this.undoStack.reduce((total, command) => total + (command.historyMemoryBytes ?? estimateCommandBytes(command)), 0);
    }

    jumpTo(targetIdx) {
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

export function estimateCommandBytes(command, seen = new Set()) {
    if (!command || seen.has(command)) return 0;
    seen.add(command);
    let total = 0;
    const countImage = image => {
        if (!image || seen.has(image)) return;
        seen.add(image);
        if (image.data?.byteLength) total += image.data.byteLength;
        else if (image.width && image.height) total += image.width * image.height * 4;
        if (image.mollySnapshot?.sourceCanvas) countImage(image.mollySnapshot.sourceCanvas);
    };
    const imageDataFields = [
        'beforeData', 'afterData', 'lowerBeforeData', 'lowerAfterData'
    ];
    for (const field of imageDataFields) {
        countImage(command[field]);
    }
    countImage(command.oldSnap);
    countImage(command.newSnap);
    for (const child of command.commands || []) total += estimateCommandBytes(child, seen);
    if (Array.isArray(command?.oldLayers)) {
        const current = new Set(command.newLayers || []);
        for (const layer of command.oldLayers) {
            if (!current.has(layer)) countImage(layer.canvas || layer);
        }
    }
    if (['RemoveLayerCommand', 'AddLayerCommand'].includes(command.constructor?.name) && command.layer) {
        countImage(command.layer.canvas || command.layer);
    }
    countImage(command.upperLayer?.canvas);
    return total;
}
