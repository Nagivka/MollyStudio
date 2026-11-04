import test from 'node:test';
import assert from 'node:assert/strict';
import {fileErrorInfo} from '../../src/renderer/js/core/FileErrors.mjs';
test('a disconnected or failing drive offers a safe alternative for open, save and export',()=>{
 for(const operation of ['open','save','export','model-export'])for(const error of [{code:'ENODEV'},{code:'ENXIO'},{code:'EIO'},{message:'IPC failed: os error 1167'}]){
  const result=fileErrorInfo(error,operation);assert.equal(result.kind,'device');assert.equal(result.action,'choose-folder');assert.match(result.message,/отключён/);
 }
});
