export function currentPlatform() {
    const native = globalThis.window?.desktopAPI?.platform;
    if (['win32', 'darwin', 'linux'].includes(native)) return native;
    const name = globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || '';
    return /mac/i.test(name) ? 'darwin' : /win/i.test(name) ? 'win32' : 'linux';
}
export const isMac = () => currentPlatform() === 'darwin';
export const primaryModifier = event => isMac() ? Boolean(event.metaKey) : Boolean(event.ctrlKey);
export function projectPathKey(value,platform=currentPlatform()){
    const file=String(value||'');
    // POSIX permits backslashes and distinguishes differently cased names.
    // Retain recognition of Windows paths in migrated session metadata.
    return platform==='win32'||/^(?:[a-z]:[\\/]|\\\\)/i.test(file)?file.replaceAll('\\','/').toLowerCase():platform==='darwin'?file.normalize('NFC'):file;
}
export function shortcutLabel(text, platform = currentPlatform()) {
    return platform === 'darwin' ? String(text).replace(/\bCtrl(?=\+)/g, 'Cmd').replace(/\bAlt(?=\+)/g, 'Option') : String(text);
}
