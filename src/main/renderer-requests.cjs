const {randomUUID} = require('node:crypto');
const {isAppPage} = require('./protocol.cjs');

/** A generator receives success only after the editor commits the insertion. */
class RendererRequests {
    constructor() { this.pending = new Map(); }
    request(target, source, name, data) {
        if (!target || target.isDestroyed() || target.webContents.isDestroyed()
            || target.webContents.isLoadingMainFrame() || !isAppPage(target.webContents.getURL())
            || new URL(target.webContents.getURL()).pathname !== '/editor.html') {
            return Promise.reject(Error('Откройте GUI-проект или обычный холст и повторите вставку.'));
        }
        const id = randomUUID(), contents = target.webContents;
        return new Promise((resolve, reject) => {
            let timeout;
            const settle = (error, value) => {
                if (!this.pending.delete(id)) return;
                clearTimeout(timeout);
                target.removeListener('closed', unavailable);
                source.removeListener('closed', unavailable);
                contents.removeListener('render-process-gone', unavailable);
                contents.removeListener('did-navigate', unavailable);
                if (error) {
                    try { if (!target.isDestroyed() && !contents.isDestroyed()) contents.send('molly:renderer-cancel', {id}); }
                    catch { /* A renderer can disappear between the two checks. */ }
                    reject(error);
                } else resolve(value);
            };
            const unavailable = () => settle(Error('Передача отменена: окно редактора или генератора было закрыто либо перезагружено.'));
            this.pending.set(id, {contents, settle});
            target.once('closed', unavailable);
            source.once('closed', unavailable);
            contents.once('render-process-gone', unavailable);
            contents.once('did-navigate', unavailable);
            timeout = setTimeout(() => settle(Error('Редактор не подтвердил вставку. Повторите после завершения текущей операции.')), 60000);
            timeout.unref?.();
            try { contents.send('molly:renderer-request', {id, name, data}); }
            catch (error) { settle(error); }
        });
    }
    complete(contents, result) {
        const request = this.pending.get(result?.id);
        if (!request || request.contents !== contents) return false;
        request.settle(result.success === true ? null : Error(typeof result.error === 'string' ? result.error.slice(0, 512) : 'Редактор не смог вставить кнопку.'), true);
        return true;
    }
}

module.exports = {RendererRequests};
