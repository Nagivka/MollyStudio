import {bindText, localeValue} from '../core/Locale.mjs';
export default class HistoryPanel {
    constructor(app) {
        this.app = app;
        document.getElementById('btn-history')?.addEventListener('click', () => this.open());
        app.bus.on('HISTORY_CHANGED', () => { if (this.dialog?.open) this.render(); });
    }

    open() {
        if(this.app.tools?.finishDocument?.({preserveSelection:true})===false)return;
        if (!this.dialog) {
            this.dialog = document.createElement('dialog');
            this.dialog.className = 'history-dialog';
            this.dialog.setAttribute('aria-labelledby', 'history-heading');
            this.dialog.setAttribute('role','dialog');this.dialog.setAttribute('aria-modal','true');
            this.dialog.innerHTML = "<header><h2 id=\"history-heading\"><!--i18n-->История действий</h2><button type=\"button\" class=\"md-icon-btn\" aria-label=\"Закрыть историю\" data-i18n-aria-label=\"%D0%97%D0%B0%D0%BA%D1%80%D1%8B%D1%82%D1%8C%20%D0%B8%D1%81%D1%82%D0%BE%D1%80%D0%B8%D1%8E\"><i class=\"material-symbols-rounded\" aria-hidden=\"true\">close</i></button></header><p class=\"history-memory\" role=\"status\"></p><div class=\"history-entries\" role=\"group\" aria-label=\"Состояния документа\" data-i18n-aria-label=\"%D0%A1%D0%BE%D1%81%D1%82%D0%BE%D1%8F%D0%BD%D0%B8%D1%8F%20%D0%B4%D0%BE%D0%BA%D1%83%D0%BC%D0%B5%D0%BD%D1%82%D0%B0\"></div>";
            this.dialog.querySelector('header button').addEventListener('click', () => this.dialog.close());
            this.dialog.addEventListener('keydown', event => { if (event.key !== 'Tab') event.stopPropagation(); });
            this.dialog.addEventListener('close', () => document.getElementById('btn-history')?.focus());
            this.dialog.querySelector('.history-entries').addEventListener('click', event => {
                const index = event.target.closest('[data-history-index]')?.dataset.historyIndex;
                if (index != null) this.app.history.jumpTo(Number(index));
            });
            document.body.append(this.dialog);
        }
        this.render();
        if (!this.dialog.open) this.dialog.showModal();
        this.dialog.querySelector('[aria-current="step"]')?.focus();
    }

    render() {
        const list=this.dialog.querySelector('.history-entries'),history=this.app.history;
        const focused=this.dialog.contains(document.activeElement)?document.activeElement.dataset.historyIndex:null;
        list.replaceChildren();
        const count=history.undoStack.length,forms={one:'действие',few:'действия',many:'действий',other:'действия'};
        const actionWord=forms[new Intl.PluralRules('ru').select(count)];
        bindText(this.dialog.querySelector('.history-memory'), '{0} {1} · {2} из {3} МБ', {0: count, 1: localeValue(actionWord, count === 1 ? 'action' : 'actions'), 2: (history.getUndoMemoryBytes()/1048576).toFixed(1), 3: Math.round(history.memoryBudgetBytes/1048576)});
        for(const entry of history.getEntries()) {
            const button=document.createElement('button');button.type='button';button.className='md-btn outlined';button.dataset.historyIndex=String(entry.index);
            const icon=document.createElement('i');icon.className='material-symbols-rounded';icon.setAttribute('aria-hidden','true');icon.textContent=entry.icon;
            const label=document.createElement('span');bindText(label,entry.name);button.append(icon,label);
            if(entry.isCurrent)button.setAttribute('aria-current','step');
            button.classList.toggle('history-future',entry.isFuture);list.append(button);
        }
        if(focused!=null)list.querySelector(`[data-history-index="${focused}"]`)?.focus({preventScroll:true});
    }
}
