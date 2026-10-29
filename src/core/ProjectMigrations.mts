export const CURRENT_PROJECT_VERSION = 2;
export interface MigrationResult {
    document: Record<string, unknown>;
    fromVersion: number;
    toVersion: number;
    steps: string[];
}
export function migrateProjectDocument(input: unknown): MigrationResult {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw Error('Файл проекта повреждён: данные проекта не найдены.');
    const source = input as Record<string, unknown>, raw = source['mollyVersion'] ?? 1;
    if ((typeof raw !== 'number' && typeof raw !== 'string') || !Number.isInteger(Number(raw)) || Number(raw) < 1)
        throw Error('Некорректная версия проекта.');
    const version = Number(raw);
    if (version > CURRENT_PROJECT_VERSION)
        throw Error('Этот файл создан в более новой версии MollyStudio. Обновите приложение.');
    // Copy the envelope; migrate only changed layer records. Pixel strings and source objects are never modified.
    const document = { ...source }, steps: string[] = [];
    if (version === 1) {
        document['type'] ??= 'gui';
        if (!document['config'])
            document['config'] = { width: source['width'] ?? 256, height: source['height'] ?? 256 };
        if (Array.isArray(source['layers']))
            document['layers'] = source['layers'].map((layer: unknown) => {
                if (!layer || typeof layer !== 'object' || Array.isArray(layer))
                    return layer;
                const copy = { ...(layer as Record<string, unknown>) };
                copy['type'] ??= copy['isGroup'] ? 'group' : 'bitmap';
                return copy;
            });
        steps.push('1→2');
    }
    document['mollyVersion'] = CURRENT_PROJECT_VERSION;
    return { document, fromVersion: version, toVersion: CURRENT_PROJECT_VERSION, steps };
}
