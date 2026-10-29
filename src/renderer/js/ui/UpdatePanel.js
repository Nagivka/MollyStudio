import {bindText, labelHTML, translate,getLocale} from '../core/Locale.mjs';

const errorMessages = {
    UPDATE_INVALID_SIGNATURE: 'Подпись обновления не прошла проверку. Установка заблокирована.',
    UPDATE_INVALID_MANIFEST: 'Выпуск содержит некорректные данные обновления.',
    UPDATE_UNSIGNED_RELEASE: 'В этом выпуске пока нет подписанных файлов для обновления.',
    UPDATE_UNTRUSTED_METADATA: 'Данные загрузки не совпадают с подписью выпуска. Установка заблокирована.',
    UPDATE_INVALID_DOWNLOAD: 'Загруженный файл повреждён. Повторите загрузку.',
    UPDATE_RATE_LIMIT: 'GitHub временно ограничил проверки. Повторите позже.',
    UPDATE_INSTALL_FAILED: 'Не удалось запустить установщик. Приложение осталось доступным.',
    UPDATE_CHECK_TIMEOUT:'Проверка заняла слишком много времени. Повторите попытку.',
    UPDATE_DOWNLOAD_TIMEOUT:'Загрузка остановилась из-за отсутствия связи. Повторите загрузку.',
    UPDATE_DISK_FULL:'Недостаточно места на диске для обновления.',
    UPDATE_ACCESS_DENIED:'Нет доступа к папке обновлений. Проверьте права доступа.',
    UPDATE_NOT_PUBLISHED:'Новый выпуск пока недоступен. Повторите проверку позже.'
};

export function mountUpdatePanel(container, {banner = false} = {}) {
    const api = window.desktopAPI;
    const section = document.createElement('section');
    section.className = `update-panel${banner ? ' update-banner' : ''}`;
    section.hidden = banner;
    section.innerHTML = `<div class="update-heading"><i class="material-symbols-rounded" aria-hidden="true">download</i><h3>${labelHTML('Обновления MollyStudio')}</h3></div>
        <p class="update-status" role="status" aria-live="polite"></p>
        <p class="update-detail"></p><progress max="100" value="0" hidden></progress><p class="update-notes" hidden></p>
        <div class="update-actions">
            <button type="button" class="md-btn outlined" data-update="check"><i class="material-symbols-rounded" aria-hidden="true">refresh</i><span>${labelHTML('Проверить обновления')}</span></button>
            <button type="button" class="md-btn primary" data-update="download" hidden><i class="material-symbols-rounded" aria-hidden="true">download</i><span>${labelHTML('Скачать обновление')}</span></button>
            <button type="button" class="md-btn primary" data-update="install" hidden><i class="material-symbols-rounded" aria-hidden="true">refresh</i><span>${labelHTML('Установить и перезапустить')}</span></button>
            <button type="button" class="md-btn outlined" data-update="cancel" hidden>${labelHTML('Отменить загрузку')}</button>
            <button type="button" class="md-btn flat" data-update="release">${labelHTML('Страница релиза')}</button>
        </div>${banner ? '' : `<div class="update-preferences">${[['autoCheck','Проверять обновления автоматически'],['autoDownload','Загружать обновления автоматически']].map(([key,label]) => `<label class="md-switch"><input type="checkbox" data-update-preference="${key}"><span class="md-switch-track"><span class="md-switch-thumb"></span></span><span class="md-switch-label">${labelHTML(label)}</span></label>`).join('')}</div>`}`;
    container.append(section);
    const status = section.querySelector('.update-status'), detail = section.querySelector('.update-detail');
    const progress = section.querySelector('progress'), notes = section.querySelector('.update-notes');
    const buttons = Object.fromEntries([...section.querySelectorAll('[data-update]')].map(button => [button.dataset.update, button]));
    let disposed = false, current = {status: 'idle', supported: false}, cooldown,localError='';
    const pending=new Set();
    function render(value = current) {
        if (disposed) return;
        current = value;
        const state = value.status, downloading = state === 'downloading', installing = state === 'installing';
        const available = Boolean(value.version) && ['available', 'downloading', 'downloaded', 'installing', 'error'].includes(state);
        section.hidden = banner && !available;
        const labels = {idle:'Проверка ещё не выполнялась.',checking:'Проверяем обновления…','up-to-date':'Установлена последняя версия.',
            available:'Доступна версия {0}',downloading:'Загружается версия {0}',downloaded:'Версия {0} готова к установке',installing:'Завершаем работу и устанавливаем обновление…'};
        bindText(status, !value.supported ? 'Автообновления доступны в установленной версии для Windows.' : state === 'error'
            ? errorMessages[value.error] || 'Не удалось проверить или загрузить обновление. Проверьте подключение к интернету.' : labels[state] || labels.idle, {0:value.version});
        if(localError)bindText(status,localError);
        if (downloading) bindText(detail, 'Загружено {0}% · {1} МБ из {2} МБ', {0:Math.floor(value.percent || 0),1:((value.downloaded || 0)/1e6).toFixed(1),2:((value.total || 0)/1e6).toFixed(1)});
        else if (state === 'downloaded') bindText(detail,'Перед установкой редактор сохранит автокопии. При отмене закрытия обновление не установится.');
        else if (value.supported && value.lastChecked) bindText(detail,'Последняя проверка: {0}',{0:new Date(value.lastChecked).toLocaleString(getLocale())});
        else bindText(detail,'Проекты и настройки сохраняются при обновлении.');
        progress.hidden = !downloading; progress.value = value.percent || 0;
        progress.setAttribute('aria-label', translate('Загрузка обновления'));
        notes.hidden = banner || !available || !value.notes;
        notes.textContent = value.notes?.replace(/^#{1,6}\s*/gm,'').replace(/\*\*|`/g,'') || '';
        buttons.check.hidden = banner;
        buttons.check.disabled = pending.has('check')||!value.supported || ['checking','downloading','installing'].includes(state) || Date.now() < (value.nextCheckAt || 0);
        for(const name of ['download','install','cancel'])buttons[name].disabled=pending.has(name)||!value.supported||installing;
        clearTimeout(cooldown);
        if (buttons.check.disabled && value.nextCheckAt > Date.now()) cooldown = setTimeout(() => render(),value.nextCheckAt-Date.now()+10);
        buttons.download.hidden = !value.supported || !available || !['available','error'].includes(state);
        buttons.install.hidden = !value.supported || state !== 'downloaded';
        buttons.cancel.hidden = !downloading;
        buttons.release.disabled = installing||pending.has('release');
        for (const input of section.querySelectorAll('[data-update-preference]')) {
            input.checked = value[input.dataset.updatePreference] === true;
            input.disabled = !value.supported || installing||pending.has(input.dataset.updatePreference);
        }
    }
    const operations = {check:'checkForUpdates',download:'downloadUpdate',install:'installUpdate',cancel:'cancelUpdateDownload'};
    for (const [name, button] of Object.entries(buttons)) button.addEventListener('click',async () => {
        if(pending.has(name))return;localError='';pending.add(name);render();
        try {
            if (name === 'release') await api?.openExternal?.(current.releaseUrl || 'https://github.com/Nagivka/MollyStudio-Releases/releases/latest');
            else { button.disabled = true; await api?.[operations[name]]?.(); }
        } catch {localError='Не удалось выполнить действие. Повторите попытку.';}
        finally {pending.delete(name);if (!disposed) { try { render(await api?.getUpdateStatus?.() || current); } catch { render(); } } }
    });
    section.querySelectorAll('[data-update-preference]').forEach(input => input.addEventListener('change',async () => {
        const key=input.dataset.updatePreference,value=input.checked;
        localError='';pending.add(key);input.disabled=true;
        try {current=await api.configureUpdates({[key]:value});}
        catch {localError='Не удалось сохранить настройки обновлений.';}
        finally{pending.delete(key);render();}
    }));
    const stop = api?.onUpdateStatus?.(render);
    void api?.getUpdateStatus?.().then(render).catch(() => render());
    const language = () => render();
    document.addEventListener('molly-language-changed',language);
    render();
    return () => {disposed=true;clearTimeout(cooldown);stop?.();document.removeEventListener('molly-language-changed',language);section.remove();};
}
