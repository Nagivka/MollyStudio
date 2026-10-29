import {revealTheme} from './VisualEffects.js';
import {uiSounds} from './UISounds.js';
import {openDiagnostics} from './DiagnosticsDialog.js';
import {actionButtonHTML} from './Controls.mjs';
import {bindAttribute, bindText, labelHTML, attributeHTML, uiLabel, localeValue, translate, LANGUAGES} from '../core/Locale.mjs';
import { renderShortcutSettings } from './ShortcutSettings.js';
import { NUMERIC_SETTING_RANGES } from '../core/SettingsManager.js';
import {renderWeatherSettings} from './WeatherSettings.js';
import {renderLiquidGlassSettings} from './LiquidGlassSettings.js';
import {mountUpdatePanel} from './UpdatePanel.js';
/**
 * SettingsModal - shared settings renderer with the 1.2.5 appearance.
 * Organizes application settings into dedicated tabs:
 * 1. Appearance (Standard and experimental themes, accent colors, density & animations)
 * 2. Canvas & Grid (Pixel Grid, Opacity, Zoom threshold, Checkerboard, Wheel navigation)
 * 3. Tools & Drawing (Smart Magnetic Guides, Pixel-Perfect Pencil, Aspect lock, Pipette, Undo Depth)
 * 4. Export & Autosave (Upscale scale, Trim transparency, Autosave interval, Close confirmation)
 * 5. Discord RPC (Real-time Live connection status, custom client ID, toggles, reconnect button)
 * 6. Data & Backup (Export JSON, Import JSON, Clear recent projects, Factory reset)
 * 7. Hotkeys (Searchable hotkeys cheatsheet with category filtering)
 * 8. About (Local application metadata)
 */
import { confirmDialog } from './ConfirmDialog.js';
import { getApplicationInfo } from './ApplicationInfo.js';
import { iconDisclosure } from './IconDisclosure.js';

export default class SettingsModal {
    constructor(bus, settingsManager) {
        this.bus = bus;
        this.settings = settingsManager;
        this.modalEl = null;
        this.activeTab = 'appearance';
        this.discordPollTimer = null;

        this.themes = [
            // 5 Тёмных тем
            { id: 'dark', name: 'Dark M3', type: 'dark', prevClass: 'theme-dark-prev', icon: 'dark_mode' },
            { id: 'oled', name: 'OLED Black', type: 'dark', prevClass: 'theme-oled-prev', icon: 'contrast' },
            { id: 'midnight', name: 'Midnight', type: 'dark', prevClass: 'theme-midnight-prev', icon: 'nightlight' },
            { id: 'forest', name: 'Forest', type: 'dark', prevClass: 'theme-forest-prev', icon: 'park' },
            { id: 'amethyst', name: 'Amethyst', type: 'dark', prevClass: 'theme-amethyst-prev', icon: 'auto_awesome' },
            // 5 Светлых тем
            { id: 'light', name: 'Light M3', type: 'light', prevClass: 'theme-light-prev', icon: 'light_mode' },
            { id: 'light-nord', name: 'Nord Frost', type: 'light', prevClass: 'theme-light-nord-prev', icon: 'ac_unit' },
            { id: 'light-warm', name: 'Warm Paper', type: 'light', prevClass: 'theme-light-warm-prev', icon: 'menu_book' },
            { id: 'light-rose', name: 'Blush Rose', type: 'light', prevClass: 'theme-light-rose-prev', icon: 'favorite' },
            { id: 'light-mint', name: 'Emerald Mint', type: 'light', prevClass: 'theme-light-mint-prev', icon: 'eco' },
            // Experimental interface theme: Bedrock controls and FLAT surfaces.
            { id: 'minecraft', name: 'Minecraft', type: 'dark', prevClass: 'theme-minecraft-prev', icon: 'deployed_code', experimental: true },
            { id: 'light-minecraft', name: 'Minecraft', type: 'light', prevClass: 'theme-light-minecraft-prev', icon: 'deployed_code', experimental: true }
        ];

        this.accentPresets = [
            { name: 'Sapphire Blue', hex: '#2563EB' },
            { name: 'Sky Azure', hex: '#0284C7' },
            { name: 'Cyan Breeze', hex: '#06B6D4' },
            { name: 'Deep Teal', hex: '#0D9488' },
            { name: 'Emerald Mint', hex: '#10B981' },
            { name: 'Lime Punch', hex: '#84CC16' },
            { name: 'Golden Sun', hex: '#EAB308' },
            { name: 'Amber Orange', hex: '#F97316' },
            { name: 'Warm Sand', hex: '#D97706' },
            { name: 'Coral Flame', hex: '#F43F5E' },
            { name: 'Crimson Red', hex: '#EF4444' },
            { name: 'Rose Blush', hex: '#E11D48' },
            { name: 'Neon Fuchsia', hex: '#D946EF' },
            { name: 'Electric Violet', hex: '#7C3AED' },
            { name: 'Cosmic Indigo', hex: '#6366F1' },
            { name: 'Slate Graphite', hex: '#64748B' }
        ];

        this.hotkeysData = [
            { key: 'V / K', desc: 'Инструмент перемещения, свободной трансформации и магнита', cat: 'Инструменты' },
            { key: 'M', desc: 'Прямоугольное выделение с плавающим переносом', cat: 'Инструменты' },
            { key: 'B', desc: 'Кисть', cat: 'Инструменты' },
            { key: 'P', desc: 'Карандаш Pixel-Perfect', cat: 'Инструменты' },
            { key: 'E', desc: 'Ластик', cat: 'Инструменты' },
            { key: 'G', desc: 'Заливка', cat: 'Инструменты' },
            { key: 'Shift+G', desc: 'Градиентная заливка', cat: 'Инструменты' },
            { key: 'I', desc: 'Пипетка цвета', cat: 'Инструменты' },
            { key: 'L', desc: 'Линия, Shift для привязки 45°', cat: 'Инструменты' },
            { key: 'U', desc: 'Контур прямоугольника, Shift для квадрата', cat: 'Инструменты' },
            { key: 'Shift+U', desc: 'Залитый прямоугольник, Shift для квадрата', cat: 'Инструменты' },
            { key: 'C', desc: 'Контур эллипса, Shift для круга', cat: 'Инструменты' },
            { key: 'Shift+C', desc: 'Залитый эллипс, Shift для круга', cat: 'Инструменты' },
            { key: 'T', desc: 'Текст Minecraft с цветами', cat: 'Инструменты' },
            { key: 'H / Пробел', desc: 'Панорамирование холста', cat: 'Инструменты' },
            { key: 'СКМ Колесико', desc: 'Панорамирование холста перетаскиванием', cat: 'Инструменты' },
            { key: 'Удержание Alt', desc: 'Быстрая пипетка цвета с авто-возвратом к инструменту', cat: 'Рисование' },
            { key: 'Shift+X', desc: 'Переключить зеркальную симметрию по горизонтали', cat: 'Рисование' },
            { key: 'Shift+Y', desc: 'Переключить зеркальную симметрию по вертикали', cat: 'Рисование' },
            { key: 'X', desc: 'Поменять основной и фоновый цвета', cat: 'Цвет' },
            { key: 'D', desc: 'Сбросить цвета по умолчанию к чёрному и белому', cat: 'Цвет' },
            { key: '[ / ]', desc: 'Уменьшить или увеличить размер инструмента', cat: 'Рисование' },
            { key: 'Ctrl+Z', desc: 'Отменить действие', cat: 'Правка' },
            { key: 'Ctrl+Y', desc: 'Повторить действие', cat: 'Правка' },
            { key: 'Ctrl+C', desc: 'Скопировать выделенную область в буфер', cat: 'Выделение' },
            { key: 'Ctrl+X', desc: 'Вырезать выделенную область в буфер', cat: 'Выделение' },
            { key: 'Ctrl+V', desc: 'Вставить из буфера обмена', cat: 'Выделение' },
            { key: 'Ctrl+D / Esc', desc: 'Снять выделение', cat: 'Выделение' },
            { key: 'Ctrl+A', desc: 'Выделить весь холст', cat: 'Выделение' },
            { key: 'Ctrl+Shift+I', desc: 'Инвертировать выделение', cat: 'Выделение' },
            { key: 'Ctrl+\'', desc: 'Переключить пиксельную сетку', cat: 'Вид' },
            { key: 'F', desc: 'Подогнать холст под экран', cat: 'Вид' },
            { key: 'Ctrl+0', desc: 'Сбросить масштаб холста к 100%', cat: 'Вид' },
            { key: 'Ctrl+,', desc: 'Параметры программы', cat: 'Окно' },
            { key: 'Ctrl+Shift+E', desc: 'Экспорт в PNG', cat: 'Файл' }
        ];

        this.init();
    }

    init() {
        window.addEventListener('resize', () => {
            if (this.modalEl?.classList.contains('show')) this.modalEl.querySelector('.settings-tab-btn.active')?.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'nearest' });
        });
        window.addEventListener('keydown', (e) => {
            if (e.defaultPrevented) return;
            if ((e.ctrlKey || e.metaKey) && (e.code === 'Comma' || e.key === ',' || e.key === 'б' || e.key === 'Б')) {
                e.preventDefault();
                if (window.desktopAPI?.openSettingsWindow) window.desktopAPI.openSettingsWindow();
                else this.toggle();
            } else if (e.key === 'Escape' && this.modalEl && this.modalEl.classList.contains('show')) {
                this.close();
            }
        });
    }

    createDOM() {
        if (this.modalEl) return;

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'settings-modal-overlay';

        overlay.innerHTML = `
            <div class="modal settings-modal-container" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title" tabindex="-1">
                <div class="modal-header settings-modal-header">
                    <div class="settings-modal-title-wrap">
                        <i class="material-symbols-rounded settings-modal-icon">settings</i>
                        <div>
                            <div class="settings-modal-title" id="settings-modal-title"><!--i18n-->Параметры программы</div>
                            <div class="settings-modal-subtitle"><!--i18n-->Оформление, холст, инструменты и сохранение</div>
                        </div>
                    </div>
                    <button class="md-icon-btn btn-close-settings m3-bubble-action" title="Закрыть" data-i18n-title="%D0%97%D0%B0%D0%BA%D1%80%D1%8B%D1%82%D1%8C" aria-label="Закрыть настройки" data-i18n-aria-label="%D0%97%D0%B0%D0%BA%D1%80%D1%8B%D1%82%D1%8C%20%D0%BD%D0%B0%D1%81%D1%82%D1%80%D0%BE%D0%B9%D0%BA%D0%B8" type="button"><i class="material-symbols-rounded">close</i></button>
                </div>

                <div class="settings-modal-layout">
                    <!-- Tabs Sidebar -->
                    <aside class="settings-tabs-sidebar" role="tablist" aria-label="Разделы настроек" data-i18n-aria-label="%D0%A0%D0%B0%D0%B7%D0%B4%D0%B5%D0%BB%D1%8B%20%D0%BD%D0%B0%D1%81%D1%82%D1%80%D0%BE%D0%B5%D0%BA" aria-orientation="vertical">
                        <button class="settings-tab-btn active m3-bubble-action" id="settings-modal-tab-appearance" data-tab="appearance" role="tab" aria-controls="settings-content-area" aria-selected="true" type="button">
                            <i class="material-symbols-rounded">palette</i>
                            <span><!--i18n-->Внешний вид</span>
                        </button>
                        <button class="settings-tab-btn m3-bubble-action" id="settings-modal-tab-effects" data-tab="effects" role="tab" aria-controls="settings-content-area" aria-selected="false" type="button"><i class="material-symbols-rounded">auto_awesome</i><span><!--i18n-->Эффекты интерфейса</span></button>
                        <button class="settings-tab-btn m3-bubble-action" id="settings-modal-tab-canvas" data-tab="canvas" role="tab" aria-controls="settings-content-area" aria-selected="false" type="button">
                            <i class="material-symbols-rounded">grid_view</i>
                            <span><!--i18n-->Холст и сетка</span>
                        </button>
                        <button class="settings-tab-btn m3-bubble-action" id="settings-modal-tab-tools" data-tab="tools" role="tab" aria-controls="settings-content-area" aria-selected="false" type="button">
                            <i class="material-symbols-rounded">tune</i>
                            <span><!--i18n-->Инструменты</span>
                        </button>
                        <button class="settings-tab-btn m3-bubble-action" id="settings-modal-tab-export" data-tab="export" role="tab" aria-controls="settings-content-area" aria-selected="false" type="button">
                            <i class="material-symbols-rounded">download</i>
                            <span><!--i18n-->Экспорт и авто</span>
                        </button>
                        <button class="settings-tab-btn m3-bubble-action" id="settings-modal-tab-discord" data-tab="discord" role="tab" aria-controls="settings-content-area" aria-selected="false" type="button">
                            <i class="material-symbols-rounded">sports_esports</i>
                            <span>Discord RPC</span>
                        </button>
                        <button class="settings-tab-btn m3-bubble-action" id="settings-modal-tab-backup" data-tab="backup" role="tab" aria-controls="settings-content-area" aria-selected="false" type="button">
                            <i class="material-symbols-rounded">database</i>
                            <span><!--i18n-->Данные и сброс</span>
                        </button>
                        <button class="settings-tab-btn m3-bubble-action" id="settings-modal-tab-hotkeys" data-tab="hotkeys" role="tab" aria-controls="settings-content-area" aria-selected="false" type="button">
                            <i class="material-symbols-rounded">keyboard</i>
                            <span><!--i18n-->Горячие клавиши</span>
                        </button>
                        <button class="settings-tab-btn m3-bubble-action" id="settings-modal-tab-about" data-tab="about" role="tab" aria-controls="settings-content-area" aria-selected="false" type="button"><i class="material-symbols-rounded">info</i><span><!--i18n-->О программе</span></button>
                    </aside>

                    <!-- Content Body -->
                    <section class="settings-content-body" id="settings-content-area" role="tabpanel" aria-labelledby="settings-modal-tab-appearance" tabindex="0"></section>
                </div>

                <div class="modal-footer">
                    <button class="md-btn flat btn-close-settings m3-bubble-action" type="button"><!--i18n-->Закрыть</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        this.modalEl = overlay;

        overlay.querySelectorAll('.btn-close-settings').forEach(btn => {
            btn.addEventListener('click', () => this.close());
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.close();
        });

        overlay.querySelectorAll('.settings-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.switchTab(btn.dataset.tab);
            });
        });
    }

    open() {
        this.createDOM();
        requestAnimationFrame(() => {
            this.modalEl.classList.add('show');
        });
        this.switchTab(this.activeTab);
    }

    close() {
        if (this.modalEl) {
            this.modalEl.classList.remove('show');
        }
        this.disposeTab();
    }

    disposeTab() {
        this.disposeUpdates?.();this.disposeUpdates=null;
        this.disposeWeather?.();
        this.disposeWeather = null;
        this.disposeGlass?.();this.disposeGlass=null;
        if (this.discordPollTimer) {
            clearInterval(this.discordPollTimer);
            this.discordPollTimer = null;
        }
    }

    toggle() {
        if (this.modalEl && this.modalEl.classList.contains('show')) {
            this.close();
        } else {
            this.open();
        }
    }

    switchTab(tabId) {
        this.activeTab = tabId;
        if (!this.modalEl) {
            this.onTabRequested?.(tabId);
            return;
        }

        this.disposeTab();

        this.modalEl.querySelectorAll('.settings-tab-btn').forEach(btn => {
            const isActive = btn.dataset.tab === tabId;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
            btn.tabIndex = isActive ? 0 : -1;
            if (isActive) btn.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'nearest' });
        });

        const contentArea = this.modalEl.querySelector('#settings-content-area');
        if (!contentArea) return;
        contentArea.setAttribute('aria-labelledby', `settings-modal-tab-${tabId}`);

        contentArea.innerHTML = '';
        switch (tabId) {
            case 'effects':this.renderEffectsTab(contentArea);break;
            case 'appearance':
                this.renderAppearanceTab(contentArea);
                break;
            case 'canvas':
                this.renderCanvasTab(contentArea);
                break;
            case 'tools':
                this.renderToolsTab(contentArea);
                break;
            case 'export':
                this.renderExportTab(contentArea);
                break;
            case 'discord':
                this.renderDiscordTab(contentArea);
                break;
            case 'backup':
                this.renderBackupTab(contentArea);
                break;
            case 'hotkeys':
                this.renderHotkeysTab(contentArea);
                break;
            case 'about':
                this.renderAboutTab(contentArea);
                break;
        }
        contentArea.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }

    renderAboutTab(container) {
        container.innerHTML = `<div class="settings-section about-section">
            <div class="about-brand"><span class="molly-logo" aria-hidden="true"></span><div><h2>MollyStudio</h2><p><!--i18n-->Редактор GUI, текстур и префиксов для Minecraft</p></div></div>
            <dl class="about-info"><div><dt><!--i18n-->Версия</dt><dd data-about-version>…</dd></div><div><dt><!--i18n-->Автор</dt><dd data-about-author>nagivka</dd></div><div><dt><!--i18n-->Лицензия</dt><dd data-about-license>MIT</dd></div><div><dt><!--i18n-->Вариант приложения</dt><dd data-about-distribution>…</dd></div></dl>
            ${iconDisclosure({ label: 'Техническая информация', icon: 'memory', className: 'about-technical', content: "<p data-about-technical></p><button class=\"md-btn outlined\" type=\"button\" data-copy-app-info><i class=\"material-symbols-rounded\" aria-hidden=\"true\">content_copy</i><!--i18n-->Скопировать информацию</button>" })}
            ${actionButtonHTML({action:"diagnostics",label:"Отчёт диагностики",icon:"memory",attribute:"data-about-action"})}<p class="about-copyright" data-about-copyright></p></div>`;
        const section = container.firstElementChild;
        this.disposeUpdates?.();
        this.disposeUpdates = mountUpdatePanel(section);
        section.querySelector('[data-about-action=diagnostics]').addEventListener('click',()=>openDiagnostics());
        void getApplicationInfo().then(info => {
            if (!section.isConnected) return;
            const labels = { installed: 'Установленная версия', portable: 'Portable', development: 'Запуск из исходников', unsupported: 'Другая платформа', browser: 'Веб-предпросмотр' };
            bindText(section.querySelector('[data-about-version]'), info.buildVersion && info.buildVersion !== info.version ? '{0} · сборка {1}' : '{0}', {0:info.version,1:info.buildVersion});
            section.querySelector('[data-about-author]').textContent = info.author;
            section.querySelector('[data-about-license]').textContent = info.license;
            bindText(section.querySelector('[data-about-distribution]'), labels[info.distribution] || '—');
            section.querySelector('[data-about-copyright]').textContent = info.copyright || '';
            const technical = [info.name + ' ' + info.version, translate(labels[info.distribution]), [info.platform, info.arch].filter(Boolean).join(' '), info.electron && 'Electron ' + info.electron, info.chromium && 'Chromium ' + info.chromium].filter(Boolean).join('\n');
            section.querySelector('[data-about-technical]').textContent = technical;
            section.querySelector('[data-copy-app-info]').addEventListener('click', async () => {
                try { await navigator.clipboard.writeText(technical);this.showToast('Информация скопирована'); }
                catch { this.showToast('Не удалось скопировать информацию'); }
            });
        });
    }

    // =========================================================================
    // Tab 1: Appearance (Внешний вид)
    // =========================================================================
    renderEffectsTab(container){this.renderAppearanceTab(container,true);}

    renderAppearanceTab(container,effects=false) {
        const currentTheme = this.settings.get('theme') || 'dark';
        const currentAccent = this.settings.get('accentColor') || 'auto';
        const currentScale = this.settings.get('uiScale') || '100%';
        const currentAnim = this.settings.get('animationsEnabled') ?? true;
        const themeAccent = getComputedStyle(document.documentElement).getPropertyValue('--md-primary').trim();
        const pickerAccent = currentAccent === 'auto'
            ? (/^#[0-9A-Fa-f]{6}$/.test(themeAccent) ? themeAccent : '#a8c7fa')
            : currentAccent;

        const sec = document.createElement('div');
        sec.className = 'settings-section';

        const themeCardsHtml = this.themes.map(t => `
            <button type="button" class="settings-theme-card m3-bubble-action ${currentTheme === t.id ? 'active' : ''}" data-theme="${t.id}" ${attributeHTML('title', t.experimental ? '{0} — тестовая тема: кнопки Bedrock, интерфейс FLAT' : '{0}', {0:t.name})} aria-pressed="${currentTheme === t.id}" ${attributeHTML('aria-label','Тема {0}, {1}{2}', {0:t.name,1:uiLabel(t.type === 'light'?'Светлая':'Тёмная'),2:localeValue(t.experimental?', тестовая':'',t.experimental?', test':'')})}>
                <div class="theme-card-preview ${t.prevClass}" aria-hidden="true"></div>
                <div class="theme-card-title">
                    <i class="material-symbols-rounded">${t.icon}</i>
                    <span>${t.name}</span>
                </div>
                <span class="theme-badge ${t.type}">${labelHTML(t.type === 'light' ? t.experimental ? 'Светлая · Тест' : 'Светлая' : t.experimental ? 'Тёмная · Тест' : 'Тёмная')}</span>
            </button>
        `).join('');

        sec.innerHTML = `
            <div class="settings-group">
                <label class="settings-group-title" for="setting-language-select"><!--i18n-->Язык интерфейса</label>
                <div class="settings-group-desc"><!--i18n-->Язык меняется во всех окнах. Текст проектов остаётся прежним.</div>
                <select id="setting-language-select" class="md-select">
                    ${LANGUAGES.map(({id,name})=>`<option value="${id}" ${this.settings.get('language') === id ? 'selected' : ''}>${name}</option>`).join('')}
                </select>
            </div>
            <div class="settings-divider"></div>
            <div class="settings-group">
                <div class="settings-group-title"><!--i18n-->Тема оформления</div>
                <div class="settings-group-desc"><!--i18n-->Коллекция сбалансированных тёмных и светлых тем с автоматической калибровкой контраста</div>
                
                <div class="settings-theme-cards">
                    ${themeCardsHtml}
                </div>
            </div>

            <div class="settings-divider"></div>

            <div class="settings-group">
                <div class="settings-group-title"><!--i18n-->Акцентный цвет</div>
                <div class="settings-group-desc"><!--i18n-->Основной цвет кнопок, переключателей, выделений и индикаторов интерфейса</div>

                <div class="settings-accent-grid" id="settings-accent-presets" role="group" aria-label="Предустановленные акцентные цвета" data-i18n-aria-label="%D0%9F%D1%80%D0%B5%D0%B4%D1%83%D1%81%D1%82%D0%B0%D0%BD%D0%BE%D0%B2%D0%BB%D0%B5%D0%BD%D0%BD%D1%8B%D0%B5%20%D0%B0%D0%BA%D1%86%D0%B5%D0%BD%D1%82%D0%BD%D1%8B%D0%B5%20%D1%86%D0%B2%D0%B5%D1%82%D0%B0"></div>

                <div class="settings-custom-accent-row">
                    <label class="custom-accent-label" for="settings-custom-color-input"><!--i18n-->Пользовательский цвет HEX:</label>
                    <input type="color" id="settings-custom-color-picker" value="${pickerAccent}" class="md-color-chip" title="Палитра цвета" data-i18n-title="%D0%9F%D0%B0%D0%BB%D0%B8%D1%82%D1%80%D0%B0%20%D1%86%D0%B2%D0%B5%D1%82%D0%B0" aria-label="Выбрать пользовательский акцентный цвет" data-i18n-aria-label="%D0%92%D1%8B%D0%B1%D1%80%D0%B0%D1%82%D1%8C%20%D0%BF%D0%BE%D0%BB%D1%8C%D0%B7%D0%BE%D0%B2%D0%B0%D1%82%D0%B5%D0%BB%D1%8C%D1%81%D0%BA%D0%B8%D0%B9%20%D0%B0%D0%BA%D1%86%D0%B5%D0%BD%D1%82%D0%BD%D1%8B%D0%B9%20%D1%86%D0%B2%D0%B5%D1%82">
                    <input type="text" id="settings-custom-color-input" value="${currentAccent === 'auto' ? '' : currentAccent}" placeholder="#4285F4" class="md-input md-custom-color-text" maxlength="7" pattern="#[0-9A-Fa-f]{6}" aria-describedby="settings-custom-color-hint">
                    <span id="settings-custom-color-hint" class="md-sr-only"><!--i18n-->Введите цвет в формате HEX, например #4285F4</span>
                </div>
            </div>

            <div class="settings-divider"></div>

            <div class="settings-group">
                <div class="settings-group-title"><!--i18n-->Типографика интерфейса</div>
                <div class="settings-group-desc"><span data-default-font-description><!--i18n-->Интерфейс и заголовки используют Google Sans.</span><span data-minecraft-font-description><!--i18n-->Текст использует Minecraft1, заголовки — Minecraft Ten.</span></div>
            </div>

            <div class="settings-divider"></div>

            <div class="settings-group">
                <div class="settings-group-title"><!--i18n-->Звуки интерфейса</div>
                <div class="settings-group-desc"><!--i18n-->Тихие звуки нажатий, переключения вкладок и успешного сохранения. По умолчанию выключены.</div>
                <label class="md-switch">
                    <input type="checkbox" id="setting-ui-sounds" ${this.settings.get('uiSoundsEnabled')?'checked':''}>
                    <span class="md-switch-track"><span class="md-switch-thumb"></span></span>
                    <span class="md-switch-label"><!--i18n-->Включить звуки интерфейса</span>
                </label>
                <div class="settings-row-wrap" style="margin-top:16px">
                    <div class="settings-col">
                        <label for="setting-ui-sound-volume" class="settings-col-label"><!--i18n-->Громкость звуков</label>
                        <input type="range" id="setting-ui-sound-volume" min="0" max="100" step="1" value="${this.settings.get('uiSoundVolume')}" ${this.settings.get('uiSoundsEnabled')?'':'disabled'}>
                        <output for="setting-ui-sound-volume" id="ui-sound-volume-value">${this.settings.get('uiSoundVolume')}%</output>
                    </div>
                    <button type="button" class="md-btn outlined" data-ui-sound-preview ${this.settings.get('uiSoundsEnabled')?'':'disabled'}><i class="material-symbols-rounded" aria-hidden="true">volume_up</i><span><!--i18n-->Проверить звук</span></button>
                </div>
            </div>
            <div class="settings-group">
                <div class="settings-group-title"><!--i18n-->Плотность интерфейса и анимации</div>
                <div class="settings-group-desc"><!--i18n-->Масштаб элементов управления и эффекты нажатия</div>

                <div class="settings-row-wrap">
                    <div class="settings-col">
                        <label for="setting-ui-scale-select" class="settings-col-label"><!--i18n-->Плотность элементов:</label>
                        <select id="setting-ui-scale-select" class="md-select">
                            <option value="90%" ${currentScale === '90%' ? 'selected' : ''}><!--i18n-->Компактный 90%</option>
                            <option value="100%" ${currentScale === '100%' ? 'selected' : ''}><!--i18n-->Стандартный 100%</option>
                            <option value="110%" ${currentScale === '110%' ? 'selected' : ''}><!--i18n-->Крупный 110%</option>
                        </select>
                    </div>

                    <div class="settings-col" style="justify-content: flex-end;">
                        <label class="md-switch">
                            <input type="checkbox" id="setting-animations-toggle" ${currentAnim ? 'checked' : ''}>
                            <span class="md-switch-track"><span class="md-switch-thumb"></span></span>
                            <span class="md-switch-label"><!--i18n-->Плавные анимации</span>
                        </label>
                    </div>
                </div>
            </div>
        `;

        container.appendChild(sec);

        sec.querySelectorAll('.settings-theme-card').forEach(card => {
            card.addEventListener('click', () => {
                const theme = card.dataset.theme;
                sec.querySelectorAll('.settings-theme-card').forEach(c => {
                    c.classList.remove('active');
                    c.setAttribute('aria-pressed', 'false');
                });
                card.classList.add('active');
                card.setAttribute('aria-pressed', 'true');
                this.settings.set('accentColor', 'auto');
                revealTheme(()=>this.settings.set('theme', theme),card);

                sec.querySelectorAll('.settings-accent-swatch').forEach(s => s.classList.remove('active'));
                const autoSwatch = sec.querySelector('.settings-accent-swatch.auto-swatch');
                if (autoSwatch) {
                    autoSwatch.classList.add('active');
                    autoSwatch.setAttribute('aria-pressed', 'true');
                }
                sec.querySelectorAll('.settings-accent-swatch:not(.auto-swatch)').forEach(s => s.setAttribute('aria-pressed', 'false'));
                const customInput = sec.querySelector('#settings-custom-color-input');
                if (customInput) customInput.value = '';
                const picker = sec.querySelector('#settings-custom-color-picker');
                const themeAccent = getComputedStyle(document.documentElement).getPropertyValue('--md-primary').trim();
                if (picker && /^#[0-9A-Fa-f]{6}$/.test(themeAccent)) picker.value = themeAccent;
            });
        });

        sec.querySelector('#setting-ui-scale-select')?.addEventListener('change', (e) => {
            this.settings.set('uiScale', e.target.value);
        });
        sec.querySelector('#setting-language-select')?.addEventListener('change', event => {
            this.settings.set('language', event.target.value);
        });

        sec.querySelector('#setting-animations-toggle')?.addEventListener('change', (e) => {
            this.settings.set('animationsEnabled', e.target.checked);
        });
        const soundToggle=sec.querySelector('#setting-ui-sounds'),soundVolume=sec.querySelector('#setting-ui-sound-volume'),soundPreview=sec.querySelector('[data-ui-sound-preview]');
        soundToggle.addEventListener('change',()=>{
            this.settings.set('uiSoundsEnabled',soundToggle.checked);
            soundVolume.disabled=soundPreview.disabled=!soundToggle.checked;
        });
        soundVolume.addEventListener('input',()=>{
            this.settings.set('uiSoundVolume',Number(soundVolume.value));
            sec.querySelector('#ui-sound-volume-value').value=soundVolume.value+'%';
        });
        soundPreview.addEventListener('click',()=>uiSounds.play('save'));

        if(effects)this.disposeWeather = renderWeatherSettings(sec, this.settings);

        const presetsContainer = sec.querySelector('#settings-accent-presets');
        const selectSwatch = selected => {
            sec.querySelectorAll('.settings-accent-swatch').forEach(swatch => {
                const isSelected = swatch === selected;
                swatch.classList.toggle('active', isSelected);
                swatch.setAttribute('aria-pressed', String(isSelected));
            });
        };

        // Dynamic theme auto-accent button
        const autoSwatch = document.createElement('button');
        autoSwatch.type = 'button';
        autoSwatch.className = `settings-accent-swatch auto-swatch m3-bubble-action ${currentAccent === 'auto' ? 'active' : ''}`;
        bindAttribute(autoSwatch, "title", 'Оригинальный цвет выбранной темы');
        bindAttribute(autoSwatch, "aria-label", 'Автоматический цвет выбранной темы');
        autoSwatch.setAttribute('aria-pressed', String(currentAccent === 'auto'));
        autoSwatch.innerHTML = '<i class="material-symbols-rounded" style="font-size: 16px; color: var(--md-primary);" aria-hidden="true">auto_awesome</i>';
        autoSwatch.addEventListener('click', () => {
            selectSwatch(autoSwatch);
            this.settings.set('accentColor', 'auto');
            const colorInput = sec.querySelector('#settings-custom-color-input');
            if (colorInput) colorInput.value = '';
            const picker = sec.querySelector('#settings-custom-color-picker');
            const themeAccent = getComputedStyle(document.documentElement).getPropertyValue('--md-primary').trim();
            if (picker && /^#[0-9A-Fa-f]{6}$/.test(themeAccent)) picker.value = themeAccent;
        });
        presetsContainer.appendChild(autoSwatch);

        this.accentPresets.forEach(preset => {
            const swatch = document.createElement('button');
            swatch.type = 'button';
            const isSelected = currentAccent !== 'auto' && preset.hex.toLowerCase() === currentAccent.toLowerCase();
            swatch.className = `settings-accent-swatch m3-bubble-action ${isSelected ? 'active' : ''}`;
            swatch.style.backgroundColor = preset.hex;
            swatch.title = `${preset.name}: ${preset.hex}`;
            swatch.setAttribute('aria-label', `${preset.name}, ${preset.hex}`);
            swatch.setAttribute('aria-pressed', String(isSelected));
            swatch.style.setProperty('--accent-swatch-on', this.settings.bestOnColor(this.settings.hexToRgb(preset.hex)));


            swatch.addEventListener('click', () => {
                selectSwatch(swatch);
                this.settings.set('accentColor', preset.hex);

                const colorInput = sec.querySelector('#settings-custom-color-input');
                const picker = sec.querySelector('#settings-custom-color-picker');
                if (colorInput) colorInput.value = preset.hex;
                if (picker) picker.value = preset.hex;
            });

            presetsContainer.appendChild(swatch);
        });

        const customPicker = sec.querySelector('#settings-custom-color-picker');
        const customInput = sec.querySelector('#settings-custom-color-input');

        customPicker?.addEventListener('input', (e) => {
            const hex = e.target.value;
            if (customInput) customInput.value = hex;
            const matchingPreset = [...sec.querySelectorAll('.settings-accent-swatch:not(.auto-swatch)')]
                .find(swatch => swatch.title?.toLowerCase().endsWith(hex.toLowerCase()));
            selectSwatch(matchingPreset || null);
            customInput?.removeAttribute('aria-invalid');
            this.settings.set('accentColor', hex);
        });

        customInput?.addEventListener('change', (e) => {
            let hex = e.target.value.trim();
            if (!hex.startsWith('#')) hex = '#' + hex;
            if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
                hex = hex.toUpperCase();
                if (customPicker) customPicker.value = hex;
                const matchingPreset = [...sec.querySelectorAll('.settings-accent-swatch:not(.auto-swatch)')]
                    .find(swatch => swatch.title?.toLowerCase().endsWith(hex.toLowerCase()));
                selectSwatch(matchingPreset || null);
                customInput?.removeAttribute('aria-invalid');
                this.settings.set('accentColor', hex);
            } else {
                customInput?.setAttribute('aria-invalid', 'true');
            }
        });
        const soundGroup=sec.querySelector('#setting-ui-sounds').closest('.settings-group'),animationGroup=sec.querySelector('#setting-animations-toggle').closest('.settings-group');
        if(effects){
            bindText(animationGroup.querySelector('.settings-group-title'),'Анимации интерфейса');
            for(const group of [...sec.children])if(group!==soundGroup&&group!==animationGroup&&!group.querySelector('[data-weather-range]'))group.remove();
            animationGroup.querySelector('#setting-ui-scale-select').closest('.settings-col').remove();
            const controls=document.createElement('div');controls.className='settings-group';
            controls.innerHTML=`<div class="settings-group-title">${labelHTML('Эффекты интерфейса')}</div>${[['clickEffectsEnabled','Отклик на нажатие'],['animatedAccentsEnabled','Анимированные акценты'],['cardMotionEnabled','Движение карточек'],['themeTransitionsEnabled','Переход между темами'],['saveFeedbackEnabled','Подтверждение сохранения']].map(([key,label])=>`<label class="md-switch" style="display:flex;margin-block:12px"><input type="checkbox" data-ui-effect="${key}" ${this.settings.get(key)?'checked':''}><span class="md-switch-track"><span class="md-switch-thumb"></span></span><span class="md-switch-label">${labelHTML(label)}</span></label>`).join('')}`;
            controls.querySelectorAll('[data-ui-effect]').forEach(input=>input.addEventListener('change',()=>this.settings.set(input.dataset.uiEffect,input.checked)));sec.prepend(controls);
            this.disposeGlass=renderLiquidGlassSettings(controls,this.settings);
            const seasonal=document.createElement('label');seasonal.className='md-switch';seasonal.style.cssText='display:flex;margin-block:16px';
            seasonal.innerHTML=`<input type="checkbox" id="setting-seasonal-details" ${this.settings.get('seasonalDetailsEnabled')?'checked':''}><span class="md-switch-track"><span class="md-switch-thumb"></span></span><span class="md-switch-label">${labelHTML('Праздничные детали')}</span>`;
            seasonal.querySelector('input').addEventListener('change',event=>this.settings.set('seasonalDetailsEnabled',event.target.checked));controls.append(seasonal);
            const profile=document.createElement('label');profile.className='prop-field-block';profile.innerHTML=`${labelHTML('Набор звуков')}<select class="md-select" id="setting-ui-sound-profile">${[['auto','По теме'],['soft','Мягкие'],['pixel','Пиксельные']].map(([key,label])=>`<option value="${key}">${labelHTML(label)}</option>`).join('')}</select>`;
            soundGroup.append(profile);const select=profile.querySelector('select');select.value=this.settings.get('uiSoundProfile');select.addEventListener('change',()=>this.settings.set('uiSoundProfile',select.value));
        }else{soundGroup.remove();animationGroup.querySelector('#setting-animations-toggle').closest('.settings-col').remove();bindText(animationGroup.querySelector('.settings-group-title'),'Плотность интерфейса');}
    }

    // =========================================================================
    // Tab 2: Canvas & Grid (Холст и сетка)
    // =========================================================================
    renderCanvasTab(container) {
        const showGrid = this.settings.get('showPixelGrid');
        const gridOp = this.settings.get('gridOpacity') ?? 20;
        const gridColor = this.settings.get('gridColor') || 'white';
        const gridMinZoom = this.settings.get('gridMinZoom') ?? 3;
        const gridZoomOptions = [...new Set([1.5, 2, 3, 4, 6, gridMinZoom])].sort((a, b) => a - b);
        const wheelMode = this.settings.get('wheelBehavior') || 'zoom';
        const invertZoom = this.settings.get('invertZoom') || false;
        const currentChecker = this.settings.get('checkerStyle') || 'dark';

        const sec = document.createElement('div');
        sec.className = 'settings-section';

        sec.innerHTML = `
            <div class="settings-group">
                <div class="settings-group-title"><!--i18n-->Пиксельная сетка</div>
                <div class="settings-group-desc"><!--i18n-->Линии, разделяющие отдельные пиксели холста</div>
                
                <div style="margin-top: 10px;">
                    <label class="md-switch">
                        <input type="checkbox" id="setting-grid-toggle" ${showGrid ? 'checked' : ''}>
                        <span class="md-switch-track"><span class="md-switch-thumb"></span></span>
                        <span class="md-switch-label"><!--i18n-->Показывать пиксельную сетку</span>
                    </label>
                </div>

                <div class="settings-row" style="margin-top: 14px;">
                    <label for="setting-grid-opacity" class="settings-row-label"><!--i18n-->Непрозрачность сетки:</label>
                    <div class="settings-slider-wrap">
                        <input type="range" id="setting-grid-opacity" class="md-slider" min="${NUMERIC_SETTING_RANGES.gridOpacity[0]}" max="${NUMERIC_SETTING_RANGES.gridOpacity[1]}" value="${gridOp}" aria-valuetext="${gridOp}%">
                        <span id="setting-grid-opacity-val" class="settings-val-badge">${gridOp}%</span>
                    </div>
                </div>

                <div class="settings-row-wrap" style="margin-top: 12px;">
                    <div class="settings-col">
                        <label for="setting-grid-color-select" class="settings-col-label"><!--i18n-->Цвет линий сетки:</label>
                        <select id="setting-grid-color-select" class="md-select">
                            <option value="white" ${gridColor === 'white' ? 'selected' : ''}><!--i18n-->Белый</option>
                            <option value="black" ${gridColor === 'black' ? 'selected' : ''}><!--i18n-->Чёрный</option>
                            <option value="accent" ${gridColor === 'accent' ? 'selected' : ''}><!--i18n-->В тон акцентного цвета</option>
                        </select>
                    </div>

                    <div class="settings-col">
                        <label for="setting-grid-minzoom-select" class="settings-col-label"><!--i18n-->Порог масштаба для отображения:</label>
                        <select id="setting-grid-minzoom-select" class="md-select">
                            ${gridZoomOptions.map(zoom => `<option value="${zoom}" ${gridMinZoom === zoom ? 'selected' : ''}>${labelHTML('От {0}×',{0:localeValue(String(zoom).replace('.', ','),String(zoom))})}</option>`).join('')}
                        </select>
                    </div>
                </div>
            </div>

            <div class="settings-divider"></div>

            <div class="settings-group">
                <div class="settings-group-title"><!--i18n-->Фон прозрачности</div>
                <div class="settings-group-desc"><!--i18n-->Стиль отображения прозрачных областей на холсте</div>
                
                <div style="margin-top: 10px; max-width: 320px;">
                    <select id="setting-checker-select" class="md-select" aria-label="Фон прозрачности" data-i18n-aria-label="%D0%A4%D0%BE%D0%BD%20%D0%BF%D1%80%D0%BE%D0%B7%D1%80%D0%B0%D1%87%D0%BD%D0%BE%D1%81%D1%82%D0%B8">
                        <option value="dark" ${currentChecker === 'dark' ? 'selected' : ''}><!--i18n-->Тёмная шахматка</option>
                        <option value="light" ${currentChecker === 'light' ? 'selected' : ''}><!--i18n-->Светлая шахматка</option>
                        <option value="black" ${currentChecker === 'black' ? 'selected' : ''}><!--i18n-->Сплошной чёрный фон</option>
                    </select>
                </div>
            </div>

            <div class="settings-divider"></div>

            <div class="settings-group">
                <div class="settings-group-title"><!--i18n-->Навигация и колёсико мыши</div>
                <div class="settings-group-desc"><!--i18n-->Поведение прокрутки при работе на холсте</div>

                <div class="settings-row-wrap" style="margin-top: 10px;">
                    <div class="settings-col">
                        <label for="setting-wheel-behavior" class="settings-col-label"><!--i18n-->Действие колёсика мыши:</label>
                        <select id="setting-wheel-behavior" class="md-select">
                            <option value="zoom" ${wheelMode === 'zoom' ? 'selected' : ''}><!--i18n-->Масштабирование холста</option>
                            <option value="pan-v" ${wheelMode === 'pan-v' ? 'selected' : ''}><!--i18n-->Вертикальная прокрутка</option>
                            <option value="pan-h" ${wheelMode === 'pan-h' ? 'selected' : ''}><!--i18n-->Горизонтальная прокрутка</option>
                        </select>
                    </div>

                    <div class="settings-col" style="justify-content: flex-end;">
                        <label class="md-switch">
                            <input type="checkbox" id="setting-invert-zoom" ${invertZoom ? 'checked' : ''}>
                            <span class="md-switch-track"><span class="md-switch-thumb"></span></span>
                            <span class="md-switch-label"><!--i18n-->Инвертировать направление зума</span>
                        </label>
                    </div>
                </div>
            </div>
        `;

        container.appendChild(sec);

        sec.querySelector('#setting-grid-toggle')?.addEventListener('change', (e) => {
            this.settings.set('showPixelGrid', e.target.checked);
        });

        const opSlider = sec.querySelector('#setting-grid-opacity');
        const opVal = sec.querySelector('#setting-grid-opacity-val');
        opSlider?.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            if (opVal) opVal.innerText = `${val}%`;
            e.target.setAttribute('aria-valuetext', `${val}%`);
            this.settings.set('gridOpacity', val);
        });

        sec.querySelector('#setting-grid-color-select')?.addEventListener('change', (e) => {
            this.settings.set('gridColor', e.target.value);
        });

        sec.querySelector('#setting-grid-minzoom-select')?.addEventListener('change', (e) => {
            this.settings.set('gridMinZoom', parseFloat(e.target.value));
        });

        sec.querySelector('#setting-checker-select')?.addEventListener('change', (e) => {
            this.settings.set('checkerStyle', e.target.value);
        });

        sec.querySelector('#setting-wheel-behavior')?.addEventListener('change', (e) => {
            this.settings.set('wheelBehavior', e.target.value);
        });

        sec.querySelector('#setting-invert-zoom')?.addEventListener('change', (e) => {
            this.settings.set('invertZoom', e.target.checked);
        });
    }

    // =========================================================================
    // Tab 3: Tools & Drawing (Инструменты и рисование)
    // =========================================================================
    renderToolsTab(container) {
        const pixelPerf = this.settings.get('pixelPerfect');
        const undoLim = this.settings.get('undoLimit') || 50;
        const snap = this.settings.get('snapEnabled') ?? true;
        const snapThresh = this.settings.get('snapThreshold') ?? 5;
        const lockAspect = this.settings.get('moveLockAspect') || false;
        const pipetteSample = this.settings.get('pipetteSampleSize') || '1x1';

        const sec = document.createElement('div');
        sec.className = 'settings-section';

        sec.innerHTML = `
            <div class="settings-group">
                <div class="settings-group-title"><!--i18n-->Автоматическое намагничивание</div>
                <div class="settings-group-desc"><!--i18n-->Интеллектуальное примагничивание слоёв и выделений к центру холста и границам</div>
                
                <div style="margin-top: 10px;">
                    <label class="md-switch">
                        <input type="checkbox" id="setting-snap-toggle" ${snap ? 'checked' : ''}>
                        <span class="md-switch-track"><span class="md-switch-thumb"></span></span>
                        <span class="md-switch-label"><!--i18n-->Включить авто-намагничивание</span>
                    </label>
                </div>
                
                <div class="settings-row" style="margin-top: 14px;">
                    <label for="setting-snap-thresh" class="settings-row-label"><!--i18n-->Радиус притяжения магнита:</label>
                    <div class="settings-slider-wrap">
                        <input type="range" id="setting-snap-thresh" class="md-slider" min="${NUMERIC_SETTING_RANGES.snapThreshold[0]}" max="${NUMERIC_SETTING_RANGES.snapThreshold[1]}" value="${snapThresh}" aria-valuetext="${snapThresh} px">
                        <span id="setting-snap-thresh-val" class="settings-val-badge">${snapThresh}px</span>
                    </div>
                </div>
            </div>

            <div class="settings-divider"></div>

            <div class="settings-group">
                <div class="settings-group-title"><!--i18n-->Поведение инструментов рисования</div>
                <div class="settings-group-desc"><!--i18n-->Специальные режимы создания пиксель-арта и текстур</div>
                
                <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 10px;">
                    <label class="md-switch">
                        <input type="checkbox" id="setting-pixel-perf" ${pixelPerf ? 'checked' : ''}>
                        <span class="md-switch-track"><span class="md-switch-thumb"></span></span>
                        <span class="md-switch-label"><!--i18n-->Pixel-Perfect для карандаша по умолчанию</span>
                    </label>

                    <label class="md-switch">
                        <input type="checkbox" id="setting-lock-aspect" ${lockAspect ? 'checked' : ''}>
                        <span class="md-switch-track"><span class="md-switch-thumb"></span></span>
                        <span class="md-switch-label"><!--i18n-->Сохранять пропорции при масштабировании</span>
                    </label>
                </div>

                <div class="settings-row-wrap" style="margin-top: 12px;">
                    <div class="settings-col">
                        <label for="setting-pipette-sample" class="settings-col-label"><!--i18n-->Область захвата пипетки:</label>
                        <select id="setting-pipette-sample" class="md-select">
                            <option value="1x1" ${pipetteSample === '1x1' ? 'selected' : ''}><!--i18n-->1×1 пиксель</option>
                            <option value="3x3" ${pipetteSample === '3x3' ? 'selected' : ''}><!--i18n-->3×3 пикселя</option>
                            <option value="5x5" ${pipetteSample === '5x5' ? 'selected' : ''}><!--i18n-->5×5 пикселей</option>
                        </select>
                    </div>
                </div>
            </div>

            <div class="settings-divider"></div>

            <div class="settings-group">
                <div class="settings-group-title"><!--i18n-->Глубина истории отмены</div>
                <div class="settings-group-desc"><!--i18n-->Максимальное количество сохраненных шагов истории действий</div>
                
                <div class="settings-row" style="margin-top: 12px;">
                    <label for="setting-undo-limit" class="settings-row-label"><!--i18n-->Лимит шагов от 10 до 200:</label>
                    <input type="number" id="setting-undo-limit" class="md-number-input" min="${NUMERIC_SETTING_RANGES.undoLimit[0]}" max="${NUMERIC_SETTING_RANGES.undoLimit[1]}" value="${undoLim}" style="width: 80px;">
                </div>
            </div>
        `;

        container.appendChild(sec);

        sec.querySelector('#setting-snap-toggle')?.addEventListener('change', (e) => {
            this.settings.set('snapEnabled', e.target.checked);
        });

        const snapSlider = sec.querySelector('#setting-snap-thresh');
        const snapVal = sec.querySelector('#setting-snap-thresh-val');
        snapSlider?.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            if (snapVal) snapVal.innerText = `${val}px`;
            e.target.setAttribute('aria-valuetext', `${val} px`);
            this.settings.set('snapThreshold', val);
        });

        sec.querySelector('#setting-pixel-perf')?.addEventListener('change', (e) => {
            this.settings.set('pixelPerfect', e.target.checked);
        });

        sec.querySelector('#setting-lock-aspect')?.addEventListener('change', (e) => {
            this.settings.set('moveLockAspect', e.target.checked);
        });

        sec.querySelector('#setting-pipette-sample')?.addEventListener('change', (e) => {
            this.settings.set('pipetteSampleSize', e.target.value);
        });

        sec.querySelector('#setting-undo-limit')?.addEventListener('change', (e) => {
            let val = parseInt(e.target.value, 10);
            val = Math.max(NUMERIC_SETTING_RANGES.undoLimit[0], Math.min(NUMERIC_SETTING_RANGES.undoLimit[1], isNaN(val) ? 50 : val));
            this.settings.set('undoLimit', val);
            e.target.value = String(this.settings.get('undoLimit'));
        });
    }

    // =========================================================================
    // Tab 4: Export & Autosave (Экспорт и автосохранение)
    // =========================================================================
    renderExportTab(container) {
        const exportScale = this.settings.get('exportScale') || 1;
        const exportTrim = this.settings.get('exportTrim') || false;
        const autosaveInt = this.settings.get('autosaveInterval') ?? 0;
        const confirmClose = this.settings.get('confirmClose') ?? true;

        const sec = document.createElement('div');
        sec.className = 'settings-section';

        sec.innerHTML = `
            <div class="settings-group">
                <div class="settings-group-title"><!--i18n-->Параметры экспорта в PNG</div>
                <div class="settings-group-desc"><!--i18n-->Масштабирование и обработка текстур при экспорте</div>

                <div class="settings-row-wrap" style="margin-top: 10px;">
                    <div class="settings-col">
                        <label for="setting-export-scale" class="settings-col-label"><!--i18n-->Масштаб экспортируемого файла:</label>
                        <select id="setting-export-scale" class="md-select">
                            <option value="1" ${exportScale == 1 ? 'selected' : ''}><!--i18n-->1x Оригинал</option>
                            <option value="2" ${exportScale == 2 ? 'selected' : ''}><!--i18n-->2x Увеличение</option>
                            <option value="4" ${exportScale == 4 ? 'selected' : ''}><!--i18n-->4x Увеличение</option>
                            <option value="8" ${exportScale == 8 ? 'selected' : ''}><!--i18n-->8x Увеличение</option>
                            <option value="16" ${exportScale == 16 ? 'selected' : ''}><!--i18n-->16x Увеличение</option>
                        </select>
                    </div>

                    <div class="settings-col" style="justify-content: flex-end;">
                        <label class="md-switch">
                            <input type="checkbox" id="setting-export-trim" ${exportTrim ? 'checked' : ''}>
                            <span class="md-switch-track"><span class="md-switch-thumb"></span></span>
                            <span class="md-switch-label"><!--i18n-->Обрезать прозрачные границы при экспорте</span>
                        </label>
                    </div>
                </div>
            </div>

            <div class="settings-divider"></div>

            <div class="settings-group">
                <div class="settings-group-title"><!--i18n-->Автоматическое сохранение проектов</div>
                <div class="settings-group-desc"><!--i18n-->Периодическое фоновое сохранение для защиты от непредвиденной потери данных</div>

                <div style="margin-top: 10px; max-width: 320px;">
                    <label for="setting-autosave-interval" class="settings-col-label"><!--i18n-->Интервал автосохранения:</label>
                    <select id="setting-autosave-interval" class="md-select">
                        <option value="0" ${autosaveInt == 0 ? 'selected' : ''}><!--i18n-->Отключено</option>
                        <option value="1" ${autosaveInt == 1 ? 'selected' : ''}><!--i18n-->Каждую 1 минуту</option>
                        <option value="3" ${autosaveInt == 3 ? 'selected' : ''}><!--i18n-->Каждые 3 минуты</option>
                        <option value="5" ${autosaveInt == 5 ? 'selected' : ''}><!--i18n-->Каждые 5 минут</option>
                        <option value="10" ${autosaveInt == 10 ? 'selected' : ''}><!--i18n-->Каждые 10 минут</option>
                    </select>
                </div>

                <div style="margin-top: 14px;">
                    <label class="md-switch">
                        <input type="checkbox" id="setting-confirm-close" ${confirmClose ? 'checked' : ''}>
                        <span class="md-switch-track"><span class="md-switch-thumb"></span></span>
                        <span class="md-switch-label"><!--i18n-->Предупреждать перед закрытием с несохранёнными изменениями</span>
                    </label>
                </div>
            </div>
        `;

        container.appendChild(sec);

        sec.querySelector('#setting-export-scale')?.addEventListener('change', (e) => {
            this.settings.set('exportScale', parseInt(e.target.value, 10));
        });

        sec.querySelector('#setting-export-trim')?.addEventListener('change', (e) => {
            this.settings.set('exportTrim', e.target.checked);
        });

        sec.querySelector('#setting-autosave-interval')?.addEventListener('change', (e) => {
            this.settings.set('autosaveInterval', parseInt(e.target.value, 10));
        });

        sec.querySelector('#setting-confirm-close')?.addEventListener('change', (e) => {
            this.settings.set('confirmClose', e.target.checked);
        });
    }

    // =========================================================================
    // Tab 5: Discord RPC
    // =========================================================================
    renderDiscordTab(container) {
        let discordRPC = this.settings.get('discordRPC') ?? true;
        let showProj = this.settings.get('discordShowProject') ?? true;
        let showTool = this.settings.get('discordShowTool') ?? true;
        let showTime = this.settings.get('discordShowTime') ?? true;
        let clientId = this.settings.get('discordClientId') || '1543550000133574677';

        const sec = document.createElement('div');
        sec.className = 'settings-section';

        sec.innerHTML = `
            <div class="settings-group">
                <div class="settings-group-title">Discord Rich Presence</div>
                <div class="settings-group-desc"><!--i18n-->Трансляция вашей активности, редактируемого проекта и инструмента в Discord</div>

                <!-- Live Status Card -->
                <div class="discord-status-card" id="discord-live-card">
                    <div class="discord-status-badge">
                        <span class="discord-status-dot disconnected" id="discord-status-dot"></span>
                        <span id="discord-status-text"><!--i18n-->Проверка статуса подключения...</span>
                    </div>
                    <button class="md-btn tonal m3-bubble-action" id="btn-reconnect-discord" type="button" style="height: 28px; font-size: 11px;">
                        <i class="material-symbols-rounded" style="font-size: 16px;">refresh</i><!--i18n--> Переподключить
                    </button>
                </div>

                <div style="margin-top: 14px;">
                    <label class="md-switch">
                        <input type="checkbox" id="setting-discord-rpc" ${discordRPC ? 'checked' : ''}>
                        <span class="md-switch-track"><span class="md-switch-thumb"></span></span>
                        <span class="md-switch-label"><!--i18n-->Включить интеграцию с Discord RPC</span>
                    </label>
                </div>

                <div style="margin-top: 12px; display: flex; flex-direction: column; gap: 10px; padding-left: 6px;">
                    <label class="md-switch">
                        <input type="checkbox" id="setting-discord-proj" ${showProj ? 'checked' : ''} ${!discordRPC ? 'disabled' : ''}>
                        <span class="md-switch-track"><span class="md-switch-thumb"></span></span>
                        <span class="md-switch-label"><!--i18n-->Показывать имя текущего проекта в статусе</span>
                    </label>

                    <label class="md-switch">
                        <input type="checkbox" id="setting-discord-tool" ${showTool ? 'checked' : ''} ${!discordRPC ? 'disabled' : ''}>
                        <span class="md-switch-track"><span class="md-switch-thumb"></span></span>
                        <span class="md-switch-label"><!--i18n-->Показывать активный инструмент рисования</span>
                    </label>

                    <label class="md-switch">
                        <input type="checkbox" id="setting-discord-time" ${showTime ? 'checked' : ''} ${!discordRPC ? 'disabled' : ''}>
                        <span class="md-switch-track"><span class="md-switch-thumb"></span></span>
                        <span class="md-switch-label"><!--i18n-->Показывать таймер времени сессии</span>
                    </label>
                </div>
            </div>
        `;

        container.appendChild(sec);

        const rpcToggle = sec.querySelector('#setting-discord-rpc');
        const projToggle = sec.querySelector('#setting-discord-proj');
        const toolToggle = sec.querySelector('#setting-discord-tool');
        const timeToggle = sec.querySelector('#setting-discord-time');
        const btnReconnect = sec.querySelector('#btn-reconnect-discord');

        const updateStatusUI = async () => {
            const dot = sec.querySelector('#discord-status-dot');
            const txt = sec.querySelector('#discord-status-text');
            if (!dot || !txt) return;

            if (!window.desktopAPI?.getDiscordStatus) {
                dot.className = 'discord-status-dot disconnected';
                bindText(txt, 'Работает в браузере, системная интеграция недоступна');
                return;
            }

            try {
                const status = await window.desktopAPI.getDiscordStatus();
                if (status.isReady || status.ready) {
                    dot.className = 'discord-status-dot connected';
                    bindText(txt, "Подключено к Discord: {0}", {0: status.user?.username || 'Авторизован'});
                } else if (status.connected) {
                    dot.className = 'discord-status-dot connecting';
                    bindText(txt, 'Подключение к Discord IPC...');
                } else if (!status.enabled) {
                    dot.className = 'discord-status-dot disconnected';
                    bindText(txt, 'Интеграция отключена в настройках');
                } else {
                    dot.className = 'discord-status-dot disconnected';
                    bindText(txt, 'Discord не запущен или канал IPC закрыт');
                }
            } catch (_) {
                dot.className = 'discord-status-dot disconnected';
                bindText(txt, 'Ошибка проверки Discord RPC');
            }
        };

        updateStatusUI();
        this.discordPollTimer = setInterval(updateStatusUI, 3500);

        btnReconnect?.addEventListener('click', async () => {
            const txt = sec.querySelector('#discord-status-text');
            if (txt) bindText(txt, 'Переподключение к Discord...');
            try {
                await window.desktopAPI?.reconnectDiscord?.();
                setTimeout(updateStatusUI, 600);
            } catch (_) {}
        });

        rpcToggle?.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            this.settings.set('discordRPC', enabled);
            if (projToggle) projToggle.disabled = !enabled;
            if (toolToggle) toolToggle.disabled = !enabled;
            if (timeToggle) timeToggle.disabled = !enabled;
            if (window.desktopAPI?.setDiscordEnabled) {
                window.desktopAPI.setDiscordEnabled(enabled);
            }
            setTimeout(updateStatusUI, 400);
        });

        projToggle?.addEventListener('change', (e) => {
            this.settings.set('discordShowProject', e.target.checked);
        });

        toolToggle?.addEventListener('change', (e) => {
            this.settings.set('discordShowTool', e.target.checked);
        });

        timeToggle?.addEventListener('change', (e) => {
            this.settings.set('discordShowTime', e.target.checked);
        });
    }

    // =========================================================================
    // Tab 6: Data & Backup (Данные и сброс)
    // =========================================================================
    renderBackupTab(container) {
        const sec = document.createElement('div');
        sec.className = 'settings-section';

        sec.innerHTML = `
            <div class="settings-group">
                <div class="settings-group-title"><!--i18n-->Резервное копирование параметров</div>
                <div class="settings-group-desc"><!--i18n-->Сохранение ваших персональных настроек в файл или перенос на другое устройство</div>

                <div style="display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap;">
                    <button id="btn-export-settings-json" class="md-btn m3-bubble-action" type="button" style="display: flex; align-items: center; gap: 6px;">
                        <i class="material-symbols-rounded">file_download</i><!--i18n--> Экспорт настроек JSON
                    </button>
                    <label class="md-btn m3-bubble-action" style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer;">
                        <i class="material-symbols-rounded">file_upload</i><!--i18n--> Импорт настроек JSON
                        <input type="file" id="btn-import-settings-file" accept=".json" style="display: none;">
                    </label>
                </div>
            </div>

            <div class="settings-divider"></div>

            <div class="settings-group">
                <div class="settings-group-title"><!--i18n-->Очистка данных и кэша</div>
                <div class="settings-group-desc"><!--i18n-->Очистка истории недавних файлов в меню или полный сброс параметров</div>

                <div style="display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap;">
                    <button id="btn-clear-recent-projects" class="md-btn m3-bubble-action" type="button" style="display: flex; align-items: center; gap: 6px;">
                        <i class="material-symbols-rounded">delete_sweep</i><!--i18n--> Очистить недавние проекты
                    </button>
                    <button id="btn-reset-settings" class="md-btn danger m3-bubble-action" type="button" style="display: flex; align-items: center; gap: 6px; margin-left: auto;">
                        <i class="material-symbols-rounded">restart_alt</i><!--i18n--> Сбросить все настройки
                    </button>
                </div>
            </div>
        `;

        container.appendChild(sec);

        sec.querySelector('#btn-export-settings-json')?.addEventListener('click', () => {
            const json = this.settings.exportSettingsJSON();
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'molly_settings.json';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            this.showToast('Файл настроек molly_settings.json экспортирован');
        });

        sec.querySelector('#btn-import-settings-file')?.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 1024 * 1024) { this.showToast('Файл настроек превышает 1 МБ'); return; }
            const reader = new FileReader();
            reader.onerror = () => this.showToast('Не удалось прочитать файл настроек');
            reader.onload = () => {
                const success = this.settings.importSettingsJSON(reader.result);
                if (success) {
                    this.showToast('Настройки успешно импортированы!');
                    this.switchTab('appearance');
                } else {
                    this.showToast('Ошибка импорта: неверный формат JSON');
                }
            };
            reader.readAsText(file);
        });

        sec.querySelector('#btn-clear-recent-projects')?.addEventListener('click', () => {
            try {
                localStorage.removeItem('molly_recent');
                localStorage.removeItem('molly_recent_projects');
                localStorage.removeItem('molly_recent_projects_cache');
                this.showToast('Список недавних проектов очищен');
            } catch (_) {}
        });

        sec.querySelector('#btn-reset-settings')?.addEventListener('click', async () => {
            if (await confirmDialog({
                title: 'Сбросить настройки?',
                message: 'Все параметры MollyStudio вернутся к исходным значениям.',
                confirmLabel: 'Сбросить',
                danger: true
            })) {
                this.settings.resetToDefaults();
                this.showToast('Все настройки сброшены к значениям по умолчанию');
                this.switchTab('appearance');
            }
        });
    }

    // =========================================================================
    // Tab 7: Hotkeys (Горячие клавиши)
    // =========================================================================
    renderHotkeysTab(container) {
        renderShortcutSettings(container, this.settings);
    }

    showToast(text) {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = 'md-toast';
        toast.innerHTML = `<i class="material-symbols-rounded toast-icon">info</i><span>${labelHTML(text)}</span>`;
        container.appendChild(toast);

        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 250);
        }, 3200);
    }
}
