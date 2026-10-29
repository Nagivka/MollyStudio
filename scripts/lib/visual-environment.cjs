const {createHash} = require('node:crypto');
function visualEnvironment(platform, userAgent, fonts) {
    return {runtime: 'electron-chromium', platform, userAgent,
        fonts: Object.fromEntries(Object.keys(fonts).sort().map(name => [name, createHash('sha256').update(fonts[name]).digest('hex')]))};
}
function sameVisualEnvironment(a, b) {
    if (!a || !b) return false;
    return ['runtime', 'platform', 'userAgent'].every(key => a[key] === b[key])
        && Object.keys(a.fonts || {}).length > 0
        && Object.keys(a.fonts).length === Object.keys(b.fonts || {}).length
        && Object.entries(a.fonts).every(([key, value]) => b.fonts[key] === value);
}
module.exports = {visualEnvironment, sameVisualEnvironment};
