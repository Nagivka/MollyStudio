const {spawn} = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

(async () => {
    const script = path.resolve(process.argv[2] || '');
    if (path.dirname(script) !== __dirname || !script.endsWith('.cjs')) throw Error('Unexpected scenario script.');
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'molly-electron-check-'));
    try {
        const env = {...process.env, MOLLY_TEST_PROFILE: profile};
        delete env.ELECTRON_RUN_AS_NODE;
        delete env.NODE_OPTIONS;
        const child = spawn(process.execPath, [script, ...process.argv.slice(3)], {stdio: 'inherit', windowsHide: true, env});
        process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
    } finally {
        if (path.dirname(profile) !== os.tmpdir() || !path.basename(profile).startsWith('molly-electron-check-')) throw Error('Invalid fixture cleanup path.');
        await fs.rm(profile, {recursive: true, force: true, maxRetries: 10, retryDelay: 200});
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
