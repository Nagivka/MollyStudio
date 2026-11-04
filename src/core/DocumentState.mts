export type ProjectType = 'gui' | 'canvas' | 'prefix' | 'title';
export interface DocumentConfig {
    width: number;
    height: number;
}
export interface DocumentState {
    type: ProjectType;
    name: string;
    config: DocumentConfig;
    bg: unknown;
    templateName: unknown;
    templatePath: unknown;
    hasFrame: boolean;
    prefixData?: unknown;
    titleData?: unknown;
}
export const PROJECT_TYPES: readonly ProjectType[] = Object.freeze(['gui', 'canvas', 'prefix', 'title']);
export function isProjectType(value: unknown): value is ProjectType { return PROJECT_TYPES.includes(value as ProjectType); }
/** Project data only: no DOM, selections, tool state, file paths or undo stacks. */
export function readDocumentState(project: Record<string, unknown>, config = project['config']): DocumentState {
    const type = project['type'] ?? 'gui';
    if (!isProjectType(type))
        throw Error('Неизвестный тип проекта.');
    const value = config as Partial<DocumentConfig> | undefined;
    const dimension = (n: unknown): number => typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 4096 ? n : 256;
    return { type, name: String(project['name'] || 'Новый проект'), config: { width: dimension(value?.width), height: dimension(value?.height) },
        bg: project['bg'] ?? null, templateName: project['templateName'] ?? 'container_54', templatePath: project['templatePath'] ?? null, hasFrame: !!project['hasFrame'],
        ...(type === 'title' ? { titleData: structuredClone(project['titleData']) } : {}),
        ...(type === 'prefix' ? { prefixData: structuredClone(project['prefixData']) } : {}) };
}
