import {labelHTML, attributeHTML, bindText, bindAttribute, translate} from '../core/Locale.mjs';
import {WeatherSurface} from './AmbientWeather.js';
import {NUMERIC_SETTING_RANGES} from '../core/SettingsManager.js';

const effects = [
    {id: 'none', label: 'Без эффекта', icon: 'close'},
    {id: 'rain', label: 'Дождь', icon: 'water_drop'},
    {id: 'snow', label: 'Снег', icon: 'ac_unit'},
    {id: 'leaves', label: 'Листья', icon: 'eco'}
];
const ranges = [
    {key: 'weatherSpeed', label: 'Скорость'},
    {key: 'weatherWind', label: 'Ветер'},
    {key: 'weatherOpacity', label: 'Заметность эффекта'},
    {key: 'weatherSize', label: 'Размер частиц'}
];
const rangeHTML = ({key, label}) => `<div class="weather-range">
    <label class="weather-range-label" for="setting-${key}"><span>${labelHTML(label)}</span><output for="setting-${key}" data-weather-value="${key}" aria-hidden="true"></output></label>
    <input type="range" class="md-slider" id="setting-${key}" data-weather-range="${key}" min="${NUMERIC_SETTING_RANGES[key][0]}" max="${NUMERIC_SETTING_RANGES[key][1]}" step="1">
    ${key === 'weatherWind' ? `<div class="weather-wind-directions" aria-hidden="true"><span>${labelHTML('Влево')}</span><span>${labelHTML('Штиль')}</span><span>${labelHTML('Вправо')}</span></div>` : ''}
</div>`;

export function renderWeatherSettings(container, settings) {
    const section = document.createElement('section');
    section.className = 'settings-group weather-settings';
    section.setAttribute('aria-labelledby', 'weather-settings-title');
    section.innerHTML = `
        <div class="weather-settings-header"><h3 class="settings-group-title" id="weather-settings-title">${labelHTML('Атмосферные эффекты')}</h3><button type="button" class="md-icon-btn" data-weather-reset${attributeHTML('title', 'Сбросить параметры эффекта')}${attributeHTML('aria-label', 'Сбросить параметры эффекта')}><i class="material-symbols-rounded" aria-hidden="true">restart_alt</i></button></div>
        <p class="settings-group-desc">${labelHTML('Декоративная погода в интерфейсе. Не меняет проект и не попадает в экспорт.')}</p>
        <div class="weather-choices" role="group"${attributeHTML('aria-label', 'Атмосферные эффекты')}>
            ${effects.map(effect => `<button type="button" class="md-btn outlined weather-choice" data-weather-effect="${effect.id}" aria-pressed="false"${attributeHTML('title','Наведение — предпросмотр; нажатие — применить.')}>
                <i class="material-symbols-rounded" aria-hidden="true">${effect.icon}</i><span>${labelHTML(effect.label)}</span>
            </button>`).join('')}
        </div>
        <div class="weather-preview">
            <canvas class="weather-preview-canvas" hidden></canvas>
            <div class="weather-preview-caption"><i class="material-symbols-rounded" aria-hidden="true">landscape</i><span>${labelHTML('Живой предпросмотр')}</span></div>
            <span class="weather-preview-status"></span>
            <button type="button" class="md-icon-btn weather-preview-pause" data-weather-pause aria-pressed="false"${attributeHTML('title', 'Приостановить предпросмотр')}${attributeHTML('aria-label', 'Приостановить предпросмотр')}><i class="material-symbols-rounded" aria-hidden="true">pause</i></button>
        </div>
        <div class="settings-row-wrap">
            <div class="settings-col">
                <label for="setting-weather-density" class="settings-col-label">${labelHTML('Интенсивность')}</label>
                <select id="setting-weather-density" class="md-select">
                    <option value="light">${labelHTML('Лёгкая')}</option><option value="normal">${labelHTML('Умеренная')}</option><option value="dense">${labelHTML('Насыщенная')}</option>
                </select>
            </div>
            <div class="settings-col">
                <label for="setting-weather-scope" class="settings-col-label">${labelHTML('Где показывать')}</label>
                <select id="setting-weather-scope" class="md-select">
                    <option value="home">${labelHTML('Главное меню')}</option><option value="all">${labelHTML('Все окна приложения')}</option>
                </select>
            </div>
        </div>
        <div class="weather-parameters">
            <div class="settings-col" data-leaf-options hidden>
                <label for="setting-weather-leaves" class="settings-col-label">${labelHTML('Виды листьев')}</label>
                <select id="setting-weather-leaves" class="md-select">
                    <option value="all">${labelHTML('Все вместе')}</option>
                    <option value="autumn">${labelHTML('Осенние листья')}</option>
                    <option value="spring">${labelHTML('Розовые листья')}</option>
                    <option value="summer">${labelHTML('Летние листья')}</option>
                </select>
            </div>
            ${ranges.slice(0, 2).map(rangeHTML).join('')}
            ${rangeHTML(ranges[2])}
            ${rangeHTML(ranges[3])}
            <div class="settings-col weather-quality">
                <label for="setting-weather-quality" class="settings-col-label">${labelHTML('Качество эффектов')}</label>
                <select id="setting-weather-quality" class="md-select"><option value="auto">${labelHTML('Автоматически')}</option><option value="economy">${labelHTML('Экономичный режим')}</option></select>
            </div>
        </div>
        <p class="settings-group-desc">${labelHTML('Экономичный режим уменьшает число частиц и нагрузку. В автоматическом режиме плавность подстраивается под производительность.')}</p>
        <p class="settings-group-desc">${labelHTML('Эффекты приостанавливаются в скрытом окне и при отключении анимаций. Учитывается системное ограничение движения.')}</p>`;
    container.append(section);
    const surface = new WeatherSurface(section.querySelector('canvas'), {preview: true});
    const density = section.querySelector('#setting-weather-density');
    const scope = section.querySelector('#setting-weather-scope');
    const status = section.querySelector('.weather-preview-status');
    const quality = section.querySelector('#setting-weather-quality');
    const leaves = section.querySelector('#setting-weather-leaves');
    const pause = section.querySelector('[data-weather-pause]');
    const reset = section.querySelector('[data-weather-reset]');
    const pending = new Map();
    const previews = new Map();
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
        const effect = settings.get('weatherEffect');
        const values = {...settings.settings, ...Object.fromEntries(pending),weatherEffect:[...previews.values()].at(-1)??effect};
        section.querySelectorAll('[data-weather-effect]').forEach(button => {
            const selected = button.dataset.weatherEffect === effect;
            button.setAttribute('aria-pressed', String(selected));
            button.classList.toggle('active', selected);
        });
        density.value = settings.get('weatherDensity');
        leaves.value = settings.get('weatherLeaves');
        section.querySelector('[data-leaf-options]').hidden = effect !== 'leaves';
        leaves.disabled = effect !== 'leaves';
        scope.value = settings.get('weatherScope');
        density.disabled = scope.disabled = effect === 'none';
        quality.value = settings.get('weatherQuality');
        quality.disabled = reset.disabled = effect === 'none';
        const paused = settings.get('animationsEnabled') === false || media.matches;
        pause.disabled = values.weatherEffect === 'none' || paused;
        pause.setAttribute('aria-pressed', String(surface.previewPaused));
        const pauseLabel = surface.previewPaused ? 'Продолжить предпросмотр' : 'Приостановить предпросмотр';
        bindAttribute(pause, 'title', pauseLabel);bindAttribute(pause, 'aria-label', pauseLabel);
        const icon = surface.previewPaused ? 'play_arrow' : 'pause';
        if (pause.firstElementChild.textContent !== icon) pause.firstElementChild.textContent = icon;
        bindText(status, values.weatherEffect === 'none' ? 'Эффект выключен' : paused ? 'Анимации отключены' : surface.previewPaused ? 'Предпросмотр на паузе' : effects.find(item => item.id === values.weatherEffect)?.label || 'Без эффекта');
        for (const {key} of ranges) {
            const input = section.querySelector(`[data-weather-range="${key}"]`);
            input.value = values[key];input.disabled = effect === 'none';
            const value = values[key], min = Number(input.min), max = Number(input.max);
            const source = key === 'weatherWind' ? value === 0 ? 'Штиль' : value < 0 ? 'Влево — {0}%' : 'Вправо — {0}%' : '{0}%';
            const display = {0: Math.abs(value)};
            bindText(section.querySelector(`[data-weather-value="${key}"]`), source, display);
            input.setAttribute('aria-valuetext', translate(source, display));
            input.style.setProperty('--progress', `${(value - min) / (max - min) * 100}%`);
        }
        surface.configure(values);
    };
    const commit = key => {
        if (!pending.has(key)) return;
        const value = pending.get(key);pending.delete(key);
        settings.set(key, value);
    };
    const commitAll = () => { for (const key of [...pending.keys()]) commit(key); };
    section.addEventListener('click', event => {
        const button = event.target.closest('[data-weather-effect]');
        if (button) { settings.set('weatherEffect', button.dataset.weatherEffect);update(); }
    });
    for (const button of section.querySelectorAll('[data-weather-effect]')) {
        const effect = button.dataset.weatherEffect;
        const startPreview = input => {
            // Keep pointer and keyboard previews independent, with the latest input on top.
            previews.delete(input);
            previews.set(input, effect);
            surface.setPaused(false);
            update();
        };
        const endPreview = input => {
            if (previews.get(input) !== effect) return;
            previews.delete(input);
            update();
        };
        button.addEventListener('pointerenter', () => startPreview('pointer'));
        button.addEventListener('pointerleave', () => endPreview('pointer'));
        button.addEventListener('focus', () => startPreview('keyboard'));
        button.addEventListener('blur', () => endPreview('keyboard'));
    }
    density.addEventListener('change', () => { settings.set('weatherDensity', density.value);update(); });
    leaves.addEventListener('change', () => { settings.set('weatherLeaves', leaves.value);update(); });
    scope.addEventListener('change', () => { settings.set('weatherScope', scope.value);update(); });
    quality.addEventListener('change', () => { settings.set('weatherQuality', quality.value);update(); });
    section.querySelectorAll('[data-weather-range]').forEach(input => {
        const key = input.dataset.weatherRange;
        input.addEventListener('input', () => {
            const value = input.valueAsNumber;
            if (!Number.isFinite(value)) return;
            pending.set(key, value);update();
        });
        for (const event of ['change', 'blur', 'pointercancel']) input.addEventListener(event, () => { commit(key);update(); });
    });
    pause.addEventListener('click', () => { surface.setPaused(!surface.previewPaused);update(); });
    reset.addEventListener('click', () => {
        pending.clear();surface.setPaused(false);
        for (const key of ['weatherDensity', 'weatherLeaves', 'weatherSpeed', 'weatherWind', 'weatherOpacity', 'weatherSize', 'weatherQuality']) {
            if (settings.get(key) !== settings.defaults[key]) settings.set(key, settings.defaults[key]);
        }
        update();
    });
    window.addEventListener('molly-weather-changed', update);
    window.addEventListener('molly-language-changed', update);
    window.addEventListener('pagehide', commitAll);
    media.addEventListener('change', update);
    update();
    return () => {
        commitAll();
        window.removeEventListener('molly-weather-changed', update);
        window.removeEventListener('molly-language-changed', update);
        window.removeEventListener('pagehide', commitAll);
        media.removeEventListener('change', update);
        surface.dispose();
    };
}
