const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {RendererRequests} = require('../../src/main/renderer-requests.cjs');
const {Windows} = require('../../src/main/windows.cjs');

function window() {
    const target = new EventEmitter();
    target.id = 1; target.isDestroyed = () => false;
    target.webContents = new EventEmitter();
    target.webContents.isDestroyed = () => false;
    target.webContents.isLoadingMainFrame = () => false;
    target.webContents.getURL = () => 'molly://app/editor.html';
    target.messages = [];
    target.webContents.send = (name, data) => target.messages.push({name, data});
    return target;
}

test('a generator waits for its actual editor acknowledgement, not an unrelated window', async () => {
    const relay = new RendererRequests(), target = window(), source = window();
    let finished = false;
    const pending = relay.request(target, source, 'button-generated', {w: 16, h: 16}).then(value => { finished = true; return value; });
    const id = target.messages[0].data.id;
    await Promise.resolve(); assert.equal(finished, false);
    assert.equal(relay.complete(source.webContents, {id, success: true}), false);
    assert.equal(finished, false);
    assert.equal(relay.complete(target.webContents, {id, success: true}), true);
    assert.equal(await pending, true);
    assert.equal(relay.pending.size, 0);
    assert.equal(source.listenerCount('closed'), 0);
});

test('navigation cancels an in-flight transfer and rejects its late reply', async () => {
    const relay = new RendererRequests(), target = window(), source = window();
    const pending = relay.request(target, source, 'button-generated', {}), id = target.messages[0].data.id;
    const rejected = assert.rejects(pending, /Передача отменена/);
    target.webContents.emit('did-navigate'); await rejected;
    assert.equal(target.messages.at(-1).name, 'molly:renderer-cancel');
    assert.equal(relay.complete(target.webContents, {id, success: true}), false);
    assert.equal(relay.pending.size, 0);
});

test('closing waits for accepted native writes after renderer recovery is complete', async () => {
    let release, destroyed = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const windows = new Windows({}, {beforeClose: () => gate}), target = window();
    target.destroy = () => { destroyed++; };
    windows.closing.set(1, {token: 'close', phase: 'flushing'});
    const closing = windows.completeClose(target, {token: 'close', success: true});
    await Promise.resolve(); assert.equal(destroyed, 0);
    release(); assert.equal(await closing, true); assert.equal(destroyed, 1);
});

test('an old confirmation cannot cancel a newer native-close request', async () => {
    let answer;
    const windows = new Windows({dialog: {showMessageBox: () => new Promise(resolve => { answer = resolve; })}}), target = window();
    windows.closing.set(1, {token: 'old', phase: 'flushing'});
    const old = windows.completeClose(target, {token: 'old', success: true, confirmClose: true});
    const replacement = {phase: 'native-closing'};
    windows.closing.set(1, replacement);
    answer({response: 0}); assert.equal(await old, false);
    assert.equal(windows.closing.get(1), replacement);
});
