import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import { DesktopBridge } from '../../src/renderer/js/core/DesktopBridge.js';

async function withDesktopApi(api, callback) {
    const hadWindow = Object.hasOwn(globalThis, 'window');
    const previousWindow = globalThis.window;
    globalThis.window = { desktopAPI: api };
    try {
        return await callback();
    } finally {
        if (hadWindow) globalThis.window = previousWindow;
        else delete globalThis.window;
    }
}

test('desktop bridge delegates native operations to the isolated Electron API', async () => {
    const calls = [];
    const api = { runtime: 'electron',
        minimize: () => calls.push(['minimize']),
        maximize: () => Promise.resolve(true),
        close: () => calls.push(['close']),
        isMaximized: () => Promise.resolve(true),
        showSaveDialog: options => Promise.resolve({ canceled: false, filePath: options.defaultPath }),
        showOpenDialog: options => Promise.resolve({ canceled: false, filePaths: options.filePaths }),
        writeFile: (...args) => { calls.push(['writeFile', ...args]); return Promise.resolve(true); },
        readFile: (...args) => Promise.resolve(args),
        getPathForFile: file => `native:${file.name}`
    };

    await withDesktopApi(api, async () => {
        assert.equal(DesktopBridge.isElectron(), true);
        assert.equal(DesktopBridge.isNative(), true);
        DesktopBridge.minimize();
        DesktopBridge.close();
        assert.equal(await DesktopBridge.maximize(), true);
        assert.equal(await DesktopBridge.isMaximized(), true);
        assert.deepEqual(await DesktopBridge.showSaveDialog({ defaultPath: 'project.mlst' }), {
            canceled: false,
            filePath: 'project.mlst'
        });
        assert.deepEqual(await DesktopBridge.showOpenDialog({ filePaths: ['project.mlst'] }), {
            canceled: false,
            filePaths: ['project.mlst']
        });
        assert.deepEqual(await DesktopBridge.readFile('project.mlst', 'utf8'), ['project.mlst', 'utf8']);
        assert.equal(DesktopBridge.getPathForFile({ name: 'image.png' }), 'native:image.png');
        assert.equal(await DesktopBridge.exportPng('image.png', 'data:image/png;base64,aGVsbG8='), true);
        assert.deepEqual(calls, [
            ['minimize'],
            ['close'],
            ['writeFile', 'image.png', 'aGVsbG8=', 'base64']
        ]);
    });
});

test('desktop bridge has safe browser fallbacks and rejects malformed PNG exports', async () => {
    await withDesktopApi(undefined, async () => {
        assert.equal(DesktopBridge.isElectron(), false);
        assert.equal(DesktopBridge.isNative(), false);
        assert.deepEqual(await DesktopBridge.showSaveDialog(), { canceled: true });
        assert.deepEqual(await DesktopBridge.showOpenDialog(), { canceled: true, filePaths: [] });
        assert.equal(DesktopBridge.getPathForFile({ path: 'legacy.png' }), 'legacy.png');
        assert.throws(() => DesktopBridge.exportPng('image.png', 'data:text/plain;base64,aGVsbG8='), TypeError);
        assert.throws(() => DesktopBridge.writeFile('project.mlst', '{}'), /Desktop file API is unavailable/);
    });
});

test('runtime acknowledges close only after every recovery handler finishes and permits retries', async () => {
    const events=new Map(),calls=[],errors=[];
    const window={dispatchEvent(){}};
    const electron={contextBridge:{exposeInMainWorld:(name,value)=>{window[name]=value;}},webUtils:{getPathForFile:()=>''},
        ipcRenderer:{invoke:async(name,action,data)=>{calls.push({name,action,data});return {ok:true,value:false};},on:(name,callback)=>{events.set(name,callback);},removeListener(){}}};
    const context={require:()=>electron,process:{platform:process.platform,arch:process.arch},window,document:{addEventListener(){}},Event:class{},console:{error:(...args)=>errors.push(args)}};
    vm.runInNewContext(await readFile(new URL('../../src/preload/index.cjs',import.meta.url),'utf8'),context);
    let release;const gate=new Promise(resolve=>{release=resolve;});
    const unlisten=window.desktopAPI.onFlushRecoveryDrafts(async()=>{await gate;return {confirmClose:true};});
    events.get('flush-recovery-drafts')(null,{token:1});
    await new Promise(setImmediate);assert.equal(calls.length,0);
    release();await new Promise(setImmediate);
    assert.equal(calls.length,1);assert.equal(calls[0].action,'recovery-drafts-flushed');
    assert.equal(calls[0].data.token,1);assert.equal(calls[0].data.success,true);assert.equal(calls[0].data.confirmClose,true);
    unlisten();const stopFailure=window.desktopAPI.onFlushRecoveryDrafts(()=>false);
    events.get('flush-recovery-drafts')(null,{token:2});await new Promise(setImmediate);
    assert.equal(calls[1].data.success,false);stopFailure();
    events.get('flush-recovery-drafts')(null,{token:3});await new Promise(setImmediate);
    assert.equal(calls[2].data.success,true);assert.equal(calls[2].data.confirmClose,false);assert.deepEqual(errors,[]);
});

test('close cancellation permits a new request and confirmation destroys the window exactly once', async () => {
    const {createRequire}=await import('node:module');
    const {Windows}=createRequire(import.meta.url)('../../src/main/windows.cjs');
    let response=0,destroyed=0;
    const windows=new Windows({dialog:{showMessageBox:async()=>({response})}});
    const window={id:1,isDestroyed:()=>false,destroy:()=>{destroyed++;},emit(){},webContents:{send(){}}};
    windows.closing.set(1,{token:'first',phase:'flushing'});
    assert.equal(await windows.completeClose(window,{token:'first',success:true,confirmClose:true}),false);
    assert.equal(windows.closing.has(1),false);assert.equal(destroyed,0);
    response=1;windows.closing.set(1,{token:'second',phase:'flushing'});
    assert.equal(await windows.completeClose(window,{token:'second',success:true,confirmClose:true}),true);
    assert.equal(destroyed,1);
    assert.equal(await windows.completeClose(window,{token:'second',success:true}),false);
});

test('native close confirmation uses the selected application language', async () => {
    const {createRequire}=await import('node:module');
    const {Windows}=createRequire(import.meta.url)('../../src/main/windows.cjs');
    const prompts=[];
    const windows=new Windows({dialog:{showMessageBox:async(_window,options)=>{prompts.push(options);return {response:0};}}});
    const window={id:1,isDestroyed:()=>false,emit(){},webContents:{send(){}}};
    for(const language of ['en','ru']){
        windows.language=language;
        windows.closing.set(1,{token:language,phase:'flushing'});
        assert.equal(await windows.completeClose(window,{token:language,success:true,confirmClose:true}),false);
    }
    assert.equal(prompts[0].title,'Close MollyStudio?');
    assert.deepEqual(prompts[0].buttons,['Go back','Close']);
    assert.match(prompts[0].detail,/Recovery copies/);
    assert.equal(prompts[1].title,'Закрыть MollyStudio?');
    assert.deepEqual(prompts[1].buttons,['Вернуться','Закрыть']);
});
