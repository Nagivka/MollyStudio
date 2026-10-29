import test from 'node:test';
import assert from 'node:assert/strict';
import {captureSaveSnapshot,matchesSaveSnapshot} from '../../src/renderer/js/core/typed/SaveSnapshot.mjs';
import {fileErrorInfo,fileErrorMessage} from '../../src/renderer/js/core/FileErrors.mjs';

test('native error codes work when the system does not include the code in its message',()=>{
    for(const [code,kind,action] of [['ENOSPC','space','choose-folder'],['EPERM','permission','choose-folder'],['EBUSY','busy','retry'],['ENOENT','missing','check-file'],['FILE_CHANGED','changed','save-copy']]){
        const info=fileErrorInfo({code,message:'private filename'});assert.equal(info.kind,kind);assert.equal(info.action,action);assert.equal(info.message.includes('private filename'),false);
    }
    assert.match(fileErrorMessage(null,'export'),/Повторите экспорт/);assert.match(fileErrorMessage(Error('broken'),'open'),/открыть проект/);
});
test('save snapshots retain the revision of the serialized content across an asynchronous write',async()=>{
    let revision=4,content={text:'before'};
    const snapshot=captureSaveSnapshot(()=>structuredClone(content),()=>revision,()=>JSON.stringify(content));
    const write=Promise.resolve().then(()=>{content.text='after';revision++;});await write;
    assert.equal(snapshot.document.text,'before');assert.equal(matchesSaveSnapshot(snapshot,revision,JSON.stringify(content)),false);
    assert.equal(matchesSaveSnapshot(snapshot,4,JSON.stringify({text:'before'})),true);
});
