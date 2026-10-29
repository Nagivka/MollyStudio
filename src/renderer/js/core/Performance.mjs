import {PerformanceJournal} from './typed/PerformanceJournal.mjs';

export const performanceJournal = new PerformanceJournal();
const OPERATIONAL_CODES = new Set(['EACCES', 'EPERM', 'ENOSPC', 'ENOENT', 'FILE_CHANGED', 'PROJECT_OPEN_DEFERRED', 'CODEC_UNAVAILABLE']);
const ERROR_NAMES = new Set(['Error', 'TypeError', 'SyntaxError', 'RangeError', 'ReferenceError', 'AggregateError', 'DOMException', 'SecurityError', 'DataCloneError', 'InvalidStateError']);

export function measureSync(name, operation) {
    const start = performance.now();
    try { return operation(); }
    finally { performanceJournal.record(name, performance.now() - start); }
}

export async function measureAsync(name, operation) {
    const start = performance.now();
    try { return await operation(); }
    finally { performanceJournal.record(name, performance.now() - start); }
}

/** Allowlisted codes only: even custom error names/codes may contain user text. */
export function recordFailure(kind, error) {
    const known = String(error?.message || '').match(/\b(?:EACCES|EPERM|ENOSPC|ENOENT|FILE_CHANGED|PROJECT_OPEN_DEFERRED)\b/)?.[0];
    const code = OPERATIONAL_CODES.has(error?.code) ? error.code : known || (ERROR_NAMES.has(error?.name) ? error.name : 'Error');
    performanceJournal.event(kind, code);
}

let installed = false;
export function installPerformanceMonitoring() {
    if (installed) return;
    installed = true;
    window.addEventListener('error', event => recordFailure('error', event.error));
    window.addEventListener('unhandledrejection', event => recordFailure('unhandled-rejection', event.reason));
    try {
        const observer = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) performanceJournal.record('ui.long-task', entry.duration);
        });
        observer.observe({type: 'longtask', buffered: true});
        window.addEventListener('pagehide', () => observer.disconnect(), {once: true});
    } catch { /* Long Task API is optional in browser previews. */ }
}

/** Keep synchronous returns synchronous, including undo and redo. */
export function instrumentMethods(target, names, prefix) {
    for (const name of names) {
        const original = target[name];
        if (typeof original !== 'function') continue;
        target[name] = function (...args) {
            const start = performance.now();
            const record = () => performanceJournal.record(prefix + '.' + name, performance.now() - start);
            const fail = error => { recordFailure(prefix + '.' + name, error); throw error; };
            try {
                const result = original.apply(this, args);
                if (result && typeof result.then === 'function') return Promise.resolve(result).catch(fail).finally(record);
                record();
                return result;
            } catch (error) { record(); return fail(error); }
        };
    }
}
