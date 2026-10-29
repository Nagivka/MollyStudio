let infoPromise;

/** Local application metadata; does not contact any service. */
export function getApplicationInfo() {
    infoPromise ??= (async () => {
        const api = window.desktopAPI;
        if (api?.getAppInfo) return api.getAppInfo();
        return { name: 'MollyStudio', author: 'nagivka', license: 'MIT', version: await api?.getAppVersion?.() || '—', distribution: 'browser' };
    })().catch(() => {
        infoPromise = null;
        return { name: 'MollyStudio', author: 'nagivka', version: '—', license: 'MIT' };
    });
    return infoPromise;
}
