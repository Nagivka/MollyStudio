const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {saveDialogOptions}=require('../../src/main/ipc.cjs');
test('plain export filenames open in Documents rather than the process working folder',()=>{
 const directory=path.resolve('documents-fixture'),input={title:'Экспорт изображений',defaultPath:'Мой проект.png'};
 const options=saveDialogOptions(input,'en',directory);assert.equal(options.defaultPath,path.join(directory,input.defaultPath));assert.equal(input.defaultPath,'Мой проект.png');
 for(const value of ['C:\\Projects\\saved.mlst','C:/Projects/saved.png','folder/saved.png'])assert.equal(saveDialogOptions({defaultPath:value},'ru',directory).defaultPath,value);
 assert.equal(saveDialogOptions({},'ru',directory).defaultPath,undefined);
});
