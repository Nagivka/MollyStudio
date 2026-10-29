const https = require('node:https');
const {REPOSITORY} = require('./update-security.cjs');
const redirects = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com']);
function allowedURL(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.hash) throw Error('UPDATE_UNTRUSTED_URL');
    if (url.hostname === 'api.github.com') {
        if (url.pathname !== `/repos/${REPOSITORY}/releases/latest`) throw Error('UPDATE_UNTRUSTED_URL');
    } else if (url.hostname === 'github.com') {
        if (!url.pathname.startsWith(`/${REPOSITORY}/releases/download/`)) throw Error('UPDATE_UNTRUSTED_URL');
    } else if (!redirects.has(url.hostname)) throw Error('UPDATE_UNTRUSTED_URL');
    return url;
}
function requestBuffer(value, limit = 64 * 1024, signal, hops = 0) {
    return new Promise((resolve, reject) => {
        let url;
        try { url = allowedURL(value); if (hops > 5) throw Error('UPDATE_REDIRECT_LIMIT'); } catch (error) { reject(error); return; }
        const request = https.get(url, {signal, headers: {'User-Agent': 'MollyStudio', Accept: 'application/vnd.github+json', 'Accept-Encoding': 'identity'}}, response => {
            if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
                response.resume();
                if (!response.headers.location) { reject(Error('UPDATE_NETWORK')); return; }
                let next;
                try { next = new URL(response.headers.location, url); allowedURL(next); } catch (error) { reject(error); return; }
                resolve(requestBuffer(next.href, limit, signal, hops + 1)); return;
            }
            if (response.statusCode !== 200) {
                response.resume(); reject(Error(response.statusCode === 403 || response.statusCode === 429 ? 'UPDATE_RATE_LIMIT' : 'UPDATE_NETWORK')); return;
            }
            const chunks = []; let length = 0;
            response.on('data', chunk => {
                length += chunk.length;
                if (length > limit) { response.destroy(Error('UPDATE_RESPONSE_LIMIT')); return; }
                chunks.push(chunk);
            });
            response.on('end', () => resolve(Buffer.concat(chunks, length)));
            response.on('error', reject);
            response.on('aborted', () => reject(Error('UPDATE_NETWORK')));
        });
        request.setTimeout(15000, () => request.destroy(Error('UPDATE_NETWORK')));
        request.on('error', reject);
    });
}
module.exports = {allowedURL, requestBuffer};
