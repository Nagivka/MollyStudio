const {spawn} = require('node:child_process');
const path = require('node:path');
const env = {...process.env};
// Parent developer tools can set these for their own Node processes.
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
const child = spawn(require('electron'), [path.resolve(__dirname, '..'), ...process.argv.slice(2)], {
    // This is a GUI executable. windowsHide also suppresses its first native
    // ShowWindow call on Windows, leaving a healthy app invisible after start.
    cwd: path.resolve(__dirname, '..'), env, stdio: 'inherit'
});
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
