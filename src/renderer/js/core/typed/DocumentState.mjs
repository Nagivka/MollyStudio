export const PROJECT_TYPES = Object.freeze(['gui', 'canvas', 'prefix']);
export function isProjectType(value) { return PROJECT_TYPES.includes(value); }
/** Project data only: no DOM, selections, tool state, file paths or undo stacks. */
export function readDocumentState(project, config = project['config']) {
    const type = project['type'] ?? 'gui';
    if (!isProjectType(type))
        throw Error('Неизвестный тип проекта.');
    const value = config;
    const dimension = (n) => typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 4096 ? n : 256;
    return { type, name: String(project['name'] || 'Новый проект'), config: { width: dimension(value?.width), height: dimension(value?.height) },
        bg: project['bg'] ?? null, templateName: project['templateName'] ?? 'container_54', templatePath: project['templatePath'] ?? null, hasFrame: !!project['hasFrame'],
        ...(type === 'prefix' ? { prefixData: structuredClone(project['prefixData']) } : {}) };
}
