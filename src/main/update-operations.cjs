const {setTimeout: delay} = require('node:timers/promises');

// A provider can leave its promise pending even after its HTTP request was
// cancelled. Settle our operation independently and ignore its late result.
function abortable(promise, signal) {
    if (signal.aborted) return Promise.reject(signal.reason || Error('UPDATE_STOPPED'));
    return new Promise((resolve,reject) => {
        const abort=()=>reject(signal.reason || Error('UPDATE_STOPPED'));
        signal.addEventListener('abort',abort,{once:true});
        Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
    });
}
const retryable = error => ['UPDATE_NETWORK','ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN','ENOTFOUND','EPIPE'].includes(error?.code || error?.message);
async function requestWithRetry(request,args,signal,delays=[0,500,1500]) {
    for(let attempt=0;attempt<delays.length;attempt++) {
        if(signal.aborted)throw signal.reason || Error('UPDATE_STOPPED');
        if(delays[attempt]){
            try{await delay(delays[attempt],null,{signal});}
            catch(error){throw signal.aborted?signal.reason || error:error;}
        }
        try{return await abortable(request(...args,signal),signal);}
        catch(error){if(signal.aborted)throw signal.reason || error;if(!retryable(error)||attempt===delays.length-1)throw error;}
    }
    throw Error('UPDATE_NETWORK');
}
function errorCode(error) {
    if(error?.code==='ENOSPC')return 'UPDATE_DISK_FULL';
    if(['EACCES','EPERM'].includes(error?.code))return 'UPDATE_ACCESS_DENIED';
    if(['ERR_UPDATER_INVALID_SIGNATURE','ERR_CHECKSUM_MISMATCH','ERR_UPDATER_CHECKSUM_MISMATCH'].includes(error?.code))return 'UPDATE_INVALID_DOWNLOAD';
    return String(error?.message || '').match(/^UPDATE_[A-Z_]+$/)?.[0] || 'UPDATE_NETWORK';
}
module.exports={abortable,requestWithRetry,errorCode};
