const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

(async () => {
    const script = path.resolve(process.argv[2] || '');
    const scripts = path.resolve(__dirname);
    if (path.dirname(script) !== scripts || !script.endsWith('.cjs')) throw new Error('Unexpected test script');
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'molly-electron-check-'));
    try {
        const child = spawn(require('electron'), [script, ...process.argv.slice(3)], {
            stdio: 'inherit', windowsHide: true,
            env: { ...process.env, MOLLY_TEST_PROFILE: profile }
        });
        process.exitCode = await new Promise((resolve, reject) => {
            child.once('error', reject);
            child.once('exit', code => resolve(code == null ? 1 : code));
        });
    } finally {
        // This process owns the exact mkdtemp directory; Chromium has exited before removal.
        if (path.dirname(profile) !== os.tmpdir() || !path.basename(profile).startsWith('molly-electron-check-')) throw new Error('Invalid fixture cleanup path');
        await fs.rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
