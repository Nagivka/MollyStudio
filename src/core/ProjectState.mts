import type { UndoableCommand } from './HistoryCursor.mjs';
export interface EditorState extends Record<string, unknown> {
    undoStack: UndoableCommand[];
    redoStack: UndoableCommand[];
}
export interface ProjectState {
    document: Record<string, unknown>;
    editor: EditorState;
}
const states = new WeakMap<object, ProjectState>();
const documentFields = ['type', 'name', 'config', 'layers', 'bg', 'templateName', 'templatePath', 'hasFrame', 'prefixData', 'titleData'];
const editorFields = ['undoStack', 'redoStack', 'activeLayerId', 'selectedLayerIds', 'layerCounter', 'zoom', 'panX', 'panY',
    'autoFitOnResize', 'guides', 'guidesVisible', 'tilingMode', 'referenceSrc', 'referenceOpacity', 'filePath', 'fileRevision',
    'closing', 'templateLoadPromise', 'prefixLoadPromise'];
/** Canonical stores with a temporary flat API for existing tools. No pixel copies. */
export function attachProjectState(project: Record<string, unknown>): ProjectState {
    const existing = states.get(project);
    if (existing)
        return existing;
    const state: ProjectState = { document: {}, editor: { undoStack: [], redoStack: [] } };
    for (const [fields, target] of [[documentFields, state.document], [editorFields, state.editor]] as const) {
        for (const key of fields) {
            if (Object.hasOwn(project, key))
                target[key] = project[key];
            Object.defineProperty(project, key, { enumerable: true, configurable: true,
                get: () => target[key], set: value => { target[key] = value; } });
        }
    }
    Object.defineProperties(project, {
        documentState: { value: state.document, configurable: true },
        editorState: { value: state.editor, configurable: true }
    });
    states.set(project, state);
    return state;
}
