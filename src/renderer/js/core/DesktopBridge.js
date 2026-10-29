import {translate} from './Locale.mjs';
const localizedOptions = options => ({...options,
    ...(options.title ? {title: translate(options.title)} : {}),
    ...(options.filters ? {filters: options.filters.map(filter => ({...filter, name: translate(filter.name)}))} : {})
});
/** Convenience wrapper around the Electron desktop API. */
export class DesktopBridge {
    static get api() {
        return typeof window !== 'undefined' ? window.desktopAPI : undefined;
    }

    static isElectron() {
        return this.api?.runtime === 'electron';
    }

    static isNative() {
        return Boolean(this.api);
    }

    static minimize() {
        return this.api?.minimize?.();
    }

    static maximize() {
        return this.api?.maximize?.() ?? Promise.resolve(false);
    }

    static close() {
        return this.api?.close?.();
    }

    static isMaximized() {
        return this.api?.isMaximized?.() ?? Promise.resolve(false);
    }

    static showSaveDialog(options = {}) {
        return this.api?.showSaveDialog?.(localizedOptions(options)) ?? Promise.resolve({ canceled: true });
    }

    static showOpenDialog(options = {}) {
        return this.api?.showOpenDialog?.(localizedOptions(options)) ?? Promise.resolve({ canceled: true, filePaths: [] });
    }

    static writeFile(filePath, data, encoding) {
        if (!this.api?.writeFile) throw new Error('Desktop file API is unavailable.');
        return this.api.writeFile(filePath, data, encoding);
    }

    static readFile(filePath, encoding) {
        if (!this.api?.readFile) throw new Error('Desktop file API is unavailable.');
        return this.api.readFile(filePath, encoding);
    }

    static exportPng(filePath, dataUrl) {
        if (typeof dataUrl !== 'string' || !/^data:image\/png;base64,/i.test(dataUrl)) {
            throw new TypeError('Expected a PNG data URL.');
        }
        const base64Data = dataUrl.slice(dataUrl.indexOf(',') + 1);
        return this.writeFile(filePath, base64Data, 'base64');
    }

    static showItemInFolder(filePath) {
        return this.api?.showItemInFolder?.(filePath);
    }

    static openPath(targetPath) {
        return this.api?.openPath?.(targetPath);
    }

    static getDocumentsPath() {
        return this.api?.getDocumentsPath?.() ?? Promise.resolve('');
    }

    static getPathForFile(file) {
        if (!file) return '';
        return this.api?.getPathForFile?.(file) || file.path || '';
    }
}

if (typeof window !== 'undefined') {
    window.DesktopBridge = DesktopBridge;
}
