const path = require('node:path');
const {pathToFileURL} = require('node:url');

const ORIGIN = 'molly://app';
const pages = new Set(['/', '/index.html', '/editor.html', '/settings.html', '/new-project.html', '/buttons.html']);
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-src 'none'; form-action 'none'";

function isAppPage(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'molly:' && url.hostname === 'app' && !url.port && !url.username && !url.password && pages.has(url.pathname);
    } catch { return false; }
}

function installProtocol(protocol, net, directory) {
    protocol.handle('molly', async request => {
        try {
            const url = new URL(request.url);
            if (url.protocol !== 'molly:' || url.hostname !== 'app' || url.port || url.username || url.password || !['GET', 'HEAD'].includes(request.method)) return new Response(null, {status: 403});
            const name = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
            if (/[\\\0:]/.test(name)) return new Response(null, {status: 403});
            const target = path.resolve(directory, '.' + name), relative = path.relative(directory, target);
            if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return new Response(null, {status: 403});
            const response = await net.fetch(pathToFileURL(target).href, {method: request.method});
            const headers = new Headers(response.headers);
            headers.set('Content-Security-Policy', CSP);
            headers.set('X-Content-Type-Options', 'nosniff');
            return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
        } catch (error) {
            console.warn('Application resource:', error.message);
            return new Response(null, {status: 404});
        }
    });
}

module.exports = {ORIGIN, CSP, isAppPage, installProtocol};
