const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {checkContext,checkInputs,resumeChecks}=require('./lib/check-inputs.cjs');
const root=path.resolve(__dirname,'..'),results=[];
const suites=['startup-scenarios','electron-smoke','file-open-scenarios','lifecycle-scenarios','user-scenarios','tool-scenarios','text-scenarios','property-scenarios','export-scenarios','prefix-scenarios','audit-scenarios','utility-scenarios','launcher-scenarios','ui-motion-scenarios','usability-scenarios','localization-scenarios','session-scenarios','save-error-scenarios'];
suites.splice(suites.indexOf('electron-smoke')+1,0,'platform-scenarios');
suites.splice(suites.indexOf('usability-scenarios')+1,0,'gui-style-scenarios');
suites.splice(suites.indexOf('ui-motion-scenarios')+1,0,'weather-scenarios');
suites.splice(suites.indexOf('text-scenarios')+1,0,'canvas-text-scenarios');
suites.splice(suites.indexOf('utility-scenarios')+1,0,'resource-assets-scenarios');
suites.push('architecture-scenarios','performance-scenarios','project-types-scenarios','complete-workflows','large-session-scenarios','export-write-error-scenarios');
suites.push('font-subset-scenarios');
suites.push('liquid-glass-scenarios');
suites.push('liquid-glass-audit');
suites.push('liquid-glass-launcher');
suites.push('seasonal-details-scenarios');
suites.push('brand-logo-scenarios');
suites.push('update-scenarios');
suites.push('title-scenarios','title-precision-scenarios','title-fonts-scenarios','title-materials-scenarios','title-cyrillic-scenarios','title-audit-scenarios','title-workspace-scenarios','title-edge-scenarios');
suites.splice(suites.indexOf('tool-scenarios')+1,0,'move-picking-scenarios');
suites.splice(suites.indexOf('tool-scenarios')+1,0,'tool-options-scenarios');
suites.splice(suites.indexOf('property-scenarios')+1,0,'button-properties-scenarios');
suites.splice(suites.indexOf('ui-motion-scenarios')+1,0,'minecraft-range-scenarios');
suites.splice(suites.indexOf('minecraft-range-scenarios')+1,0,'minecraft-controls-scenarios','minecraft-theme-audit');
suites.splice(suites.indexOf('weather-scenarios')+1,0,'weather-occlusion-scenarios');
suites.splice(suites.indexOf('weather-occlusion-scenarios')+1,0,'weather-artwork-scenarios');
suites.splice(suites.indexOf('ui-motion-scenarios')+1,0,'visual-effects-scenarios','ui-sound-scenarios','interface-improvements');
suites.splice(suites.indexOf('tool-scenarios')+1,0,'pipette-history-scenarios');
suites.splice(suites.indexOf('usability-scenarios')+1,0,'responsive-scenarios');
suites.splice(suites.indexOf('usability-scenarios')+1,0,'editor-usability-scenarios');
suites.splice(suites.indexOf('usability-scenarios')+1,0,'pixel-interface-scenarios');
suites.splice(suites.indexOf('gui-style-scenarios')+1,0,'design-gallery-scenarios');
suites.push('developer-settings-scenarios','basement-scenarios','weather-important-scenarios','visual-components','visual-interactions');
suites.push('editor-soak-scenarios','production-window-scenarios','title-export-options-scenarios');
suites.push('title-headings-scenarios');
suites.push('title-seams-scenarios');
let tasks=[['types',['node_modules/typescript/bin/tsc','-p','tsconfig.json','--noEmit']],['generated',['scripts/verify-core.cjs']],['unit',['scripts/run-unit.cjs']],['static',['scripts/audit-project.mjs']],...suites.map(name=>[name,['scripts/run-electron-check.cjs',`scripts/${name}.cjs`]])];
tasks.push(['title-unavailable',['scripts/run-electron-check.cjs','scripts/title-edge-scenarios.cjs','--without-webgl']]);
if (process.argv.includes('--full-visual')) for (const page of ['index','editor','settings','new-project','buttons']) {
    tasks.push([`visual-capture-${page}`, ['scripts/run-electron-check.cjs','scripts/visual-regression.cjs','--capture',`--page=${page}`]]);
}
const shard = process.argv.find(argument => argument.startsWith('--shard='));
let suffix = '';
if (shard) {
    const match = /^--shard=([1-9]\d*)\/([1-9]\d*)$/.exec(shard);
    if (!match || Number(match[1]) > Number(match[2]) || Number(match[2]) > tasks.length) throw Error('Invalid audit shard');
    const index = Number(match[1]) - 1, count = Number(match[2]);
    tasks = tasks.filter((_task, position) => position % count === index);
    suffix = `-${index + 1}-of-${count}`;
}
fs.mkdirSync(path.join(root,'.test-output'),{recursive:true});
const report=path.join(root,`.test-output/check-all${suffix}.json`);
const context=checkContext(root,tasks),startedAt=new Date().toISOString();
let finishedAt=null;
if(process.argv.includes('--resume')){
    let previous;
    try{previous=JSON.parse(fs.readFileSync(report,'utf8'));}catch(error){if(!['ENOENT'].includes(error.code)&&!(error instanceof SyntaxError))throw error;}
    const resumed=resumeChecks(previous,context,tasks);results.push(...resumed.results);
    if(resumed.reason)console.log(`${resumed.reason} Проверки запускаются заново.`);
    console.log(`Resuming after ${results.length} completed checks.`);
}
const writeReport=()=>{
    const temporary=report+'.tmp';
    fs.writeFileSync(temporary,JSON.stringify({schemaVersion:1,context,startedAt,finishedAt,passed:results.every(result=>result.passed)&&results.length===tasks.length,completed:results.length,total:tasks.length,results},null,2));
    fs.renameSync(temporary,report);
};
writeReport();
for(const [name,args] of tasks.slice(results.length)){
    const start=Date.now(),result=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:name.startsWith('visual-')?600000:name==='minecraft-theme-audit'?360000:name==='editor-soak-scenarios'?300000:name==='native'?900000:180000,maxBuffer:8*1024*1024});
    fs.writeFileSync(path.join(root,'.test-output',`check-${name}.log`),(result.stdout||'')+(result.stderr||''));
    const sourceChanged=checkInputs(root).sha256!==context.inputs.sha256;
    const entry={name,passed:result.status===0&&!result.error&&!sourceChanged,durationMs:Date.now()-start,...(sourceChanged?{error:'Исходники изменились во время проверки. Запустите проверки заново.'}:{})};results.push(entry);
    writeReport();
    console.log(`${entry.passed?'PASS':'FAIL'} ${name} (${entry.durationMs} ms)`);
    if(!entry.passed){console.error([entry.error,result.error?.message,result.stdout,result.stderr].filter(Boolean).join('\n'));process.exitCode=1;if(sourceChanged||!process.argv.includes('--continue'))break;}
}
finishedAt=new Date().toISOString();
writeReport();
