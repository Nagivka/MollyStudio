const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),test=require('node:test'),assert=require('node:assert/strict');
const {createCaseChecker}=require('../../scripts/lib/case-sensitive-path.cjs');
test('Linux-sensitive asset checks catch directory and filename case on every host',t=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'molly-case-check-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    fs.mkdirSync(path.join(root,'Assets'));fs.writeFileSync(path.join(root,'Assets','Icon.png'),'png');
    const check=createCaseChecker(root);assert.equal(check(path.join(root,'Assets','Icon.png')),null);
    assert.equal(check(path.join(root,'assets','Icon.png')).actual,'Assets');
    assert.equal(check(path.join(root,'Assets','icon.png')).actual,'Icon.png');
});
