export type FileOperation = 'save' | 'open' | 'export';
export interface FileProblem {
    kind: 'changed' | 'space' | 'permission' | 'busy' | 'missing' | 'unknown';
    message: string;
    action: 'save-copy' | 'choose-folder' | 'retry' | 'check-file';
}
/** The same native error can arrive with a code, a message, or an IPC wrapper. */
export function fileErrorInfo(error: unknown, operation: FileOperation = 'save'): FileProblem {
    const value = error && typeof error === 'object' ? error as {
        message?: unknown;
        code?: unknown;
    } : null;
    const message = String(value?.code ?? '') + ' ' + String(value?.message ?? error ?? '');
    if (/FILE_CHANGED/.test(message))
        return { kind: 'changed', message: 'Файл изменился на диске. Сохраните текущую версию отдельным файлом.', action: 'save-copy' };
    if (/ENOSPC|disk.*full|места на диске|os error 112/i.test(message))
        return { kind: 'space', message: 'Недостаточно места на диске. Освободите место или выберите другой диск.', action: 'choose-folder' };
    if (/EACCES|EPERM|permission denied|access.*denied|отказано в доступе|os error 5\b/i.test(message))
        return { kind: 'permission', message: 'Нет доступа к файлу или папке. Выберите доступную папку.', action: 'choose-folder' };
    if (/EBUSY|sharing violation|другим процессом|os error 32\b/i.test(message))
        return { kind: 'busy', message: 'Файл занят другой программой. Закройте её или сохраните под другим именем.', action: 'retry' };
    if (/ENOENT|not found|не удается найти|не удаётся найти|os error [23]\b/i.test(message))
        return { kind: 'missing', message: 'Файл или папка больше не существует. Проверьте путь.', action: 'check-file' };
    if (operation === 'open')
        return { kind: 'unknown', message: 'Не удалось открыть проект. Проверьте формат и целостность .mlst; уже открытые проекты сохранены во вкладках.', action: 'check-file' };
    if (operation === 'export')
        return { kind: 'unknown', message: 'Не удалось записать изображение. Повторите экспорт или выберите другую папку.', action: 'choose-folder' };
    return { kind: 'unknown', message: 'Не удалось записать проект. Данные остаются в открытой вкладке; попробуйте другую папку.', action: 'choose-folder' };
}
export function fileErrorMessage(error: unknown, operation: FileOperation = 'save'): string {
    return fileErrorInfo(error, operation).message;
}
