import english from '../../locales/en.json' with {type: 'json'};
Object.freeze(english);

export const LANGUAGES = Object.freeze([{id: 'ru', name: 'Русский'}, {id: 'en', name: 'English'}]);
export const normalizeLanguage = value => value === 'en' ? 'en' : 'ru';
let language = 'ru';
try { language = normalizeLanguage(JSON.parse(globalThis.localStorage?.getItem('molly_settings_m3') || '{}').language); } catch {}
export const getLanguage = () => language;
export const getLocale = () => language === 'en' ? 'en-US' : 'ru-RU';
export const uiLabel = source => ({$label: String(source)});
export const localeValue = (ru, en) => ({$locale: {ru, en}});
function formatValue(value) {
    if (value && typeof value === 'object') {
        if (typeof value.$label === 'string') return translate(value.$label);
        if (value.$locale && Object.hasOwn(value.$locale, language)) return String(value.$locale[language]);
    }
    return String(value);
}
const patterns = Object.entries(english).filter(([key]) => /[А-Яа-яЁё]/.test(key) && /\{\d+\}/.test(key))
    .map(([key, value]) => ({parts: key.split(/\{\d+\}/), slots: [...key.matchAll(/\{(\d+)\}/g)].map(match => match[1]), value}));
function translateMessage(source) {
    // Match explicit message templates with string searches, avoiding unbounded
    // regular expressions on error details and user-supplied file names.
    for (const {parts, slots, value} of patterns) {
        if (!source.startsWith(parts[0])) continue;
        const values = {};
        let position = parts[0].length, matches = true;
        for (let index = 0; index < slots.length; index++) {
            const next = parts[index + 1];
            const last = index === slots.length - 1;
            const end = next ? last ? source.endsWith(next) ? source.length-next.length : -1 : source.indexOf(next, position) : last ? source.length : -1;
            if (end < position) { matches = false; break; }
            values[slots[index]] = source.slice(position, end);
            position = end + next.length;
        }
        if (matches && position === source.length) return value.replace(/\{(\w+)\}/g, (match, key) => Object.hasOwn(values, key) ? values[key] : match);
    }
    return source;
}
export function translate(source, values = {}) {
    source = String(source);
    const text = language === 'en'
        ? Object.hasOwn(english, source) ? english[source] : source.replace(/^(\s*)([\s\S]*?)(\s*)$/, (_, before, core, after) => before + (Object.hasOwn(english, core) ? english[core] : translateMessage(core)) + after)
        : source;
    return String(text).replace(/\{(\w+)\}/g, (match, key) => Object.hasOwn(values, key) ? formatValue(values[key]) : match);
}

// Bind only developer-owned labels. Never scan arbitrary project or input text.
const bindings = new WeakMap();
export function getLabelSource(element) {
    if (!element) return '';
    const walker = element.ownerDocument.createTreeWalker(element, 4);
    let node;
    while ((node = walker.nextNode())) {
        const binding = bindings.get(node);
        if (binding) return binding.source;
    }
    return element.textContent;
}
export function getAttributeSource(element, attribute) {
    try {
        const source = element.getAttribute(`data-i18n-${attribute}`);
        return source ? decodeURIComponent(source) : element.getAttribute(attribute) || '';
    } catch { return element.getAttribute(attribute) || ''; }
}
let refreshAttributes = () => {};
function render(node, binding) {
    const value = translate(binding.source, binding.values);
    if (node.data !== value) node.data = value;
}
export function bindText(element, source, values = {}) {
    element.textContent = translate(source, values);
    if (element.firstChild?.nodeType === 3) bindings.set(element.firstChild, {source, values});
    return source;
}
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[char]);
/** Use only for interface labels; interpolation is escaped and never translated. */
export function labelHTML(source, values = {}) {
    const binding = encodeURIComponent(JSON.stringify({source, values}));
    return `<!--i18n:${binding}-->${escapeHTML(translate(source, values))}`;
}
export function attributeHTML(attribute, source, values = {}) {
    if (!['title', 'aria-label', 'placeholder'].includes(attribute)) throw new TypeError('Unsupported localized attribute');
    return ` ${attribute}="${escapeHTML(translate(source, values))}" data-i18n-${attribute}="${encodeURIComponent(source)}" data-i18n-values-${attribute}="${encodeURIComponent(JSON.stringify(values)).replaceAll("'", '%27')}"`;
}
export function bindAttribute(element, attribute, source, values = {}) {
    element.setAttribute(`data-i18n-${attribute}`, encodeURIComponent(source));
    element.setAttribute(`data-i18n-values-${attribute}`, encodeURIComponent(JSON.stringify(values)));
    element.setAttribute(attribute, translate(source, values));
    return source;
}
export function setLanguage(value) {
    const unchanged = language === normalizeLanguage(value) && globalThis.document?.documentElement?.getAttribute?.('lang') === language;
    language = normalizeLanguage(value);
    if (unchanged) return;
    const root = globalThis.document?.documentElement;
    root?.setAttribute('lang', language);
    refreshAttributes();
    const select = globalThis.document?.getElementById?.('setting-language-select');
    if (select) select.value = language;
    globalThis.document?.dispatchEvent?.(new Event('molly-language-changed'));
}

let observer;
export function installLocalization() {
    if (observer || !globalThis.document?.documentElement) return;
    const scan = root => {
        // Comments retain normal text-node layout, including options and flex rows.
        const walker = document.createTreeWalker(root, 132);
        let node;
        while ((node = walker.nextNode())) {
            if (node.nodeType === 8 && (node.data === 'i18n' || node.data.startsWith('i18n:'))) {
                const text = node.nextSibling;
                if (text?.nodeType !== 3) continue;
                if (!bindings.has(text)) {
                    try { bindings.set(text, node.data === 'i18n' ? {source: text.data} : JSON.parse(decodeURIComponent(node.data.slice(5)))); }
                    catch { continue; }
                }
            } else if (node.nodeType === 3) {
                const binding = bindings.get(node);
                if (binding) render(node, binding);
            }
        }
        for (const element of root.querySelectorAll?.('[data-i18n-text]') || []) {
            if (element.firstChild?.nodeType === 3 && !bindings.has(element.firstChild)) {
                bindings.set(element.firstChild, {source: element.getAttribute('data-i18n-text')});
                render(element.firstChild, bindings.get(element.firstChild));
            }
        }
        const selector = '[data-i18n-title],[data-i18n-placeholder],[data-i18n-aria-label]';
        const elements = [...(root.nodeType === 1 && root.matches(selector) ? [root] : []), ...(root.querySelectorAll?.(selector) || [])];
        for (const element of elements) {
            for (const attribute of ['title', 'placeholder', 'aria-label']) {
                if (!element.hasAttribute(`data-i18n-${attribute}`)) continue;
                let source;
                try { source = decodeURIComponent(element.getAttribute(`data-i18n-${attribute}`)); } catch { continue; }
                let values = {};
                try { values = JSON.parse(decodeURIComponent(element.getAttribute(`data-i18n-values-${attribute}`) || '%7B%7D')); } catch {}
                const value = translate(source, values);
                if (element.getAttribute(attribute) !== value) element.setAttribute(attribute, value);
            }
        }
    };
    refreshAttributes = () => scan(document.documentElement);
    scan(document.documentElement);
    observer = new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
            if (node.nodeType === 1) scan(node);
        }
    });
    observer.observe(document.documentElement, {childList: true, subtree: true});
    setLanguage(language);
}
