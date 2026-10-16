import { smallCaps, formatGradient, gradientCharacters, graphemes } from '../utils/MinecraftUtilities.mjs';

const TABS = [['smallcaps', 'Капитель', 'text_fields'], ['gradient', 'Градиент', 'gradient']];
const field = (id, name, control) => `<label class="utility-field" for="utility-${id}"><span>${name}</span>${control}</label>`;
const area = (id, value = '') => `<textarea class="md-input" id="utility-${id}" maxlength="4096" rows="3" spellcheck="false">${value}</textarea>`;
const select = (id, options) => `<select class="md-select" id="utility-${id}">${options.map(([value, name]) => `<option value="${value}">${name}</option>`).join('')}</select>`;
const check = (id, name) => `<label class="utility-check"><input id="utility-${id}" type="checkbox"> ${name}</label>`;
const button = (action, label, icon = '') => `<button type="button" class="md-btn flat" data-utility-action="${action}">${icon ? `<i class="material-symbols-rounded" aria-hidden="true">${icon}</i>` : ''}${label}</button>`;

export default class UtilitiesPanel {
    constructor() {
        this.tab = 'smallcaps';
        this.colors = ['#55CCFF', '#AA66FF'];
        this.persistTimer = null;
    }

    open(tab = this.tab) {
        if (!this.dialog) this.create();
        this.setTab(TABS.some(([id]) => id === tab) ? tab : 'smallcaps');
        if (!this.dialog.open) this.dialog.showModal();
        this.dialog.querySelector(`[data-utility-tab="${this.tab}"]`).focus();
    }

    create() {
        this.dialog = document.createElement('dialog');
        this.dialog.id = 'utilities-dialog';
        this.dialog.className = 'utility-dialog';
        this.dialog.setAttribute('role', 'dialog');
        this.dialog.setAttribute('aria-modal', 'true');
        this.dialog.setAttribute('aria-labelledby', 'utilities-heading');
        this.dialog.innerHTML = `
            <header class="utility-header"><div><h2 id="utilities-heading">Утилиты Minecraft</h2><p>Капитель и градиентный текст</p></div>${button('close', 'Закрыть', 'close')}</header>
            <div class="utility-tabs" role="tablist" aria-label="Утилиты">${TABS.map(([id, name, icon]) => `<button type="button" class="md-btn flat" id="utility-tab-${id}" role="tab" aria-controls="utility-panel-${id}" aria-selected="false" tabindex="-1" data-utility-tab="${id}"><i class="material-symbols-rounded" aria-hidden="true">${icon}</i>${name}</button>`).join('')}</div>
            <div class="utility-body"><div class="utility-controls">
            <section id="utility-panel-smallcaps" role="tabpanel" aria-labelledby="utility-tab-smallcaps">
                ${field('small-text', 'Исходный текст', area('small-text', 'Привет! Welcome to the server'))}
                ${field('language','Алфавит',select('language',[['all','Русский и English'],['ru','Русский'],['en','English']]))}
                <div class="utility-options">${check('reverse', 'Обратное преобразование')}${check('transliterate', 'Транслитерация русского текста')}</div>
                <p class="utility-hint">Русские буквы преобразуются в капитель и строчные аналоги: А → ᴀ, В → ʙ, Е → ᴇ, Ф → ɸ. Для точного обратного преобразования выберите нужный алфавит.</p>
            </section>
            <section id="utility-panel-gradient" role="tabpanel" aria-labelledby="utility-tab-gradient" hidden>
                ${field('gradient-text', 'Текст градиента', area('gradient-text', 'Добро пожаловать!'))}
                <div class="utility-options">${check('gradient-smallcaps', 'Капитель (русский и English)')}${field('format', 'Формат результата', select('format', [['minimessage', 'MiniMessage'], ['hex', '&#RRGGBB'], ['section', '§x§R§R§G§G§B§B'], ['ampersand', '&x&R&R&G&G&B&B'], ['json', 'JSON компонент']]))}</div>
                <p class="utility-hint">MiniMessage и HEX требуют поддержки плагина. JSON — текстовый компонент Java Edition. В HEX форматирующие коды внутри исходного текста интерпретируются плагином.</p>
            </section>
            <section id="utility-color-settings" hidden>
                <h3>Цвета и оформление</h3><div id="utility-colors" class="utility-colors"></div>
                <div class="utility-options">${button('add-color', 'Добавить цвет', 'add')}${button('reverse-colors', 'Развернуть', 'swap_horiz')}</div>
                <div class="utility-options">${check('bold', 'Жирный')}${check('italic', 'Курсив')}${check('underlined', 'Подчёркнутый')}${check('strikethrough', 'Зачёркнутый')}${check('skip-spaces', 'Пропускать пробелы')}</div>
            </section>
            </div><div class="utility-output-panel">            <section id="utility-preview-section" hidden><div class="utility-preview-heading"><h3>Предпросмотр</h3>${field('preview-background', 'Фон', select('preview-background', [['dark', 'Тёмный'], ['light', 'Светлый'], ['theme', 'Как в приложении']]))}</div><div id="utility-preview" class="utility-preview" data-background="dark" aria-label="Предпросмотр градиентного текста"></div></section>
            <section class="utility-result"><div class="utility-result-heading"><h3>Результат</h3><span id="utility-count" class="utility-hint"></span></div><textarea id="utility-output" class="md-input" rows="4" readonly spellcheck="false" aria-label="Результат генерации"></textarea></section>
            </div></div>
            <footer class="utility-footer"><span id="utility-status" role="status" aria-live="polite"></span>${button('copy', 'Копировать', 'content_copy')}</footer>`;
        document.body.append(this.dialog);
        this.dialog.querySelector('[data-utility-action="copy"]').className = 'md-btn primary';
        this.restore();
        this.renderColors();
        this.dialog.addEventListener('click', event => this.onClick(event));
        this.dialog.addEventListener('input', event => {
            if (event.target.dataset.colorIndex !== undefined) {
                const index = Number(event.target.dataset.colorIndex);
                if (!/^#[0-9a-f]{6}$/i.test(event.target.value)) {
                    event.target.setAttribute('aria-invalid', 'true');
                    this.get('status').textContent = 'Цвет должен иметь вид #RRGGBB. Исправьте HEX перед копированием.';
                    this.dialog.querySelector('[data-utility-action="copy"]').disabled = true;
                    return;
                }
                event.target.removeAttribute('aria-invalid');
                this.colors[index] = event.target.value.toUpperCase();
                this.dialog.querySelectorAll(`[data-color-index="${index}"]`).forEach(control => { if (control !== event.target) control.value = event.target.value; });
            }
            this.update(); this.persist();
        });
        this.dialog.addEventListener('keydown', event => {
            const activeTab = event.target.closest('[data-utility-tab]');
            if (activeTab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const tabs = [...this.dialog.querySelectorAll('[data-utility-tab]')];
                const current = tabs.indexOf(activeTab);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
                    : (current + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
                this.setTab(tabs[next].dataset.utilityTab);
                tabs[next].focus();
                event.stopPropagation();
                return;
            }
            // Keep editor shortcuts away from a focused utility, but preserve native editing and dialog Escape.
            if (event.key !== 'Tab') event.stopPropagation();
        });
        this.dialog.addEventListener('close', () => this.persist());
    }

    get(id) { return this.dialog.querySelector(`#utility-${id}`); }
    value(id) { return this.get(id).value; }
    checked(id) { return this.get(id).checked; }
    styles() { return { bold: this.checked('bold'), italic: this.checked('italic'), underlined: this.checked('underlined'), strikethrough: this.checked('strikethrough'), skipSpaces: this.checked('skip-spaces') }; }

    setTab(tab) {
        this.tab = tab;
        for (const [id] of TABS) {
            this.get(`panel-${id}`).hidden = id !== tab;
            this.dialog.querySelector(`[data-utility-tab="${id}"]`).setAttribute('aria-selected', String(id === tab));
            this.dialog.querySelector(`[data-utility-tab="${id}"]`).tabIndex = id === tab ? 0 : -1;
        }
        this.get('color-settings').hidden = tab !== 'gradient';
        this.get('preview-section').hidden = tab !== 'gradient';
        this.dialog.dataset.utilityMode = tab;
        this.update();
    }

    renderColors() {
        const container = this.get('colors'); container.replaceChildren();
        this.colors.forEach((color, index) => {
            const row = document.createElement('div'); row.className = 'utility-color';
            const swatch = document.createElement('input'); swatch.type = 'color'; swatch.value = color; swatch.dataset.colorIndex = index; swatch.setAttribute('aria-label', `Цвет ${index + 1}`);
            const hex = document.createElement('input'); hex.className = 'md-input'; hex.value = color; hex.maxLength = 7; hex.dataset.colorIndex = index; hex.setAttribute('aria-label', `HEX цвета ${index + 1}`);
            const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'md-icon-btn'; remove.innerHTML = '<i class="material-symbols-rounded" aria-hidden="true">close</i>'; remove.dataset.removeColor = index; remove.disabled = this.colors.length <= 1; remove.setAttribute('aria-label', `Удалить цвет ${index + 1}`);
            row.append(swatch, hex, remove); container.append(row);
        });
        this.dialog.querySelector('[data-utility-action="add-color"]').disabled = this.colors.length >= 8;
    }

    onClick(event) {
        const tab = event.target.closest('[data-utility-tab]');
        if (tab) { this.setTab(tab.dataset.utilityTab); return; }
        const remove = event.target.closest('[data-remove-color]');
        if (remove && this.colors.length > 1) {
            this.colors.splice(Number(remove.dataset.removeColor), 1); this.renderColors(); this.get('colors').querySelector('input')?.focus(); this.update(); this.persist(); return;
        }
        const action = event.target.closest('[data-utility-action]')?.dataset.utilityAction;
        switch (action) {
            case 'close': this.dialog.close(); return;
            case 'copy': void this.copy(); return;
            case 'add-color': if (this.colors.length < 8) this.colors.push('#FFFFFF'); this.renderColors(); break;
            case 'reverse-colors': this.colors.reverse(); this.renderColors(); break;
            default: return;
        }
        this.update(); this.persist();
    }

    update() {
        const options = this.styles();
        this.get('status').textContent = '';
        let output = '', count = '';
        this.get('transliterate').disabled = this.checked('reverse');
        try {
            if (this.tab === 'smallcaps') {
                output = smallCaps(this.value('small-text'), { reverse: this.checked('reverse'), transliterate: this.checked('transliterate'), language: this.value('language') });
                count = `${graphemes(output).length} символов`;
            } else if (this.tab === 'gradient') {
                const text = this.checked('gradient-smallcaps') ? smallCaps(this.value('gradient-text')) : this.value('gradient-text');
                output = formatGradient(text, this.colors, this.value('format'), options); count = `${graphemes(text).length} символов`;
                this.paintGradient(text, options);
            }
        } catch (error) { this.get('status').textContent = error.message; }
        this.get('output').value = output; this.get('count').textContent = count;
        const invalidColor = this.tab === 'gradient' && this.get('colors').querySelector('[aria-invalid="true"]');
        if(invalidColor)this.get('status').textContent = 'Исправьте HEX цвета перед копированием.';
        this.dialog.querySelector('[data-utility-action="copy"]').disabled = !output || Boolean(invalidColor);
    }

    paintGradient(text, options) {
        const preview = this.get('preview');
        preview.dataset.background = this.value('preview-background');
        preview.style.fontWeight = options.bold ? '700' : '400';
        preview.style.fontStyle = options.italic ? 'italic' : 'normal';
        preview.style.textDecoration = [options.underlined && 'underline', options.strikethrough && 'line-through'].filter(Boolean).join(' ') || 'none';
        const fragment = document.createDocumentFragment();
        for (const char of gradientCharacters(text, this.colors, options)) {
            const span = document.createElement('span');
            span.textContent = char.text;
            if (char.color) span.style.color = char.color;
            fragment.append(span);
        }
        preview.replaceChildren(fragment);
    }

    async copy() {
        if (this.dialog.querySelector('[data-utility-action="copy"]').disabled) return;
        const text = this.get('output').value;
        try { await navigator.clipboard.writeText(text); this.get('status').textContent = 'Скопировано'; }
        catch { this.get('output').focus(); this.get('output').select(); this.get('status').textContent = 'Нажмите Ctrl+C, чтобы скопировать выделенный результат.'; }
    }

    persist() {
        clearTimeout(this.persistTimer);
        this.persistTimer = setTimeout(() => {
            const fields = [...this.dialog.querySelectorAll('input[id],select[id],textarea[id]:not([readonly])')].map(control => [control.id, control.type === 'checkbox' ? control.checked : control.value]);
            try { sessionStorage.setItem('molly-utilities-v1', JSON.stringify({ colors: this.colors, fields })); } catch { /* Session storage may be disabled. */ }
        }, 200);
    }

    restore() {
        try {
            const raw = sessionStorage.getItem('molly-utilities-v1'); if (!raw || raw.length > 100000) return;
            const saved = JSON.parse(raw);
            if (Array.isArray(saved.colors) && saved.colors.length >= 1 && saved.colors.length <= 8 && saved.colors.every(color => /^#[0-9a-f]{6}$/i.test(color))) this.colors = saved.colors;
            for (const [id, value] of saved.fields || []) {
                const control = document.getElementById(id); if (!control || !this.dialog.contains(control) || control.readOnly) continue;
                if (control.type === 'checkbox') control.checked = value === true;
                else if (typeof value === 'string') { const old = control.value; control.value = value.slice(0, 4096); if (!control.checkValidity() || (control.tagName === 'SELECT' && !control.value)) control.value = old; }
            }
        } catch { /* Ignore damaged session data. */ }
    }
}
