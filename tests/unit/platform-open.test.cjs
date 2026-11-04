const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os'),{pathToFileURL}=require('node:url');
const {ProjectRequests}=require('../../src/main/project-open.cjs');
test('desktop file URLs preserve Unicode and spaces and share the ordinary open queue',()=>{
    const requests=new ProjectRequests(),file=path.join(os.tmpdir(),'My кириллица # menu.mlst');
    requests.enqueue([pathToFileURL(file).href,file,'https://example.org/menu.mlst','file://%invalid/menu.mlst']);
    assert.equal(requests.pending().filter(request=>request.path===file).length,1);
    assert.equal(requests.pending().length,1); // Only local project paths enter the native queue.
});
