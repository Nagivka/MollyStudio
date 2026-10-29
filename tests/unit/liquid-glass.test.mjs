import test from 'node:test';
import assert from 'node:assert/strict';
import SettingsManager from '../../src/renderer/js/core/SettingsManager.js';
test('Liquid Glass is opt-in, persistent, and rejects nonboolean preferences',t=>{
 const previous=globalThis.localStorage,data=new Map();
 globalThis.localStorage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
 t.after(()=>{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;});
 class Settings extends SettingsManager{applyAll(){}apply(){}}
 const settings=new Settings();assert.equal(settings.get('liquidGlassEnabled'),false);
 settings.set('liquidGlassEnabled',true);assert.equal(new Settings().get('liquidGlassEnabled'),true);
 settings.set('liquidGlassEnabled','true');assert.equal(settings.get('liquidGlassEnabled'),false);
});
