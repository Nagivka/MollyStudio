import {labelHTML, attributeHTML, uiLabel} from '../core/Locale.mjs';
import {iconDisclosure} from './IconDisclosure.js';
import {BITMAP_FONTS} from '../core/BitmapFonts.mjs';
const field = (label, key, input) => `<label class="prefix-field"><span>${labelHTML(label)}</span>${input.replace('>', ` data-prefix-field="${key}">`)}</label>`;
const number = (label, key, min, max) => field(label, key, `<input class="md-input" type="number" min="${min}" max="${max}" step="1">`);
const select = (label, key, options) => {
    const choices=options.map(([value,name])=>`<option value="${value}">${labelHTML(name)}</option>`).join('');
    return key==='font'?`<div class="prefix-field"><span>${labelHTML(label)}</span><select class="md-select" id="prefix-font-select" data-prefix-field="font"${attributeHTML('aria-label',label)}>${choices}</select></div>`:field(label,key,`<select class="md-select">${choices}</select>`);
};
const toggle = (label, key) => `<label class="md-switch prefix-toggle"><input type="checkbox" data-prefix-field="${key}"><span class="md-switch-track"><span class="md-switch-thumb"></span></span><span class="md-switch-label">${labelHTML(label)}</span></label>`;
const icon = name => `<i class="material-symbols-rounded" aria-hidden="true">${name}</i>`;
const action = (key, label, symbol, compact = false, values = {}) => `<button type="button" class="md-btn ${compact ? 'prefix-icon-action' : 'outlined'}" data-prefix-action="${key}"${compact ? attributeHTML('aria-label',label,values)+attributeHTML('title',label,values) : ''}>${icon(symbol)}${compact ? '' : labelHTML(label,values)}</button>`;
const section = (id, title, symbol, content) => `<section class="prefix-section" id="prefix-section-${id}" aria-labelledby="prefix-heading-${id}"><h3 id="prefix-heading-${id}">${icon(symbol)}${labelHTML(title)}${['text','background','composition'].includes(id)?action(`reset-${id}`,'Сбросить: {0}','restart_alt',true,{0:uiLabel(title)}):''}</h3>${content}</section>`;
const subsection = (title, content, attributes = '') => `<div class="prefix-subsection" ${attributes}><h4>${labelHTML(title)}</h4>${content}</div>`;
const color = (label, key) => `<div class="prefix-field"><span id="prefix-label-${key}">${labelHTML(label)}</span><div class="prefix-color-row"><div class="color-preview-circle"><input type="color" data-prefix-field="${key}" aria-labelledby="prefix-label-${key}"></div><input type="text" class="m3-text-field" data-prefix-field="${key}" data-prefix-hex="true" maxlength="7" autocomplete="off" spellcheck="false" ${attributeHTML('aria-label','{0}: HEX',{0:uiLabel(label)})}></div></div>`;
const palettes = PaletteOptions;

function colorEditor(key, label, modeKey, angleKey, showModes = true) {
    const target = key === 'textColors' ? 'текста' : key === 'textShadowColors' ? 'тени текста' : 'фона';
    const listId = { textColors: 'prefix-text-colors', backgroundColors: 'prefix-background-colors', textShadowColors: 'prefix-text-shadow-colors' }[key];
    return `<div data-prefix-colors="${key}" ${attributeHTML('aria-label',label)}>
        ${key === 'backgroundColors' ? toggle('Прозрачный фон', 'transparent') : ''}
        ${showModes ? `<div class="m3-segmented-button prefix-fill-modes" role="group" ${attributeHTML('aria-label','{0}: заливка',{0:uiLabel(label)})}>
            ${[['solid', 'Сплошной', 'format_color_fill'], ['gradient', 'Градиент', 'gradient']].map(([value, name, symbol]) => `<button type="button" class="m3-segment-item" data-prefix-mode="${modeKey}:${value}" aria-pressed="false">${icon(symbol)}${labelHTML(name)}</button>`).join('')}
        </div>` : ''}
        <div data-prefix-color-controls="${key}">
            <div class="prefix-gradient-preview" data-prefix-gradient-preview="${key}" aria-hidden="true"></div>
            <div id="${listId}" class="prefix-color-list"></div>
            <div data-prefix-angle="${key}" class="prefix-angle-control">
                <label class="prefix-angle-label"><span><!--i18n-->Направление градиента</span><output data-prefix-angle-value="${angleKey}"></output><input type="range" class="m3-slider" min="0" max="360" step="1" data-prefix-field="${angleKey}" ${attributeHTML('aria-label','{0}: направление градиента',{0:uiLabel(label)})}></label>
                <div class="m3-chip-row" role="group" ${attributeHTML('aria-label','{0}: угол градиента',{0:uiLabel(label)})}>${[0, 45, 90, 135, 180, 270].map(angle => `<button type="button" class="m3-chip" data-prefix-angle-preset="${angleKey}:${angle}" aria-pressed="false">${angle}°</button>`).join('')}</div>
            </div>
            ${iconDisclosure({label:'Палитры',icon:'palette',className:'prefix-palette-library',content:`<div class="prefix-palette" data-prefix-palette="${key}">
                <label class="prefix-field"><span>${labelHTML({textColors:'Палитра текста',textShadowColors:'Палитра тени',backgroundColors:'Палитра фона'}[key])}</span><select class="md-select" data-prefix-palette-select="${key}">${palettes.map(([id, name]) => `<option value="${id}">${labelHTML(name)}</option>`).join('')}</select></label>
                <div class="color-palette-grid" data-prefix-palette-swatches="${key}" role="group" ${attributeHTML('aria-label','Готовые цвета {0}',{0:uiLabel(target)})}></div>
            </div>`})}
        </div>
    </div>`;
}

/** Text and its shading stay together; background geometry has its own tab. */
export function prefixInspectorMarkup() {
    const textShadow = `${toggle('Тень текста', 'textShadow')}
        <div data-prefix-text-shadow-options>
            <div class="m3-segmented-button prefix-fill-modes prefix-shadow-modes" role="group" aria-label="Цвет тени текста" data-i18n-aria-label="%D0%A6%D0%B2%D0%B5%D1%82%20%D1%82%D0%B5%D0%BD%D0%B8%20%D1%82%D0%B5%D0%BA%D1%81%D1%82%D0%B0">${[['auto', 'Автошейдинг', 'auto_awesome'], ['solid', 'Сплошной', 'format_color_fill'], ['gradient', 'Градиент', 'gradient']].map(([value, name, symbol]) => `<button type="button" class="m3-segment-item" data-prefix-mode="textShadowMode:${value}" aria-pressed="false">${icon(symbol)}${labelHTML(name)}</button>`).join('')}</div>
            <div data-prefix-text-shadow-auto><p class="prefix-hint" data-prefix-text-shadow-hint></p>
                <div class="prefix-gradient-preview" data-prefix-text-shadow-preview aria-label="Оттенки автоматической тени" data-i18n-aria-label="%D0%9E%D1%82%D1%82%D0%B5%D0%BD%D0%BA%D0%B8%20%D0%B0%D0%B2%D1%82%D0%BE%D0%BC%D0%B0%D1%82%D0%B8%D1%87%D0%B5%D1%81%D0%BA%D0%BE%D0%B9%20%D1%82%D0%B5%D0%BD%D0%B8"></div>
                <label class="prefix-angle-label"><span><!--i18n-->Затемнение, %</span><output data-prefix-text-shadow-darkness></output><input type="range" class="m3-slider" min="0" max="100" step="1" data-prefix-field="textShadowDarkness" aria-label="Затемнение тени текста, %" data-i18n-aria-label="%D0%97%D0%B0%D1%82%D0%B5%D0%BC%D0%BD%D0%B5%D0%BD%D0%B8%D0%B5%20%D1%82%D0%B5%D0%BD%D0%B8%20%D1%82%D0%B5%D0%BA%D1%81%D1%82%D0%B0%2C%20%25"></label>
            </div>
            <div data-prefix-text-shadow-solid>${color('Цвет тени текста', 'textShadowColor')}</div>
            <div data-prefix-text-shadow-gradient>${colorEditor('textShadowColors', 'Градиент тени текста', 'textShadowMode', 'textShadowAngle', false)}</div>
            <div class="prefix-grid prefix-shadow-position">${number('Смещение X, px', 'textShadowX', -16, 16)}${number('Смещение Y, px', 'textShadowY', -16, 16)}</div>
            ${number('Непрозрачность тени, %', 'textShadowOpacity', 0, 100)}
        </div>`;
    const text = `${field('Текст блока', 'text', "<input class=\"md-input\" type=\"text\" maxlength=\"64\" autocomplete=\"off\" placeholder=\"Например, VIP\" data-i18n-placeholder=\"%D0%9D%D0%B0%D0%BF%D1%80%D0%B8%D0%BC%D0%B5%D1%80%2C%20VIP\">")}
        <p id="prefix-warning" class="prefix-hint" role="status"></p>
        <div class="prefix-grid">${select('Шрифт', 'font', BITMAP_FONTS.map(font=>[font.id,font.name]))}${number('Интервал букв, px', 'letterSpacing', 0, 8)}</div>
        ${subsection('Цвет текста', colorEditor('textColors', 'Цвет текста', 'textMode', 'textAngle'))}
        ${subsection('Тень текста', textShadow)}`;
    const background = `${subsection('Заливка фона', colorEditor('backgroundColors', 'Фон блока', 'background', 'backgroundAngle'))}
        ${subsection('Фактура фона', `${select('Рисунок', 'texture.type', SURFACE_TEXTURES.map(item=>[item.id,item.name]))}<div data-prefix-texture-options><div class="prefix-grid">${number('Сила, %','texture.amount',0,100)}${number('Масштаб, px','texture.scale',1,16)}</div>${number('Вариант рисунка','texture.seed',0,65535)}</div><p class="prefix-hint"><!--i18n-->Фактура изменяет только заливку. Текст, обводка и прозрачность сохраняются.</p>`, 'data-prefix-texture')}
        ${subsection('Размеры и отступы', `<div class="prefix-grid">${number('Отступ слева и справа, px', 'paddingX', 0, 32)}${number('Отступ сверху и снизу, px', 'paddingY', 0, 16)}</div>`)}
        ${subsection('Скругление углов', `<label class="md-switch prefix-toggle"><input type="checkbox" data-prefix-link-corners><span class="md-switch-track"><span class="md-switch-thumb"></span></span><span class="md-switch-label"><!--i18n-->Связать четыре угла</span></label><div class="prefix-grid">${number('Верхний левый, px', 'radiusTopLeft', 0, 32)}${number('Верхний правый, px', 'radiusTopRight', 0, 32)}${number('Нижний левый, px', 'radiusBottomLeft', 0, 32)}${number('Нижний правый, px', 'radiusBottomRight', 0, 32)}</div><p class="prefix-hint"><!--i18n-->0 — прямой угол. Слишком большие радиусы пропорционально вписываются в размер блока. Скругление пиксельное, без размытия.</p>`)}
        ${subsection('Края блока', `<p class="prefix-hint" data-prefix-transparent-edges hidden><!--i18n-->Обводка доступна и без заливки. Фаски появятся после включения фона.</p>${number('Толщина обводки, px', 'borderWidth', 0, 4)}${toggle('Объёмные фаски', 'bevel')}
            <div data-prefix-edge-colors><span class="prefix-mode-label"><!--i18n-->Подбор цветов обводки и фасок</span><div class="m3-segmented-button prefix-fill-modes" role="group" aria-label="Подбор цветов краёв" data-i18n-aria-label="%D0%9F%D0%BE%D0%B4%D0%B1%D0%BE%D1%80%20%D1%86%D0%B2%D0%B5%D1%82%D0%BE%D0%B2%20%D0%BA%D1%80%D0%B0%D1%91%D0%B2">${[['auto','Из заливки','auto_awesome'],['manual','Вручную','palette']].map(([value,name,symbol])=>`<button type="button" class="m3-segment-item" data-prefix-shade-mode="${value}" aria-pressed="false">${icon(symbol)}${labelHTML(name)}</button>`).join('')}</div>
            <div data-prefix-auto-edges><p class="prefix-hint"><!--i18n-->Цвета следуют заливке, включая направление и переходы градиента.</p>${toggle('Тонировать обводку', 'tintedBorder')}<div class="prefix-edge-preview" aria-label="Автоматические цвета краёв" data-i18n-aria-label="%D0%90%D0%B2%D1%82%D0%BE%D0%BC%D0%B0%D1%82%D0%B8%D1%87%D0%B5%D1%81%D0%BA%D0%B8%D0%B5%20%D1%86%D0%B2%D0%B5%D1%82%D0%B0%20%D0%BA%D1%80%D0%B0%D1%91%D0%B2">${[['border','Обводка'],['highlight','Светлая фаска'],['shadow','Тёмная фаска']].map(([key,label])=>`<div data-prefix-edge-preview="${key}"><span></span><small>${labelHTML(label)}</small></div>`).join('')}</div></div>
            <div data-prefix-manual-border>${color('Цвет обводки', 'borderColor')}</div>
            <div data-prefix-manual-bevel>${color('Светлая фаска', 'highlightColor')}${color('Тёмная фаска', 'bevelShadowColor')}</div></div>`, 'data-prefix-bevel-options')}
        ${subsection('Тень фона', `${toggle('Тень фона', 'shadow')}<div data-prefix-background-shadow-options><div class="prefix-grid">${number('Смещение X, px', 'shadowX', -8, 8)}${number('Смещение Y, px', 'shadowY', -8, 8)}</div>${color('Цвет тени фона', 'shadowColor')}${number('Непрозрачность тени, %', 'shadowOpacity', 0, 100)}</div>`)}`;
    return `<header class="prefix-inspector-header"><label class="prefix-field" data-prefix-existing-blocks hidden><span><!--i18n-->Редактируемый блок</span><select class="md-select" data-prefix-existing-block aria-label="Редактируемый блок" data-i18n-aria-label="%D0%A0%D0%B5%D0%B4%D0%B0%D0%BA%D1%82%D0%B8%D1%80%D1%83%D0%B5%D0%BC%D1%8B%D0%B9%20%D0%B1%D0%BB%D0%BE%D0%BA"></select></label><button class="md-btn outlined" type="button" data-prefix-designs>${icon('palette')}${labelHTML('Готовые оформления')}</button></header><div class="prefix-scroll" aria-label="Параметры префикса" data-i18n-aria-label="%D0%9F%D0%B0%D1%80%D0%B0%D0%BC%D0%B5%D1%82%D1%80%D1%8B%20%D0%BF%D1%80%D0%B5%D1%84%D0%B8%D0%BA%D1%81%D0%B0">
        ${section('text', 'Текст', 'text_fields', text)}
        ${section('background', 'Фон и геометрия', 'format_color_fill', background)}
    </div><div class="prefix-error" hidden><span role="alert"></span><button type="button" class="md-btn flat" data-prefix-action="discard-invalid"><!--i18n-->Отменить неверный ввод</button></div>`;
}
import {PaletteOptions} from '../utils/Palettes.js';
import {SURFACE_TEXTURES} from '../graphics/SurfaceTexture.mjs';

