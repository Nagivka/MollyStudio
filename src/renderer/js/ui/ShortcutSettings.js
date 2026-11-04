import {bindAttribute, bindText, translate, uiLabel, localeValue} from '../core/Locale.mjs';
import {SHORTCUT_COMMANDS,shortcutKeys,eventChord,normalizeChord,shortcutConflict,displayChord} from '../core/Shortcuts.mjs';

export function renderShortcutSettings(container,settings){
    const section=document.createElement('div');section.className='settings-section';
    section.innerHTML=`<section class="settings-group"><h2 class="settings-group-title"><!--i18n-->Горячие клавиши</h2>
    <p class="settings-group-desc"><!--i18n-->Нажмите сочетание у нужной команды и введите новое. Escape отменяет ввод, Backspace снимает назначение. Сначала освободите сочетание, если оно занято другой командой.</p>
    <label class="prop-field-block"><span><!--i18n-->Найти команду или сочетание</span><input type="search" class="md-input" data-shortcuts-search placeholder="Например, кисть или Ctrl+S" data-i18n-placeholder="%D0%9D%D0%B0%D0%BF%D1%80%D0%B8%D0%BC%D0%B5%D1%80%2C%20%D0%BA%D0%B8%D1%81%D1%82%D1%8C%20%D0%B8%D0%BB%D0%B8%20Ctrl%2BS"></label>
    <p data-shortcuts-status role="status" aria-live="polite" class="prop-help-text"></p>
    <div class="shortcut-commands"></div><p class="prop-help-text"><!--i18n-->Пробел, Alt, Shift и Ctrl также используются при перетаскивании. Escape отменяет действие, Tab перемещает фокус; эти служебные клавиши не переназначаются.</p></section>`;
    container.append(section);const list=section.querySelector('.shortcut-commands'),search=section.querySelector('input'),status=section.querySelector('[role="status"]');
    let recording=null;
    function populate(){
        recording=null;const query=search.value.trim().toLocaleLowerCase(),bindings=settings.get('shortcutBindings')||{};
        list.replaceChildren();
        for(const command of SHORTCUT_COMMANDS){
            const keys=shortcutKeys(command,bindings),label=keys.map(chord=>displayChord(chord)).join(' / ')||'Не назначено';
            if(query&&!`${command.label} ${translate(command.label)} ${command.category} ${translate(command.category)} ${label}`.toLocaleLowerCase().includes(query))continue;
            const row=document.createElement('div');row.className='shortcut-command';
            const name=document.createElement('span');name.className='shortcut-command-name';bindText(name,command.label);
            const category=document.createElement('small');bindText(category,command.category);name.append(category);
            const button=document.createElement('button');button.className='md-btn outlined';button.type='button';bindText(button,label);
            bindAttribute(button, "aria-label", "Назначить сочетание: {0}", {0: uiLabel(command.label)});
            const reset=document.createElement('button');reset.className='md-icon-btn';reset.type='button';bindAttribute(reset, "aria-label", "Сбросить сочетание: {0}", {0: uiLabel(command.label)});
            reset.innerHTML='<i class="material-symbols-rounded" aria-hidden="true">restart_alt</i>';reset.disabled=!Object.hasOwn(bindings,command.id);
            button.addEventListener('click',()=>{
                if(recording){recording.button.textContent=recording.label;recording.button.removeAttribute('aria-pressed');}
                recording={command,button,label};bindText(button, 'Нажмите сочетание…');button.setAttribute('aria-pressed','true');bindText(status, "Запись: {0}.", {0: uiLabel(command.label)});
            });
            button.addEventListener('keydown',event=>{
                if(recording?.button!==button)return;
                if(event.key==='Tab'){recording=null;button.textContent=label;button.removeAttribute('aria-pressed');return;}
                event.preventDefault();event.stopPropagation();
                if(event.key==='Escape'){recording=null;button.textContent=label;button.removeAttribute('aria-pressed');bindText(status, 'Назначение отменено.');return;}
                if(['Control','Shift','Alt','Meta'].includes(event.key))return;
                const chord=event.key==='Backspace'?'':eventChord(event);
                if(chord===null||normalizeChord(chord)===null){bindText(status, 'Выберите букву, цифру или функциональную клавишу с модификаторами.');return;}
                const current=settings.get('shortcutBindings')||{},conflict=chord&&shortcutConflict(command.id,chord,current);
                if(conflict){bindText(status, "{0} уже используется: {1}.", {0: displayChord(chord), 1: uiLabel(conflict.label)});return;}
                settings.set('shortcutBindings',{...current,[command.id]:chord});status.textContent=`${command.label}: ${displayChord(chord)}.`;
                populate();list.querySelector(`[data-shortcut-id="${command.id}"] button`)?.focus();
            });
            button.addEventListener('blur',()=>{if(recording?.button===button){recording=null;button.textContent=label;button.removeAttribute('aria-pressed');}});
            reset.addEventListener('click',()=>{
                const current={...(settings.get('shortcutBindings')||{})};delete current[command.id];
                const conflict=command.keys.filter(Boolean).map(chord=>shortcutConflict(command.id,chord,current)).find(Boolean);
                if(conflict){bindText(status, "Сначала освободите сочетание команды «{0}».", {0: uiLabel(conflict.label)});return;}
                settings.set('shortcutBindings',current);bindText(status, "Восстановлено: {0}.", {0: uiLabel(command.label)});populate();
            });
            row.dataset.shortcutId=command.id;row.append(name,button,reset);list.append(row);
        }
        if(!list.childElementCount){const empty=document.createElement('p');bindText(empty, 'Команды не найдены.');list.append(empty);}
    }
    search.addEventListener('input',populate);populate();
}
