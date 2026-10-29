// Frontend-only preview for layout checks; does not start Electron.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '../src/renderer');
const port = Number(process.env.MOLLY_PREVIEW_PORT || 4192);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid preview port');
const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
    '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
    '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf'
};

const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return;
    }
    try {
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
        const relative = path.relative(root, file);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            res.writeHead(403); res.end(); return;
        }
        const data = await fs.readFile(file);
        res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
        res.writeHead(error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 400);
        res.end();
    }
});
server.listen(port, '127.0.0.1', () => console.log(`MollyStudio UI preview: http://127.0.0.1:${port}`));
