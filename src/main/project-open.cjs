const fs = require('node:fs');
const path = require('node:path');
const {pathKey} = require('./storage.cjs');

class ProjectRequests {
    constructor() { this.nextId = 0; this.requests = []; }
    enqueue(args, cwd = process.cwd()) {
        for (const value of args.slice(0, 64)) {
            if (typeof value !== 'string' || value.startsWith('-') || value.includes('\0') || path.extname(value).toLowerCase() !== '.mlst') continue;
            let file = path.resolve(cwd, value);
            try { file = fs.realpathSync.native(file); } catch { /* Keep missing paths for an actionable editor error. */ }
            if (this.requests.some(request => pathKey(request.path) === pathKey(file))) continue;
            this.requests.push({id: ++this.nextId, path: file});
        }
    }
    pending() { return this.requests.map(request => ({...request})); }
    acknowledge(id) { this.requests = this.requests.filter(request => request.id !== id); }
}
module.exports = {ProjectRequests};
