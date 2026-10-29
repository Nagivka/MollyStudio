import {CommandRegistry} from './typed/CommandRegistry.mjs';
import {SHORTCUT_COMMANDS} from './Shortcuts.mjs';
import {performanceJournal} from './Performance.mjs';
export function createEditorCommands(app,menu){
    const registry=new CommandRegistry(()=>({projectType:app.getActiveProject?.()?.type||null,projectId:app.activeProjectId,closing:app.documentTasks?.closing===true}),event=>{
        performanceJournal.record('command.'+event.id,event.durationMs);if(event.state==='error')performanceJournal.event('command-error',event.id);
    });
    const ids=new Set([...SHORTCUT_COMMANDS.map(command=>command.id),...[...document.querySelectorAll('[data-action]')].map(node=>node.dataset.action)]);
    for(const id of ids)if(id)registry.register(id,{run:()=>menu.performAction(id),exclusive:/^(?:file-(?:save|export)|edit-redo|edit-undo)/.test(id),enabled:context=>!!context.projectType||/^(?:file-(?:new|open|home)|settings-|help-|utility-)/.test(id)});
    return registry;
}
