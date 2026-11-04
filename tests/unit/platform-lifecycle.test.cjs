const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {installLifecycle}=require('../../src/main/lifecycle.cjs');
function fixture(platform){
    const app=new EventEmitter(),main=new EventEmitter(),windows={get:()=>windows.main,main};let quits=0,closes=0;
    app.quit=()=>{const event={defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};app.emit('before-quit',event);if(!event.defaultPrevented)quits++;};
    main.close=()=>closes++;main.isDestroyed=()=>false;installLifecycle(app,windows,platform);
    return {app,main,windows,get quits(){return quits;},get closes(){return closes;}};
}
test('macOS retains the app after closing the last window; other desktops quit',()=>{
    for(const platform of ['darwin','win32','linux']){const f=fixture(platform);f.windows.main=null;f.app.emit('window-all-closed');assert.equal(f.quits,platform==='darwin'?0:1);}
});
test('native quit waits for recovery, coalesces retries and supports cancelling Cmd+Q',()=>{
    const f=fixture('darwin');f.app.quit();f.app.quit();assert.equal(f.closes,1);assert.equal(f.quits,0);
    f.main.emit('molly-close-cancelled');assert.equal(f.main.listenerCount('closed'),0);
    f.app.quit();assert.equal(f.closes,2);f.windows.main=null;f.main.emit('closed');assert.equal(f.quits,1);
});
