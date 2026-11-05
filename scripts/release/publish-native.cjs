const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const {releaseInfo}=require('./validate.cjs');
const {prepareNativeReleaseBundle}=require('./bundle.cjs');
const {PUBLIC_KEY}=require('../../src/main/update-security.cjs');
const {assertNativeRun}=require('./validate-native-run.cjs');
const SOURCE='Nagivka/MollyStudio',TARGET='Nagivka/MollyStudio-Releases';
async function publishNative({root,env=process.env,fetchImpl=fetch,publicKey=PUBLIC_KEY}){
 if(env.GITHUB_REPOSITORY!==SOURCE||!env.SOURCE_TOKEN||!env.RELEASES_TOKEN)throw Error('Official repository and release credentials are required.');
 if(!/^[1-9]\d*$/.test(env.NATIVE_BUILD_RUN||''))throw Error('Invalid native build run.');
 if(!/^[a-f0-9]{40}$/.test(env.NATIVE_BUILD_SHA||''))throw Error('Native build SHA is required.');
 const api=async(endpoint,{token=env.SOURCE_TOKEN,method='GET',body,binary}={})=>{
  const r=await fetchImpl(endpoint.startsWith('https://')?endpoint:'https://api.github.com'+endpoint,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json',...(body?{'Content-Type':binary||'application/json'}:{})},body:body?(binary?body:JSON.stringify(body)):undefined,redirect:'error',signal:AbortSignal.timeout(binary?300000:30000)});
  if(!r.ok)throw Error('GitHub native publication HTTP '+r.status);return r.json();
 };
 const run=await api(`/repos/${SOURCE}/actions/runs/${env.NATIVE_BUILD_RUN}`);
 assertNativeRun(run,env.NATIVE_BUILD_SHA);
 const info=releaseInfo(root),directory=path.join(root,'dist');
 for(const platform of ['darwin','linux'])for(const arch of ['x64','arm64']){
  const report=JSON.parse(await fs.readFile(path.join(directory,`build-${platform}-${arch}.json`),'utf8'));
  if(report.platform!==platform||report.arch!==arch||report.version!==info.version)throw Error('All four native reports must match the release.');
 }
 const repo=await api(`/repos/${TARGET}`,{token:env.RELEASES_TOKEN});if(repo.full_name!==TARGET||repo.private!==false||repo.permissions?.push!==true)throw Error('Unexpected release destination.');
 const release=await api(`/repos/${TARGET}/releases/tags/${info.tag}`,{token:env.RELEASES_TOKEN});if(release.draft||release.prerelease||release.tag_name!==info.tag)throw Error('A published stable release is required.');
 const files=await prepareNativeReleaseBundle(root,info,env.UPDATES_SIGNING_KEY,publicKey);
 const uploads=`https://uploads.github.com/repos/${TARGET}/releases/${release.id}/assets`,existing=new Map(release.assets.map(a=>[a.name,a]));
 // Preflight every conflict before changing the public release. Never replace Windows assets.
 for(const f of files){if(/x64-setup|^latest\.yml$|^release-manifest\.json$/.test(f.name))throw Error('Windows assets cannot be changed');const a=existing.get(f.name);if(a&&(a.size!==f.bytes.length||a.digest!=='sha256:'+createHash('sha256').update(f.bytes).digest('hex')))throw Error('Existing native artifact differs: '+f.name);}
 for(const f of files){if(existing.has(f.name))continue;const a=await api(uploads+'?name='+encodeURIComponent(f.name),{token:env.RELEASES_TOKEN,method:'POST',body:f.bytes,binary:f.type});if(a.state!=='uploaded'||a.name!==f.name||a.size!==f.bytes.length||a.digest!=='sha256:'+createHash('sha256').update(f.bytes).digest('hex'))throw Error('Native upload verification failed');}
 console.log('Verified native files added to '+release.html_url);return {url:release.html_url,files:files.map(f=>f.name)};
}
if(require.main===module)publishNative({root:path.resolve(__dirname,'../..')}).catch(e=>{console.error(e.message);process.exitCode=1});
module.exports={publishNative};
