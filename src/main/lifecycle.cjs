/** Native quit must complete the same recovery handshake as the close button. */
function installLifecycle(app,windows,platform=process.platform) {
    let pending=null;
    const cancel=()=>{if(!pending)return;pending.removeListener('closed',closed);pending.removeListener('molly-close-cancelled',cancel);pending=null;};
    const closed=()=>{cancel();app.quit();};
    const beforeQuit=event=>{
        const main=windows.get('main');
        if(!main||main.isDestroyed?.()||main.forceClose)return;
        event.preventDefault();
        if(pending)return;
        pending=main;main.once('closed',closed);main.once('molly-close-cancelled',cancel);main.close();
    };
    const allClosed=()=>{if(platform!=='darwin')app.quit();};
    app.on('before-quit',beforeQuit);app.on('window-all-closed',allClosed);
    return ()=>{cancel();app.removeListener('before-quit',beforeQuit);app.removeListener('window-all-closed',allClosed);};
}
module.exports={installLifecycle};
