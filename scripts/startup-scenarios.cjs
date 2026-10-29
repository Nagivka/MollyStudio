const fs = require('node:fs/promises');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const root = path.resolve(__dirname, '..');

(async () => {
    const checks = [], expect = (value, message) => { if (!value) throw Error(message); checks.push(message); };
    let child, socket, evaluateMain, exited, sequence = 0, output = '';
    const pending = new Map();
    const timer = setTimeout(() => { console.error('Startup check timed out', output); child?.kill(); process.exit(1); }, 30000);
    try {
        // Launch the very same Node wrapper as npm start. Playwright's direct
        // Electron launch does not exercise the wrapper's Win32 spawn flags.
        child = spawn(process.execPath, [path.join(root, 'scripts/start-electron.cjs'), '--inspect=0'], {
            cwd: root, env: {...process.env, ELECTRON_RUN_AS_NODE: '1', MOLLY_MANUAL_CHECK: '1'}, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
        });
        exited = new Promise(resolve => child.once('exit', resolve));
        child.stdout.on('data', data => { output += data; });
        const inspector = await new Promise((resolve, reject) => {
            child.once('error', reject);
            child.once('exit', code => reject(Error(`Startup wrapper exited early (${code}): ${output}`)));
            child.stderr.on('data', data => {
                output += data;
                const address = output.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/)?.[1];
                if (address) resolve(address);
            });
        });
        socket = new WebSocket(inspector);
        socket.addEventListener('message', event => {
            const message = JSON.parse(event.data), request = pending.get(message.id);
            if (!request) return;
            pending.delete(message.id);
            if (message.error || message.result.exceptionDetails) request.reject(Error(JSON.stringify(message.error || message.result.exceptionDetails)));
            else request.resolve(message.result.result.value);
        });
        await once(socket, 'open');
        evaluateMain = expression => new Promise((resolve, reject) => {
            const id = ++sequence;
            pending.set(id, {resolve, reject});
            socket.send(JSON.stringify({id, method: 'Runtime.evaluate', params: {expression, returnByValue: true, awaitPromise: true}}));
        });
        for (let attempt = 0; !await evaluateMain(`!!globalThis.__mollyTestRuntime?.windows.get('main')`); attempt++) {
            if (attempt === 99) throw Error('Private startup runtime did not initialize');
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        // Keep private IO/Discord/association guards, but exercise the exact
        // native window presentation path used by npm start. Never call show().
        await evaluateMain(`(() => {
            const runtime = globalThis.__mollyTestRuntime;
            const window = runtime.windows.get('main');
            runtime.startupEvents = [];
            for (const name of ['ready-to-show', 'show', 'did-finish-load']) {
                (name === 'did-finish-load' ? window.webContents : window).on(name, () => runtime.startupEvents.push(name));
            }
        })()`);
        let state;
        for (let attempt = 0; attempt < 80; attempt++) {
            state = await evaluateMain(`(() => {
                const runtime = globalThis.__mollyTestRuntime, window = runtime.windows.get('main');
                return {visible: window.isVisible(), loading: window.webContents.isLoadingMainFrame(), url: window.webContents.getURL(), events: runtime.startupEvents};
            })()`);
            if (state.visible && !state.loading) break;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        expect(state.visible, 'The native window becomes visible without a test calling show(): ' + JSON.stringify(state));
        expect(!state.loading && state.url === 'molly://app/index.html', 'The automatically shown window finishes loading its local page');
        expect(await evaluateMain(`(async () => {
            const window = globalThis.__mollyTestRuntime.windows.get('main');
            return window.webContents.executeJavaScript("!!document.getElementById('btn-open-settings') && document.body.innerText.includes('Создать проект')");
        })()`), 'The visible production window contains the initialized interface');
        await fs.writeFile(path.join(root, '.test-output/startup-scenarios.json'), JSON.stringify({passed: checks.length, checks}, null, 2));
        console.log(JSON.stringify({passed: checks.length, checks}, null, 2));
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally {
        if (socket?.readyState === WebSocket.OPEN && evaluateMain) {
            try { await evaluateMain(`setTimeout(() => globalThis.__mollyTestRuntime?.windows.electron.app.exit(0), 20); true`); }
            catch (error) { console.error('Startup fixture cleanup:', error.message); }
        }
        socket?.close();
        if (child && child.exitCode === null) await exited;
        clearTimeout(timer);
    }
})();
