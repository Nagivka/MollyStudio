/** Native requests remain queued across launcher → editor navigation. */
export function installProjectOpenRequests({ launcher = false, manager } = {}) {
    const api = window.desktopAPI;
    if (!api?.getPendingProjectOpens) return () => {};
    let disposed = false, running = false, again = false, waiting = false;
    const drain = async () => {
        if (running) { again = true; return; }
        running = true;
        waiting = false;
        try {
            do {
                again = false;
                const requests = await api.getPendingProjectOpens();
                if (disposed || !requests?.length) break;
                if (launcher) { location.replace('editor.html?external=true'); break; }
                for (const request of requests) {
                    if (disposed) break;
                    const result=await manager.openRecentProject(request.path);
                    if(disposed)break;
                    if(result?.deferred){waiting=true;again=false;break;}
                    await api.acknowledgeProjectOpen(request.id);
                }
            } while (again && !waiting && !disposed);
        } catch (error) { console.error('Открытие проекта из Windows:', error); }
        finally { running = false; }
    };
    const retry=()=>{if(waiting&&!disposed)void drain();};
    const stopRetry=manager?.app?.bus?.on('HISTORY_CHANGED',retry);
    globalThis.document?.addEventListener?.('change',retry);
    const stop = api.onProjectOpenRequested(drain);
    const stopClose = api.onCloseStateChange?.(closing => { if (!closing) retry(); });
    void drain();
    return () => { disposed = true; stop?.();stopClose?.();stopRetry?.();globalThis.document?.removeEventListener?.('change',retry); };
}
