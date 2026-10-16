/** Small convenience wrapper around the Electron preload API. */
export class DesktopBridge {
    static get api() {
        return typeof window !== 'undefined' ? window.electronAPI : undefined;
    }

    static isElectron() {
        return Boolean(this.api);
    }

    // Kept for existing UI checks; Electron is the only native runtime.
    static isNative() {
        return this.isElectron();
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
        return this.api?.showSaveDialog?.(options) ?? Promise.resolve({ canceled: true });
    }

    static showOpenDialog(options = {}) {
        return this.api?.showOpenDialog?.(options) ?? Promise.resolve({ canceled: true, filePaths: [] });
    }

    static writeFile(filePath, data, encoding) {
        if (!this.api?.writeFile) throw new Error('Electron file API is unavailable.');
        return this.api.writeFile(filePath, data, encoding);
    }

    static readFile(filePath, encoding) {
        if (!this.api?.readFile) throw new Error('Electron file API is unavailable.');
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
