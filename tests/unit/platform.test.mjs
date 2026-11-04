import test from 'node:test';
import assert from 'node:assert/strict';
import {eventChord,displayChord,SHORTCUT_COMMANDS,shortcutKeys} from '../../src/renderer/js/core/Shortcuts.mjs';
import {projectPathKey,shortcutLabel,textNavigation,contextClick} from '../../src/renderer/js/core/Platform.mjs';
test('default shortcut documents use Command on Mac and Control on Windows/Linux without changing saved bindings',()=>{
    const save=SHORTCUT_COMMANDS.find(c=>c.id==='file-save');
    assert.equal(eventChord({code:'KeyS',metaKey:true},'darwin'),shortcutKeys(save)[0]);
    assert.equal(eventChord({code:'KeyS',ctrlKey:true},'linux'),shortcutKeys(save)[0]);
    assert.equal(eventChord({code:'KeyS',ctrlKey:true},'win32'),shortcutKeys(save)[0]);
    assert.equal(eventChord({code:'KeyS',ctrlKey:true},'darwin'),'Meta+KeyS');
    assert.equal(displayChord('Ctrl+Alt+KeyS','darwin'),'Cmd+Option+S');
    assert.equal(displayChord('Meta+KeyS','darwin'),'Ctrl+S');
    assert.equal(displayChord('Meta+KeyS','linux'),'Super+S');
    assert.equal(shortcutLabel('Ctrl+S, Ctrl+Shift+S','darwin'),'Cmd+S, Cmd+Shift+S');
});
test('POSIX projects with different case and literal backslashes remain distinct',()=>{
    assert.notEqual(projectPathKey('/home/me/Menu.mlst','linux'),projectPathKey('/home/me/menu.mlst','linux'));
    assert.notEqual(projectPathKey('/home/me/a\\b.mlst','linux'),projectPathKey('/home/me/a/b.mlst','linux'));
    assert.equal(projectPathKey('C:\\Projects\\Menu.mlst','win32'),projectPathKey('c:/projects/menu.mlst','win32'));
    assert.equal(projectPathKey('C:\\Projects\\Menu.mlst','linux'),projectPathKey('c:/projects/menu.mlst','linux'));
    assert.equal(projectPathKey('/Users/me/é.mlst','darwin'),projectPathKey('/Users/me/e\u0301.mlst','darwin'));
    assert.notEqual(projectPathKey('/Users/me/Menu.mlst','darwin'),projectPathKey('/Users/me/menu.mlst','darwin'));
});
test('Mac text editing uses Option for words and Command for line and document boundaries',()=>{
    assert.deepEqual(textNavigation({key:'ArrowLeft',altKey:true},'darwin'),{kind:'horizontal',direction:-1,word:true});
    assert.deepEqual(textNavigation({key:'ArrowLeft',metaKey:true},'darwin'),{kind:'line',end:false});
    assert.deepEqual(textNavigation({key:'ArrowDown',metaKey:true},'darwin'),{kind:'document',end:true});
    assert.deepEqual(textNavigation({key:'ArrowRight',ctrlKey:true},'linux'),{kind:'horizontal',direction:1,word:true});
    assert.equal(textNavigation({key:'ArrowLeft',altKey:true},'win32'),null);
    assert.equal(contextClick({button:0,ctrlKey:true},'darwin'),true);
    assert.equal(contextClick({button:0,ctrlKey:true},'win32'),false);
});
