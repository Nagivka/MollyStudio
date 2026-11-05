const fs=require('node:fs/promises');
function assertNativeRun(run,expectedSha){
 if(run.conclusion!=='success'||run.head_repository?.full_name!=='Nagivka/MollyStudio'||run.path!=='.github/workflows/platform-compatibility.yml'||run.head_branch!=='main'||!/^[a-f0-9]{40}$/.test(run.head_sha)||expectedSha&&run.head_sha!==expectedSha)throw Error('A successful official native build on main is required.');
 return run.head_sha;
}
if(require.main===module)(async()=>{
 const id=process.env.NATIVE_BUILD_RUN;if(!/^[1-9][0-9]*$/.test(id||''))throw Error('Invalid native build run.');
 const response=await fetch('https://api.github.com/repos/Nagivka/MollyStudio/actions/runs/'+id,{headers:{Authorization:'Bearer '+process.env.SOURCE_TOKEN},signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('Native build run unavailable: HTTP '+response.status);
 const sha=assertNativeRun(await response.json());await fs.appendFile(process.env.GITHUB_OUTPUT,'sha='+sha+'\n');
})().catch(e=>{console.error(e.message);process.exitCode=1});
module.exports={assertNativeRun};
