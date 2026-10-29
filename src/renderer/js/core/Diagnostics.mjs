import {performanceJournal,installPerformanceMonitoring} from './Performance.mjs';
import {getApplicationInfo} from '../ui/ApplicationInfo.js';
let channel;
function safeSnapshot(value){
    return {timings:(value?.timings||[]).slice(0,64).filter(item=>typeof item.name==='string'&&/^[a-z0-9_.:-]{1,90}$/i.test(item.name)).map(item=>Object.fromEntries(['name','count','totalMs','maxMs','p50Ms','p95Ms'].map(key=>[key,key==='name'?item[key]:Number.isFinite(item[key])?item[key]:0]))),events:(value?.events||[]).slice(-80).map(event=>({kind:String(event.kind).replace(/[^a-z0-9_-]/gi,'').slice(0,40),message:String(event.message).replace(/[^a-z0-9_.:-]/gi,'').slice(0,100),at:Number(event.at)||0}))};
}
export function installDiagnostics(){
    installPerformanceMonitoring();if(channel||typeof BroadcastChannel==='undefined')return;
    channel=new BroadcastChannel('molly-local-diagnostics');channel.addEventListener('message',({data})=>{if(data?.type==='request'&&typeof data.id==='string')channel.postMessage({type:'snapshot',id:data.id,window:location.pathname.split('/').pop(),snapshot:safeSnapshot(performanceJournal.snapshot())});});
    window.addEventListener('pagehide',()=>channel.close(),{once:true});
}
export async function collectDiagnostics(){
    const windows=[{window:location.pathname.split('/').pop(),snapshot:safeSnapshot(performanceJournal.snapshot())}],id=crypto.randomUUID();
    if(channel){const listener=({data})=>{if(data?.type==='snapshot'&&data.id===id&&windows.length<8)windows.push({window:['editor.html','index.html','settings.html','buttons.html','new-project.html'].includes(data.window)?data.window:'window',snapshot:safeSnapshot(data.snapshot)});};channel.addEventListener('message',listener);channel.postMessage({type:'request',id});await new Promise(resolve=>setTimeout(resolve,250));channel.removeEventListener('message',listener);}
    const info=await getApplicationInfo();
    return {format:'MollyStudio diagnostics',schemaVersion:1,createdAt:new Date().toISOString(),application:Object.fromEntries(['version','buildVersion','distribution','platform','arch','electron','chromium'].filter(key=>info[key]!=null).map(key=>[key,info[key]])),environment:{language:document.documentElement.lang,theme:document.documentElement.dataset.theme,viewport:{width:innerWidth,height:innerHeight,scale:devicePixelRatio},heap:performance.memory?{usedBytes:performance.memory.usedJSHeapSize,totalBytes:performance.memory.totalJSHeapSize}:null},windows};
}
if(typeof window!=='undefined'&&typeof window.addEventListener==='function'&&typeof location!=='undefined')installDiagnostics();
