const {_electron} = require('playwright-core');
const {spawn} = require('node:child_process');
const {EventEmitter} = require('node:events');
const fs = require('node:fs/promises');
const {realpathSync} = require('node:fs');
const path = require('node:path');
const pngImage = require('./png-image.cjs');
const root = path.resolve(__dirname, '../..'), profile = process.env.MOLLY_TEST_PROFILE ? realpathSync.native(process.env.MOLLY_TEST_PROFILE) : null;
if (!profile || !path.basename(profile).startsWith('molly-electron-check-')) throw Error('Use scripts/run-electron-check.cjs.');
const windows = [];
let application, context, options = {}, exiting = false, log = '';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function environment() {
    const env = {...process.env, MOLLY_TEST_PROFILE: profile};
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS;
    return env;
}
async function ready(settings = {}) {
    options = settings;
    const intelGraphics=process.env.CI&&process.platform==='darwin'&&process.arch==='x64'&&settings.graphics;
    // Hosted Intel Macs have no Metal-capable GPU. Probe CI-only backends;
    // these switches are never part of application startup or distributions.
    const candidates=intelGraphics?[
        ['--use-gl=angle','--use-angle=gl','--ignore-gpu-blocklist'],
        ['--use-gl=angle','--use-angle=swiftshader-webgl','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'],
        ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'],
        ['--use-gl=angle','--use-angle=metal','--ignore-gpu-blocklist']
    ]:[process.env.CI&&process.platform==='linux'?['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']:[]];
    const probes=[];
    for(const switches of candidates){
        application = await _electron.launch({executablePath: require('electron'),args:[root,'--force-device-scale-factor=1','--lang=ru',...switches,...(settings.args||[])],env:environment(),timeout:30000});
        if(!intelGraphics)break;
        const page=await application.firstWindow(),available=await page.evaluate(()=>{const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl',{antialias:true,preserveDrawingBuffer:true});if(!gl)return false;gl.getExtension('WEBGL_lose_context')?.loseContext();return true;});
        probes.push({switches,available,features:await application.evaluate(({app})=>app.getGPUFeatureStatus())});
        if(available)break;
        await application.evaluate(({app})=>app.exit(0));await application.close();application=null;
    }
    if(intelGraphics){await fs.mkdir(path.join(root,'.test-output'),{recursive:true});await fs.writeFile(path.join(root,'.test-output/ci-graphics.json'),JSON.stringify(probes,null,2));if(!application)throw Error('No WebGL backend on the hosted Intel Mac: '+JSON.stringify(probes));}
    application.process().stdout?.on('data', bytes => { log += bytes; });
    application.process().stderr?.on('data', bytes => { log += bytes; });
    context = application.context();
    await context.route(/^https?:\/\//, route => route.abort());
    await application.firstWindow();
    await application.evaluate(() => { if (!globalThis.__mollyTestRuntime) throw Error('Private test runtime is unavailable.'); });
}
async function command(action, data) {
    return application.evaluate(async (_electron, {action, data}) => {
        const runtime = globalThis.__mollyTestRuntime;
        return runtime.dispatch(runtime.windows.get('main'), 'main', action, data);
    }, {action, data});
}
class NativeWindow extends EventEmitter {
    constructor(width, height, {label} = {}) {
        super();
        const labels = ['main', 'settings', 'buttons', 'new-project'];
        this.label = label || labels.find(label => !windows.some(window => !window.disposed && window.label === label));
        if (!labels.includes(this.label) || windows.some(window => !window.disposed && window.label === this.label)) throw Error('Invalid or duplicate fixture window.');
        this.width = width; this.height = height; this.zoom = 1; this.__testErrors = []; this.queue = Promise.resolve();
        this.webContents = {
            executeJavaScript: source => this.run(() => this.page.evaluate(source)),
            capturePage: () => this.run(async () => {
                // Playwright waits for a compositor frame, which a hidden native
                // window need not produce even when its DOM is fully ready.
                await application.evaluate((_electron, label) => globalThis.__mollyTestRuntime.windows.get(label)?.showInactive(), this.label);
                return pngImage.createFromBuffer(await this.page.screenshot());
            }),
            setZoomFactor: zoom => { this.zoom = zoom; this.resize(); },
            insertCSS: css => this.run(() => this.page.addStyleTag({content: css})),
            insertText: text => this.run(() => this.page.keyboard.insertText(text)),
            sendInputEvent: event => this.run(() => event.type === 'keyDown' ? this.page.keyboard.down(event.keyCode) : this.page.keyboard.up(event.keyCode)),
            send: (name, payload) => this.run(() => command('test-control', {operation: 'emit', name, payload})),
            on: (name, handler) => { if (name === 'console-message') this.consoleHandler = handler; },
            forcefullyCrashRenderer: () => this.run(async () => { await this.cdp.send('Page.crash').catch(() => {}); this.emit('render-process-gone'); }),
            debugger: {attach() {}, sendCommand: (name, data) => this.run(() => this.cdp.send(name, data))}
        };
    }
    run(operation) { this.queue = this.queue.catch(() => {}).then(async () => { await this.ensure(); return operation(); }); return this.queue; }
    async ensure() {
        if (this.page) return;
        if (this.label === 'main') this.page = await application.firstWindow();
        else {
            const next = application.waitForEvent('window');
            await command('test-control', {operation: 'create', label: this.label});
            this.page = await next;
        }
        await this.page.waitForFunction(() => !!window.desktopAPI);
        this.page.on('crash', () => { this.crashed = true; });
        this.page.on('pageerror', error => this.__testErrors.push(error.message));
        this.page.on('console', message => {
            if (message.text().startsWith('[Scenario]')) console.log(message.text());
            if (message.type() === 'error' && !/ERR_BLOCKED_BY_CLIENT|Failed to load resource/.test(message.text())) this.__testErrors.push(message.text());
            this.consoleHandler?.({level: message.type(), message: message.text()});
        });
        this.cdp = await context.newCDPSession(this.page);
    }
    resize() { return this.run(() => this.cdp.send('Emulation.setDeviceMetricsOverride', {width: Math.round(this.width / this.zoom), height: Math.round(this.height / this.zoom), deviceScaleFactor: this.zoom, mobile: false})); }
    async loadFile(file, {query = {}} = {}) {
        await this.run(async () => {
            const url = new URL(path.basename(file), 'molly://app/');
            Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
            await this.page.goto(url.href, {waitUntil: 'domcontentloaded'});
            await this.page.waitForFunction(() => !!window.desktopAPI);
        });
        await this.resize();
        if (path.basename(file) === 'editor.html') await this.page.waitForFunction(() => !!window.mollyEditor?.projectManager);
    }
    setContentSize(width, height) { this.width = width; this.height = height; this.resize(); }
    showInactive() {
        return this.run(() => application.evaluate((_electron, label) => globalThis.__mollyTestRuntime.windows.get(label)?.showInactive(), this.label));
    }
    destroy() { this.disposed = true; if (this.label !== 'main') command('test-control', {operation: 'destroy', label: this.label}).catch(() => {}); }
}
function makeWindow(width = 1280, height = 800, settings) { const window = new NativeWindow(width, height, settings); windows.push(window); return window; }
async function settle(window) {
    await window.run(() => window.page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); }));
    await delay(120);
}
async function stop() {
    if (!application) return;
    await application.evaluate(({app}) => app.exit(0)).catch(() => {});
    await application.close().catch(() => {});
}
async function restart() { await stop(); for (const window of windows) window.disposed = true; await ready(options); }
async function launchFiles(args) {
    const child = spawn(require('electron'), [root, ...args], {stdio: 'ignore', env: environment()});
    return new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
}
const app = {exit: async (code = 0) => {
    if (exiting) return; exiting = true;
    await fs.mkdir(path.join(root, '.test-output'), {recursive: true});
    await fs.writeFile(path.join(root, '.test-output/last-electron.log'), log);
    await stop(); process.exit(code);
}};
module.exports = {app, root, profile, ready, makeWindow, settle, command, restart, launchFiles, evaluateMain: (fn, arg) => application.evaluate(fn, arg)};
