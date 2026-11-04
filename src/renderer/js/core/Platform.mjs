export function currentPlatform() {
    const native = globalThis.window?.desktopAPI?.platform;
    if (['win32', 'darwin', 'linux'].includes(native)) return native;
    const name = globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || '';
    return /mac/i.test(name) ? 'darwin' : /win/i.test(name) ? 'win32' : 'linux';
}
export const isMac = () => currentPlatform() === 'darwin';
export const primaryModifier = event => isMac() ? Boolean(event.metaKey) : Boolean(event.ctrlKey);
export function contextClick(event,platform=currentPlatform()){return platform==='darwin'&&event?.button===0&&event.ctrlKey;}
export function textNavigation(event,platform=currentPlatform()){
    const mac=platform==='darwin',horizontal=['ArrowLeft','ArrowRight'].includes(event.key),vertical=['ArrowUp','ArrowDown'].includes(event.key);
    if(!horizontal&&!vertical&&!['Home','End'].includes(event.key)||event.altKey&&!(mac&&horizontal))return null;
    if(event.key==='Home'||event.key==='End')return {kind:event.ctrlKey||event.metaKey?'document':'line',end:event.key==='End'};
    if(mac&&event.metaKey)return {kind:horizontal?'line':'document',end:['ArrowRight','ArrowDown'].includes(event.key)};
    return horizontal?{kind:'horizontal',direction:event.key==='ArrowLeft'?-1:1,word:mac?!!event.altKey:!!(event.ctrlKey||event.metaKey)}:{kind:'vertical',direction:event.key==='ArrowUp'?-1:1};
}
export function projectPathKey(value,platform=currentPlatform()){
    const file=String(value||'');
    // POSIX permits backslashes and distinguishes differently cased names.
    // Retain recognition of Windows paths in migrated session metadata.
    return platform==='win32'||/^(?:[a-z]:[\\/]|\\\\)/i.test(file)?file.replaceAll('\\','/').toLowerCase():platform==='darwin'?file.normalize('NFC'):file;
}
export function shortcutLabel(text, platform = currentPlatform()) {
    return platform === 'darwin' ? String(text).replace(/\bCtrl(?=\+)/g, 'Cmd').replace(/\bAlt(?=\+)/g, 'Option') : String(text);
}
