/**
 * SettingsModal - shared settings renderer with the 1.2.5 appearance.
 * Organizes application settings cleanly into 7 dedicated tabs:
 * 1. Appearance (10 Themes, 16 Accent Colors, Typography, Density & Animations)
 * 2. Canvas & Grid (Pixel Grid, Opacity, Zoom threshold, Checkerboard, Wheel navigation)
 * 3. Tools & Drawing (Smart Magnetic Guides, Pixel-Perfect Pencil, Aspect lock, Pipette, Undo Depth)
 * 4. Export & Autosave (Upscale scale, Trim transparency, Autosave interval, Close confirmation)
 * 5. Discord RPC (Real-time Live connection status, custom client ID, toggles, reconnect button)
 * 6. Data & Backup (Export JSON, Import JSON, Clear recent projects, Factory reset)
 * 7. Hotkeys (Searchable hotkeys cheatsheet with category filtering)
 */
import { confirmDialog } from './ConfirmDialog.js';

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
            { id: 'light-mint', name: 'Emerald Mint', type: 'light', prevClass: 'theme-light-mint-prev', icon: 'eco' }
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
        window.addEventListener('keydown', (e) => {
            if (e.defaultPrevented) return;
            if ((e.ctrlKey || e.metaKey) && (e.code === 'Comma' || e.key === ',' || e.key === 'б' || e.key === 'Б')) {
                e.preventDefault();
                if (window.electronAPI?.openSettingsWindow) window.electronAPI.openSettingsWindow();
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
                            <div class="settings-modal-title" id="settings-modal-title">Параметры программы</div>
                            <div class="settings-modal-subtitle">Оформление, холст, инструменты и сохранение</div>
                        </div>
                    </div>
                    <button class="md-icon-btn btn-close-settings m3-bubble-action" title="Закрыть" aria-label="Закрыть настройки" type="button"><i class="material-symbols-rounded">close</i></button>
                </div>

                <div class="settings-modal-layout">
                    <!-- Tabs Sidebar -->
                    <aside class="settings-tabs-sidebar" role="tablist" aria-label="Разделы настроек" aria-orientation="vertical">
                        <button class="settings-tab-btn active m3-bubble-action" id="settings-modal-tab-appearance" data-tab="appearance" role="tab" aria-controls="settings-content-area" aria-selected="true" type="button">
                            <i class="material-symbols-rounded">palette</i>
                            <span>Внешний вид</span>
                        </button>
                        <button class="settings-tab-btn m3-bubble-action" id="settings-modal-tab-canvas" data-tab="canvas" role="tab" aria-controls="settings-content-area" aria-selected="false" type="button">
                            <i class="material-symbols-rounded">grid_view</i>
                            <span>Холст и сетка</span>
                        </button>
                        <button class="settings-tab-btn m3-bubble-action" id="settings-modal-tab-tools" data-tab="tools" role="tab" aria-controls="settings-content-area" aria-selected="false" type="button">
                            <i class="material-symbols-rounded">tune</i>
                            <span>Инструменты</span>
                        </button>
                        <button class="settings-tab-btn m3-bubble-action" id="settings-modal-tab-export" data-tab="export" role="tab" aria-controls="settings-content-area" aria-selected="false" type="button">
                            <i class="material-symbols-rounded">download</i>
                            <span>Экспорт и авто</span>
                        </button>
                        <button class="settings-tab-btn m3-bubble-action" id="settings-modal-tab-discord" data-tab="discord" role="tab" aria-controls="settings-content-area" aria-selected="false" type="button">
                            <i class="material-symbols-rounded">sports_esports</i>
                            <span>Discord RPC</span>
                        </button>
                        <button class="settings-tab-btn m3-bubble-action" id="settings-modal-tab-backup" data-tab="backup" role="tab" aria-controls="settings-content-area" aria-selected="false" type="button">
                            <i class="material-symbols-rounded">database</i>
                            <span>Данные и сброс</span>
                        </button>
                        <button class="settings-tab-btn m3-bubble-action" id="settings-modal-tab-hotkeys" data-tab="hotkeys" role="tab" aria-controls="settings-content-area" aria-selected="false" type="button">
                            <i class="material-symbols-rounded">keyboard</i>
                            <span>Горячие клавиши</span>
                        </button>
                    </aside>

                    <!-- Content Body -->
                    <section class="settings-content-body" id="settings-content-area" role="tabpanel" aria-labelledby="settings-modal-tab-appearance" tabindex="0"></section>
                </div>

                <div class="modal-footer">
                    <button class="md-btn flat btn-close-settings m3-bubble-action" type="button">Закрыть</button>
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

        if (this.discordPollTimer && tabId !== 'discord') {
            clearInterval(this.discordPollTimer);
            this.discordPollTimer = null;
        }

        this.modalEl.querySelectorAll('.settings-tab-btn').forEach(btn => {
            const isActive = btn.dataset.tab === tabId;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });

        const contentArea = this.modalEl.querySelector('#settings-content-area');
        if (!contentArea) return;
        contentArea.setAttribute('aria-labelledby', `settings-modal-tab-${tabId}`);

        contentArea.innerHTML = '';
        switch (tabId) {
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
        }
    }

    // =========================================================================
    // Tab 1: Appearance (Внешний вид)
    // =========================================================================
    renderAppearanceTab(container) {
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
            <button type="button" class="settings-theme-card m3-bubble-action ${currentTheme === t.id ? 'active' : ''}" data-theme="${t.id}" title="${t.name}" aria-pressed="${currentTheme === t.id}" aria-label="Тема ${t.name}, ${t.type === 'light' ? 'светлая' : 'тёмная'}">
                <div class="theme-card-preview ${t.prevClass}"></div>
                <div class="theme-card-title">
                    <i class="material-symbols-rounded">${t.icon}</i>
                    <span>${t.name}</span>
                </div>
                <span class="theme-badge ${t.type}">${t.type === 'light' ? 'Светлая' : 'Тёмная'}</span>
            </button>
        `).join('');

        sec.innerHTML = `
            <div class="settings-group">
                <div class="settings-group-title">Тема оформления</div>
                <div class="settings-group-desc">Коллекция сбалансированных тёмных и светлых тем с автоматической калибровкой контраста</div>
                
                <div class="settings-theme-cards">
                    ${themeCardsHtml}
                </div>
            </div>

            <div class="settings-divider"></div>

            <div class="settings-group">
                <div class="settings-group-title">Акцентный цвет</div>
                <div class="settings-group-desc">Основной цвет кнопок, переключателей, выделений и индикаторов интерфейса</div>

                <div class="settings-accent-grid" id="settings-accent-presets" role="group" aria-label="Предустановленные акцентные цвета"></div>

                <div class="settings-custom-accent-row">
                    <label class="custom-accent-label" for="settings-custom-color-input">Пользовательский цвет HEX:</label>
                    <input type="color" id="settings-custom-color-picker" value="${pickerAccent}" class="md-color-chip" title="Палитра цвета" aria-label="Выбрать пользовательский акцентный цвет">
                    <input type="text" id="settings-custom-color-input" value="${currentAccent === 'auto' ? '' : currentAccent}" placeholder="#4285F4" class="md-input md-custom-color-text" maxlength="7" pattern="#[0-9A-Fa-f]{6}" aria-describedby="settings-custom-color-hint">
                    <span id="settings-custom-color-hint" class="md-sr-only">Введите цвет в формате HEX, например #4285F4</span>
                </div>
            </div>

            <div class="settings-divider"></div>

            <div class="settings-group">
                <div class="settings-group-title">Типографика интерфейса</div>
                <div class="settings-group-desc">Интерфейс и заголовки используют Google Sans.</div>
            </div>

            <div class="settings-divider"></div>

            <div class="settings-group">
                <div class="settings-group-title">Плотность интерфейса и анимации</div>
                <div class="settings-group-desc">Масштаб элементов управления и эффекты нажатия</div>

                <div class="settings-row-wrap">
                    <div class="settings-col">
                        <label for="setting-ui-scale-select" class="settings-col-label">Плотность элементов:</label>
                        <select id="setting-ui-scale-select" class="md-select">
                            <option value="90%" ${currentScale === '90%' ? 'selected' : ''}>Компактный 90%</option>
                            <option value="100%" ${currentScale === '100%' ? 'selected' : ''}>Стандартный 100%</option>
                            <option value="110%" ${currentScale === '110%' ? 'selected' : ''}>Крупный 110%</option>
                        </select>
                    </div>

                    <div class="settings-col" style="justify-content: flex-end;">
                        <label class="md-switch">
                            <input type="checkbox" id="setting-animations-toggle" ${currentAnim ? 'checked' : ''}>
                            <span class="md-switch-track"><span class="md-switch-thumb"></span></span>
                            <span class="md-switch-label">Плавные анимации</span>
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
                this.settings.set('theme', theme);

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

        sec.querySelector('#setting-animations-toggle')?.addEventListener('change', (e) => {
            this.settings.set('animationsEnabled', e.target.checked);
        });

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
        autoSwatch.title = 'Оригинальный цвет выбранной темы';
        autoSwatch.setAttribute('aria-label', 'Автоматический цвет выбранной темы');
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
    }

    // =========================================================================
    // Tab 2: Canvas & Grid (Холст и сетка)
    // =========================================================================
    renderCanvasTab(container) {
        const showGrid = this.settings.get('showPixelGrid');
        const gridOp = this.settings.get('gridOpacity') || 20;
        const gridColor = this.settings.get('gridColor') || 'white';
        const gridMinZoom = this.settings.get('gridMinZoom') ?? 3;
        const wheelMode = this.settings.get('wheelBehavior') || 'zoom';
        const invertZoom = this.settings.get('invertZoom') || false;
        const currentChecker = this.settings.get('checkerStyle') || 'dark';

        const sec = document.createElement('div');
        sec.className = 'settings-section';

        sec.innerHTML = `
            <div class="settings-group">
                <div class="settings-group-title">Пиксельная сетка</div>
                <div class="settings-group-desc">Высокоточная привязка линий к отдельным пикселям холста</div>
                
                <div style="margin-top: 10px;">
                    <label class="md-switch">
                        <input type="checkbox" id="setting-grid-toggle" ${showGrid ? 'checked' : ''}>
                        <span class="md-switch-track"><span class="md-switch-thumb"></span></span>
                        <span class="md-switch-label">Показывать пиксельную сетку</span>
                    </label>
                </div>

                <div class="settings-row" style="margin-top: 14px;">
                    <span class="settings-row-label">Прозрачность сетки:</span>
                    <div class="settings-slider-wrap">
                        <input type="range" id="setting-grid-opacity" class="md-slider" min="5" max="80" value="${gridOp}">
                        <span id="setting-grid-opacity-val" class="settings-val-badge">${gridOp}%</span>
                    </div>
                </div>

                <div class="settings-row-wrap" style="margin-top: 12px;">
                    <div class="settings-col">
                        <label for="setting-grid-color-select" class="settings-col-label">Цвет линий сетки:</label>
                        <select id="setting-grid-color-select" class="md-select">
                            <option value="white" ${gridColor === 'white' ? 'selected' : ''}>Белый</option>
                            <option value="black" ${gridColor === 'black' ? 'selected' : ''}>Чёрный</option>
                            <option value="accent" ${gridColor === 'accent' ? 'selected' : ''}>В тон акцентного цвета</option>
                        </select>
                    </div>

                    <div class="settings-col">
                        <label for="setting-grid-minzoom-select" class="settings-col-label">Порог масштаба для отображения:</label>
                        <select id="setting-grid-minzoom-select" class="md-select">
                            <option value="1.5" ${gridMinZoom == 1.5 ? 'selected' : ''}>От 1.5x</option>
                            <option value="2" ${gridMinZoom == 2 ? 'selected' : ''}>От 2x</option>
                            <option value="3" ${gridMinZoom == 3 ? 'selected' : ''}>От 3x</option>
                            <option value="4" ${gridMinZoom == 4 ? 'selected' : ''}>От 4x</option>
                            <option value="6" ${gridMinZoom == 6 ? 'selected' : ''}>От 6x</option>
                        </select>
                    </div>
                </div>
            </div>

            <div class="settings-divider"></div>

            <div class="settings-group">
                <div class="settings-group-title">Фон прозрачности</div>
                <div class="settings-group-desc">Стиль отображения прозрачных областей на холсте</div>
                
                <div style="margin-top: 10px; max-width: 320px;">
                    <select id="setting-checker-select" class="md-select">
                        <option value="dark" ${currentChecker === 'dark' ? 'selected' : ''}>Тёмная шахматка</option>
                        <option value="light" ${currentChecker === 'light' ? 'selected' : ''}>Светлая шахматка</option>
                        <option value="black" ${currentChecker === 'black' ? 'selected' : ''}>Сплошной чёрный фон</option>
                    </select>
                </div>
            </div>

            <div class="settings-divider"></div>

            <div class="settings-group">
                <div class="settings-group-title">Навигация и колёсико мыши</div>
                <div class="settings-group-desc">Поведение прокрутки при работе на холсте</div>

                <div class="settings-row-wrap" style="margin-top: 10px;">
                    <div class="settings-col">
                        <label for="setting-wheel-behavior" class="settings-col-label">Действие колёсика мыши:</label>
                        <select id="setting-wheel-behavior" class="md-select">
                            <option value="zoom" ${wheelMode === 'zoom' ? 'selected' : ''}>Масштабирование холста</option>
                            <option value="pan-v" ${wheelMode === 'pan-v' ? 'selected' : ''}>Вертикальная прокрутка</option>
                            <option value="pan-h" ${wheelMode === 'pan-h' ? 'selected' : ''}>Горизонтальная прокрутка</option>
                        </select>
                    </div>

                    <div class="settings-col" style="justify-content: flex-end;">
                        <label class="md-switch">
                            <input type="checkbox" id="setting-invert-zoom" ${invertZoom ? 'checked' : ''}>
                            <span class="md-switch-track"><span class="md-switch-thumb"></span></span>
                            <span class="md-switch-label">Инвертировать направление зума</span>
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
                <div class="settings-group-title">Автоматическое намагничивание</div>
                <div class="settings-group-desc">Интеллектуальное примагничивание слоёв и выделений к центру холста и границам</div>
                
                <div style="margin-top: 10px;">
                    <label class="md-switch">
                        <input type="checkbox" id="setting-snap-toggle" ${snap ? 'checked' : ''}>
                        <span class="md-switch-track"><span class="md-switch-thumb"></span></span>
                        <span class="md-switch-label">Включить авто-намагничивание</span>
                    </label>
                </div>
                
                <div class="settings-row" style="margin-top: 14px;">
                    <span class="settings-row-label">Радиус притяжения магнита:</span>
                    <div class="settings-slider-wrap">
                        <input type="range" id="setting-snap-thresh" class="md-slider" min="2" max="15" value="${snapThresh}">
                        <span id="setting-snap-thresh-val" class="settings-val-badge">${snapThresh}px</span>
                    </div>
                </div>
            </div>

            <div class="settings-divider"></div>

            <div class="settings-group">
                <div class="settings-group-title">Поведение инструментов рисования</div>
                <div class="settings-group-desc">Специальные режимы создания пиксель-арта и текстур</div>
                
                <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 10px;">
                    <label class="md-switch">
                        <input type="checkbox" id="setting-pixel-perf" ${pixelPerf ? 'checked' : ''}>
                        <span class="md-switch-track"><span class="md-switch-thumb"></span></span>
                        <span class="md-switch-label">Pixel-Perfect для карандаша по умолчанию</span>
                    </label>

                    <label class="md-switch">
                        <input type="checkbox" id="setting-lock-aspect" ${lockAspect ? 'checked' : ''}>
                        <span class="md-switch-track"><span class="md-switch-thumb"></span></span>
                        <span class="md-switch-label">Сохранять пропорции при масштабировании</span>
                    </label>
                </div>

                <div class="settings-row-wrap" style="margin-top: 12px;">
                    <div class="settings-col">
                        <label for="setting-pipette-sample" class="settings-col-label">Область захвата пипетки:</label>
                        <select id="setting-pipette-sample" class="md-select">
                            <option value="1x1" ${pipetteSample === '1x1' ? 'selected' : ''}>1×1 пиксель</option>
                            <option value="3x3" ${pipetteSample === '3x3' ? 'selected' : ''}>3×3 пикселя</option>
                            <option value="5x5" ${pipetteSample === '5x5' ? 'selected' : ''}>5×5 пикселей</option>
                        </select>
                    </div>
                </div>
            </div>

            <div class="settings-divider"></div>

            <div class="settings-group">
                <div class="settings-group-title">Глубина истории отмены</div>
                <div class="settings-group-desc">Максимальное количество сохраненных шагов истории действий</div>
                
                <div class="settings-row" style="margin-top: 12px;">
                    <span class="settings-row-label">Лимит шагов от 10 до 200:</span>
                    <input type="number" id="setting-undo-limit" class="md-number-input" min="10" max="200" value="${undoLim}" style="width: 80px;">
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
            val = Math.max(10, Math.min(200, isNaN(val) ? 50 : val));
            this.settings.set('undoLimit', val);
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
                <div class="settings-group-title">Параметры экспорта в PNG</div>
                <div class="settings-group-desc">Масштабирование и обработка текстур при экспорте</div>

                <div class="settings-row-wrap" style="margin-top: 10px;">
                    <div class="settings-col">
                        <label for="setting-export-scale" class="settings-col-label">Масштаб экспортируемого файла:</label>
                        <select id="setting-export-scale" class="md-select">
                            <option value="1" ${exportScale == 1 ? 'selected' : ''}>1x Оригинал</option>
                            <option value="2" ${exportScale == 2 ? 'selected' : ''}>2x Увеличение</option>
                            <option value="4" ${exportScale == 4 ? 'selected' : ''}>4x Увеличение</option>
                            <option value="8" ${exportScale == 8 ? 'selected' : ''}>8x Увеличение</option>
                            <option value="16" ${exportScale == 16 ? 'selected' : ''}>16x Увеличение</option>
                        </select>
                    </div>

                    <div class="settings-col" style="justify-content: flex-end;">
                        <label class="md-switch">
                            <input type="checkbox" id="setting-export-trim" ${exportTrim ? 'checked' : ''}>
                            <span class="md-switch-track"><span class="md-switch-thumb"></span></span>
                            <span class="md-switch-label">Обрезать прозрачные границы при экспорте</span>
                        </label>
                    </div>
                </div>
            </div>

            <div class="settings-divider"></div>

            <div class="settings-group">
                <div class="settings-group-title">Автоматическое сохранение проектов</div>
                <div class="settings-group-desc">Периодическое фоновое сохранение для защиты от непредвиденной потери данных</div>

                <div style="margin-top: 10px; max-width: 320px;">
                    <label for="setting-autosave-interval" class="settings-col-label">Интервал автосохранения:</label>
                    <select id="setting-autosave-interval" class="md-select">
                        <option value="0" ${autosaveInt == 0 ? 'selected' : ''}>Отключено</option>
                        <option value="1" ${autosaveInt == 1 ? 'selected' : ''}>Каждую 1 минуту</option>
                        <option value="3" ${autosaveInt == 3 ? 'selected' : ''}>Каждые 3 минуты</option>
                        <option value="5" ${autosaveInt == 5 ? 'selected' : ''}>Каждые 5 минут</option>
                        <option value="10" ${autosaveInt == 10 ? 'selected' : ''}>Каждые 10 минут</option>
                    </select>
                </div>

                <div style="margin-top: 14px;">
                    <label class="md-switch">
                        <input type="checkbox" id="setting-confirm-close" ${confirmClose ? 'checked' : ''}>
                        <span class="md-switch-track"><span class="md-switch-thumb"></span></span>
                        <span class="md-switch-label">Предупреждать перед закрытием с несохранёнными изменениями</span>
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
                <div class="settings-group-desc">Трансляция вашей активности, редактируемого проекта и инструмента в Discord</div>

                <!-- Live Status Card -->
                <div class="discord-status-card" id="discord-live-card">
                    <div class="discord-status-badge">
                        <span class="discord-status-dot disconnected" id="discord-status-dot"></span>
                        <span id="discord-status-text">Проверка статуса подключения...</span>
                    </div>
                    <button class="md-btn tonal m3-bubble-action" id="btn-reconnect-discord" type="button" style="height: 28px; font-size: 11px;">
                        <i class="material-symbols-rounded" style="font-size: 16px;">refresh</i> Переподключить
                    </button>
                </div>

                <div style="margin-top: 14px;">
                    <label class="md-switch">
                        <input type="checkbox" id="setting-discord-rpc" ${discordRPC ? 'checked' : ''}>
                        <span class="md-switch-track"><span class="md-switch-thumb"></span></span>
                        <span class="md-switch-label">Включить интеграцию с Discord RPC</span>
                    </label>
                </div>

                <div style="margin-top: 12px; display: flex; flex-direction: column; gap: 10px; padding-left: 6px;">
                    <label class="md-switch">
                        <input type="checkbox" id="setting-discord-proj" ${showProj ? 'checked' : ''} ${!discordRPC ? 'disabled' : ''}>
                        <span class="md-switch-track"><span class="md-switch-thumb"></span></span>
                        <span class="md-switch-label">Показывать имя текущего проекта в статусе</span>
                    </label>

                    <label class="md-switch">
                        <input type="checkbox" id="setting-discord-tool" ${showTool ? 'checked' : ''} ${!discordRPC ? 'disabled' : ''}>
                        <span class="md-switch-track"><span class="md-switch-thumb"></span></span>
                        <span class="md-switch-label">Показывать активный инструмент рисования</span>
                    </label>

                    <label class="md-switch">
                        <input type="checkbox" id="setting-discord-time" ${showTime ? 'checked' : ''} ${!discordRPC ? 'disabled' : ''}>
                        <span class="md-switch-track"><span class="md-switch-thumb"></span></span>
                        <span class="md-switch-label">Показывать таймер времени сессии</span>
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

            if (!window.electronAPI?.getDiscordStatus) {
                dot.className = 'discord-status-dot disconnected';
                txt.textContent = 'Работает в веб-режиме, Electron недоступен';
                return;
            }

            try {
                const status = await window.electronAPI.getDiscordStatus();
                if (status.isReady || status.ready) {
                    dot.className = 'discord-status-dot connected';
                    txt.textContent = `Подключено к Discord: ${status.user?.username || 'Авторизован'}`;
                } else if (status.connected) {
                    dot.className = 'discord-status-dot connecting';
                    txt.textContent = 'Подключение к Discord IPC...';
                } else if (!status.enabled) {
                    dot.className = 'discord-status-dot disconnected';
                    txt.textContent = 'Интеграция отключена в настройках';
                } else {
                    dot.className = 'discord-status-dot disconnected';
                    txt.textContent = 'Discord не запущен или канал IPC закрыт';
                }
            } catch (_) {
                dot.className = 'discord-status-dot disconnected';
                txt.textContent = 'Ошибка проверки Discord RPC';
            }
        };

        updateStatusUI();
        this.discordPollTimer = setInterval(updateStatusUI, 3500);

        btnReconnect?.addEventListener('click', async () => {
            const txt = sec.querySelector('#discord-status-text');
            if (txt) txt.textContent = 'Переподключение к Discord...';
            try {
                await window.electronAPI?.reconnectDiscord?.();
                setTimeout(updateStatusUI, 600);
            } catch (_) {}
        });

        rpcToggle?.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            this.settings.set('discordRPC', enabled);
            if (projToggle) projToggle.disabled = !enabled;
            if (toolToggle) toolToggle.disabled = !enabled;
            if (timeToggle) timeToggle.disabled = !enabled;
            if (window.electronAPI?.setDiscordEnabled) {
                window.electronAPI.setDiscordEnabled(enabled);
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
                <div class="settings-group-title">Резервное копирование параметров</div>
                <div class="settings-group-desc">Сохранение ваших персональных настроек в файл или перенос на другое устройство</div>

                <div style="display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap;">
                    <button id="btn-export-settings-json" class="md-btn m3-bubble-action" type="button" style="display: flex; align-items: center; gap: 6px;">
                        <i class="material-symbols-rounded">file_download</i> Экспорт настроек JSON
                    </button>
                    <label class="md-btn m3-bubble-action" style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer;">
                        <i class="material-symbols-rounded">file_upload</i> Импорт настроек JSON
                        <input type="file" id="btn-import-settings-file" accept=".json" style="display: none;">
                    </label>
                </div>
            </div>

            <div class="settings-divider"></div>

            <div class="settings-group">
                <div class="settings-group-title">Очистка данных и кэша</div>
                <div class="settings-group-desc">Очистка истории недавних файлов в меню или полный сброс параметров</div>

                <div style="display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap;">
                    <button id="btn-clear-recent-projects" class="md-btn m3-bubble-action" type="button" style="display: flex; align-items: center; gap: 6px;">
                        <i class="material-symbols-rounded">delete_sweep</i> Очистить недавние проекты
                    </button>
                    <button id="btn-reset-settings" class="md-btn danger m3-bubble-action" type="button" style="display: flex; align-items: center; gap: 6px; margin-left: auto;">
                        <i class="material-symbols-rounded">restart_alt</i> Сбросить все настройки
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
        const sec = document.createElement('div');
        sec.className = 'settings-section';

        sec.innerHTML = `
            <div class="settings-group">
                <div class="settings-group-title">Горячие клавиши и комбинации</div>
                <div class="settings-group-desc">Справочник быстрых клавиш программы для максимальной скорости работы</div>

                <div class="hotkeys-header-row" style="margin-top: 10px;">
                    <div class="hotkeys-search-box" style="flex: 1;">
                        <i class="material-symbols-rounded">search</i>
                        <input type="text" id="hotkeys-search-input" class="md-input" placeholder="Поиск комбинаций..." style="width: 100%;">
                    </div>
                </div>

                <div class="hotkeys-table-container" style="margin-top: 10px;">
                    <table class="hotkeys-table">
                        <thead>
                            <tr>
                                <th style="width: 130px;">Клавиша</th>
                                <th>Действие</th>
                                <th style="width: 110px;">Категория</th>
                            </tr>
                        </thead>
                        <tbody id="hotkeys-table-body"></tbody>
                    </table>
                </div>
            </div>
        `;

        container.appendChild(sec);

        const tbody = sec.querySelector('#hotkeys-table-body');
        const searchInput = sec.querySelector('#hotkeys-search-input');

        const populate = (query = '') => {
            if (!tbody) return;
            tbody.innerHTML = '';

            const q = query.toLowerCase().trim();
            const filtered = this.hotkeysData.filter(h => 
                h.key.toLowerCase().includes(q) || 
                h.desc.toLowerCase().includes(q) || 
                h.cat.toLowerCase().includes(q)
            );

            if (filtered.length === 0) {
                tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--md-sys-color-on-surface-variant); padding: 24px;">Ничего не найдено по запросу "${query}"</td></tr>`;
                return;
            }

            filtered.forEach(item => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><kbd class="hotkey-kbd">${item.key}</kbd></td>
                    <td class="hotkey-desc">${item.desc}</td>
                    <td><span class="hotkey-cat-chip">${item.cat}</span></td>
                `;
                tbody.appendChild(tr);
            });
        };

        populate();

        searchInput?.addEventListener('input', (e) => {
            populate(e.target.value);
        });
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
        toast.innerHTML = `<i class="material-symbols-rounded toast-icon">info</i><span>${text}</span>`;
        container.appendChild(toast);

        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 250);
        }, 3200);
    }
}
