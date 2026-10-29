import {bindAttribute, bindText, labelHTML, localeValue} from '../core/Locale.mjs';

import { smallCaps, formatGradient, gradientCharacters, graphemes } from '../utils/MinecraftUtilities.mjs';
import {Palettes,PaletteOptions} from '../utils/Palettes.js';

const TABS = [['smallcaps', 'Капитель', 'text_fields'], ['gradient', 'Градиент', 'gradient']];
const field = (id, name, control) => `<label class="utility-field" for="utility-${id}"><span>${labelHTML(name)}</span>${control}</label>`;
const area = (id, value = '') => `<textarea class="md-input" id="utility-${id}" maxlength="4096" rows="3" spellcheck="false">${value}</textarea>`;
const select = (id, options) => `<select class="md-select" id="utility-${id}">${options.map(([value, name]) => `<option value="${value}">${labelHTML(name)}</option>`).join('')}</select>`;
const check = (id, name) => `<label class="utility-check"><input id="utility-${id}" type="checkbox"> ${labelHTML(name)}</label>`;
const button = (action, label, icon = '') => `<button type="button" class="md-btn flat" data-utility-action="${action}">${icon ? `<i class="material-symbols-rounded" aria-hidden="true">${icon}</i>` : ''}${labelHTML(label)}</button>`;

export default class UtilitiesPanel {
    constructor() {
        this.tab = 'smallcaps';
        this.colors = ['#55CCFF', '#AA66FF'];
        this.persistTimer = null;
    }

    open(tab = this.tab) {
        if (!this.dialog) this.create();
        if (!this.dialog.open) this.returnFocus = document.activeElement;
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
            <header class="utility-header"><div><h2 id="utilities-heading"><!--i18n-->Утилиты Minecraft</h2><p><!--i18n-->Капитель и градиентный текст</p></div>${button('close', 'Закрыть', 'close')}</header>
            <div class="utility-tabs" role="tablist" aria-label="Утилиты" data-i18n-aria-label="%D0%A3%D1%82%D0%B8%D0%BB%D0%B8%D1%82%D1%8B">${TABS.map(([id, name, icon]) => `<button type="button" class="md-btn flat" id="utility-tab-${id}" role="tab" aria-controls="utility-panel-${id}" aria-selected="false" tabindex="-1" data-utility-tab="${id}"><i class="material-symbols-rounded" aria-hidden="true">${icon}</i>${labelHTML(name)}</button>`).join('')}</div>
            <div class="utility-body"><div class="utility-controls">
            <section id="utility-panel-smallcaps" role="tabpanel" aria-labelledby="utility-tab-smallcaps">
                ${field('small-text', 'Исходный текст', area('small-text', 'Привет! Welcome to the server'))}
                ${field('language','Алфавит',select('language',[['all','Русский и English'],['ru','Русский'],['en','English']]))}
                <div class="utility-options">${check('transliterate', 'Транслитерация русского текста')}</div>
                <p class="utility-hint"><!--i18n-->Преобразование следует таблице smallcaps из проверенного генератора. Часть кириллических букв остаётся строчной; Ё и Е используют общий символ.</p>
            </section>
            <section id="utility-panel-gradient" role="tabpanel" aria-labelledby="utility-tab-gradient" hidden>
                ${field('gradient-text', 'Текст градиента', area('gradient-text', 'Добро пожаловать!'))}
                <div class="utility-options">${check('gradient-smallcaps', 'Капитель (русский и English)')}${field('format', 'Формат результата', select('format', [['minimessage', 'MiniMessage'], ['hex', '&#RRGGBB'], ['section', '§x§R§R§G§G§B§B'], ['ampersand', '&x&R&R&G&G&B&B'], ['json', 'JSON компонент']]))}</div>
                <p class="utility-hint"><!--i18n-->MiniMessage и HEX требуют поддержки плагина. JSON — текстовый компонент Java Edition. В HEX форматирующие коды внутри исходного текста интерпретируются плагином.</p>
            </section>
            <section id="utility-color-settings" hidden>
                <h3><!--i18n-->Цвета и оформление</h3><div id="utility-colors" class="utility-colors"></div>
                ${field('palette','Палитра',select('palette',PaletteOptions))}<div id="utility-palette-colors" class="color-palette-grid" role="group" aria-label="Цвета палитры" data-i18n-aria-label="%D0%A6%D0%B2%D0%B5%D1%82%D0%B0%20%D0%BF%D0%B0%D0%BB%D0%B8%D1%82%D1%80%D1%8B"></div><p class="utility-hint"><!--i18n-->Перетащите цвет на нужную точку градиента или нажмите цвет, чтобы заменить последнюю точку.</p>
                <div class="utility-options">${button('add-color', 'Добавить цвет', 'add')}${button('reverse-colors', 'Развернуть', 'swap_horiz')}</div>
                <div class="utility-options">${check('bold', 'Жирный')}${check('italic', 'Курсив')}${check('underlined', 'Подчёркнутый')}${check('strikethrough', 'Зачёркнутый')}${check('skip-spaces', 'Пропускать пробелы')}</div>
            </section>
            </div><div class="utility-output-panel">            <section id="utility-preview-section" hidden><div class="utility-preview-heading"><h3><!--i18n-->Предпросмотр</h3>${field('preview-background', 'Фон', select('preview-background', [['dark', 'Тёмный'], ['light', 'Светлый'], ['theme', 'Как в приложении']]))}</div><div id="utility-preview" class="utility-preview" data-background="dark" aria-label="Предпросмотр градиентного текста" data-i18n-aria-label="%D0%9F%D1%80%D0%B5%D0%B4%D0%BF%D1%80%D0%BE%D1%81%D0%BC%D0%BE%D1%82%D1%80%20%D0%B3%D1%80%D0%B0%D0%B4%D0%B8%D0%B5%D0%BD%D1%82%D0%BD%D0%BE%D0%B3%D0%BE%20%D1%82%D0%B5%D0%BA%D1%81%D1%82%D0%B0"></div></section>
            <section class="utility-result"><div class="utility-result-heading"><h3><!--i18n-->Результат</h3><span id="utility-count" class="utility-hint"></span></div><textarea id="utility-output" class="md-input" rows="4" readonly spellcheck="false" aria-label="Результат генерации" data-i18n-aria-label="%D0%A0%D0%B5%D0%B7%D1%83%D0%BB%D1%8C%D1%82%D0%B0%D1%82%20%D0%B3%D0%B5%D0%BD%D0%B5%D1%80%D0%B0%D1%86%D0%B8%D0%B8"></textarea></section>
            </div></div>
            <footer class="utility-footer">${check('remember', 'Запоминать между запусками')}<span id="utility-status" role="status" aria-live="polite"></span>${button('copy', 'Копировать', 'content_copy')}</footer>`;
        document.body.append(this.dialog);
        this.dialog.querySelector('[data-utility-action="copy"]').className = 'md-btn primary';
        const resultView=document.createElement('div');resultView.id='utility-output-view';resultView.className='utility-preview utility-smallcaps-result';resultView.tabIndex=0;
        resultView.setAttribute('role','textbox');resultView.setAttribute('aria-readonly','true');resultView.setAttribute('aria-multiline','true');bindAttribute(resultView,'aria-label','Результат генерации');this.get('output').after(resultView);
        resultView.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){event.preventDefault();this.selectResult();}});
        this.restore();
        this.renderColors();
        this.renderPalette();
        this.get('palette').addEventListener('change',()=>this.renderPalette());
        this.dialog.addEventListener('click', event => this.onClick(event));
        this.dialog.addEventListener('input', event => {
            if (event.target.dataset.colorIndex !== undefined) {
                const index = Number(event.target.dataset.colorIndex);
                if (!/^#[0-9a-f]{6}$/i.test(event.target.value)) {
                    event.target.setAttribute('aria-invalid', 'true');
                    bindText(this.get('status'), 'Цвет должен иметь вид #RRGGBB. Исправьте HEX перед копированием.');
                    this.dialog.querySelector('[data-utility-action="copy"]').disabled = true;
                    return;
                }
                event.target.removeAttribute('aria-invalid');
                this.colors[index] = event.target.value.toUpperCase();
                this.dialog.querySelectorAll(`[data-color-index="${index}"]`).forEach(control => { if (control !== event.target) control.value = event.target.value; });
            }
            this.update(); this.persist(event.target.id==='utility-remember');
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
        this.dialog.addEventListener('close', () => {
            this.persist(true);
            this.returnFocus?.isConnected && this.returnFocus.focus({preventScroll:true});
        });
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
            const swatch = document.createElement('input'); swatch.type = 'color'; swatch.value = color; swatch.dataset.colorIndex = index; bindAttribute(swatch, "aria-label", "Цвет {0}", {0: index + 1});
            const hex = document.createElement('input'); hex.className = 'md-input'; hex.value = color; hex.maxLength = 7; hex.dataset.colorIndex = index; bindAttribute(hex, "aria-label", "HEX цвета {0}", {0: index + 1});
            const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'md-icon-btn'; remove.innerHTML = '<i class="material-symbols-rounded" aria-hidden="true">close</i>'; remove.dataset.removeColor = index; remove.disabled = this.colors.length <= 1; bindAttribute(remove, "aria-label", "Удалить цвет {0}", {0: index + 1});
            row.append(swatch, hex, remove); container.append(row);
        });
        this.dialog.querySelector('[data-utility-action="add-color"]').disabled = this.colors.length >= 8;
    }

    renderPalette() {
        const container=this.get('palette-colors');container.replaceChildren();
        for(const color of Palettes[this.value('palette')]||Palettes.minecraft){
            const button=document.createElement('button');button.type='button';button.className='swatch-btn';button.draggable=true;
            button.style.backgroundColor=color;button.title=color;bindAttribute(button, "aria-label", "Выбрать цвет {0}", {0: color});
            button.addEventListener('click',()=>{this.colors[this.colors.length-1]=color;this.renderColors();this.update();this.persist();});
            container.append(button);
        }
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
        this.get('output').hidden=this.tab==='smallcaps';
        this.get('output-view').hidden=this.tab!=='smallcaps';
        try {
            if (this.tab === 'smallcaps') {
                const language=this.value('language'),transliterate=this.checked('transliterate'),runs=[];
                for(const character of Array.from(this.value('small-text'))){
                    const selected=(language!=='ru'&&/[a-z]/i.test(character))||(language!=='en'&&/[а-яё]/i.test(character));
                    const text=smallCaps(character,{transliterate,language});
                    if(runs.at(-1)?.selected===selected)runs.at(-1).text+=text;else runs.push({selected,text});
                }
                output=runs.map(run=>run.text).join('');
                const fragment=document.createDocumentFragment();
                for(const run of runs){const span=document.createElement('span');span.className=run.selected?'utility-smallcaps-run':'utility-regular-run';span.textContent=run.text;fragment.append(span);}
                this.get('output-view').replaceChildren(fragment);
                count = graphemes(output).length;
            } else if (this.tab === 'gradient') {
                const text = this.checked('gradient-smallcaps') ? smallCaps(this.value('gradient-text')) : this.value('gradient-text');
                output = formatGradient(text, this.colors, this.value('format'), options); count = graphemes(text).length;
                this.paintGradient(text, options);
            }
        } catch (error) { bindText(this.get('status'), error.message); }
        this.get('output').value = output;
        if (typeof count === 'number') {
            const unit = {one:'символ',few:'символа',many:'символов',other:'символа'}[new Intl.PluralRules('ru').select(count)];
            bindText(this.get('count'),'{0} {1}',{0:count,1:localeValue(unit,count===1?'character':'characters')});
        } else this.get('count').textContent = '';
        const invalidColor = this.tab === 'gradient' && this.get('colors').querySelector('[aria-invalid="true"]');
        if(invalidColor)bindText(this.get('status'), 'Исправьте HEX цвета перед копированием.');
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
            if(this.checked('gradient-smallcaps')&&/\p{L}/u.test(char.text))span.className='utility-smallcaps-run';
            if (char.color) span.style.color = char.color;
            fragment.append(span);
        }
        preview.replaceChildren(fragment);
    }

    async copy() {
        if (this.dialog.querySelector('[data-utility-action="copy"]').disabled) return;
        const text = this.get('output').value;
        try { await navigator.clipboard.writeText(text); bindText(this.get('status'), 'Скопировано'); }
        catch { this.selectResult(); bindText(this.get('status'), 'Нажмите Ctrl+C, чтобы скопировать выделенный результат.'); }
    }

    selectResult() {
        if(this.tab!=='smallcaps'){this.get('output').focus();this.get('output').select();return;}
        const view=this.get('output-view');view.focus();const range=document.createRange();range.selectNodeContents(view);
        const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
    }

    persist(immediate = false) {
        clearTimeout(this.persistTimer);
        const write = () => {
            const fields = [...this.dialog.querySelectorAll('input[id],select[id],textarea[id]:not([readonly])')].map(control => [control.id, control.type === 'checkbox' ? control.checked : control.value]);
            const json=JSON.stringify({ colors: this.colors, fields });
            try { sessionStorage.setItem('molly-utilities-v1',json); } catch { /* Storage may be disabled. */ }
            try { if(this.checked('remember'))localStorage.setItem('molly-utilities-v1',json);else localStorage.removeItem('molly-utilities-v1'); } catch { /* Preserve the open utility even when storage fails. */ }
        };
        if(immediate)write();else this.persistTimer=setTimeout(write,200);
    }

    restore() {
        try {
            const raw = sessionStorage.getItem('molly-utilities-v1') || localStorage.getItem('molly-utilities-v1'); if (!raw || raw.length > 100000) return;
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
