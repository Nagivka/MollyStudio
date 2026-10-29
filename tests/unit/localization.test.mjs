import test from 'node:test';
import assert from 'node:assert/strict';
import {LANGUAGES, normalizeLanguage, setLanguage, translate, getLocale, labelHTML, attributeHTML, uiLabel} from '../../src/renderer/js/core/Locale.mjs';
import english from '../../src/renderer/locales/en.json' with {type:'json'};
import {readdir,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';

test('supported languages are explicit; incomplete font coverage does not expose Ukrainian', () => {
    assert.deepEqual(LANGUAGES.map(item => item.id), ['ru', 'en']);
    for (const value of ['uk', null, {}, '<script>', 'EN']) assert.equal(normalizeLanguage(value), 'ru');
});
test('translation preserves whitespace, unknown content and literal interpolation', () => {
    setLanguage('en');
    assert.equal(translate('  Сохранить\n'), '  Save\n');
    assert.equal(translate('Мой личный проект'), 'Мой личный проект');
    for (const value of ['constructor', '__proto__', 'toString']) assert.equal(translate(value), value);
    assert.equal(translate('{name}', {name: '<script>$&</script>'}), '<script>$&</script>');
    assert.equal(getLocale(), 'en-US');
    setLanguage('ru');
    assert.equal(translate('Сохранить'), 'Сохранить');
});
test('English catalog values are nonempty plain text', () => {
    assert.ok(Object.keys(english).length > 700);
    for (const [source, value] of Object.entries(english)) {
        assert.ok(source && value, source);
        assert.ok(!/[<>]/.test(value), source);
    }
});

test('localized markup escapes interpolation and retains the original binding safely', () => {
    const name='<img src=x onerror="bad()">-->';
    setLanguage('en');
    const html=labelHTML('Не удалось сохранить «{0}». {1}',{0:name,1:uiLabel('Недостаточно места на диске. Освободите место или выберите другой диск.')});
    assert.doesNotMatch(html,/<img/);
    assert.match(html,/&lt;img/);
    const binding=JSON.parse(decodeURIComponent(html.match(/^<!--i18n:(.*?)-->/)[1]));
    assert.equal(binding.values[0],name);
    const attribute=attributeHTML('title','{0}',{0:name});
    assert.doesNotMatch(attribute,/<img/);
    assert.match(attribute,/&quot;bad\(\)&quot;/);
    assert.equal(translate('Проект "name" created.mlst" создан!'),'Project “name" created.mlst” created!');
    setLanguage('ru');
});

test('every marked static HTML label and tooltip has an English translation', async () => {
    const directory=new URL('../../src/renderer/',import.meta.url);
    let labels=0;
    for(const page of (await readdir(directory)).filter(name=>name.endsWith('.html'))){
        const html=await readFile(new URL(page,directory),'utf8');
        const sources=[...[...html.matchAll(/<!--i18n-->([^<]+)/g)].map(match=>match[1]),
            ...[...html.matchAll(/data-i18n-(?:title|placeholder|aria-label)="([^"]+)"/g)].map(match=>decodeURIComponent(match[1]))];
        for(const source of sources){
            const key=source.trim();
            if(!/[А-Яа-яЁё]/.test(key))continue;
            assert.ok(Object.hasOwn(english,key),page+': '+key);labels++;
        }
    }
    assert.ok(labels>500);
});

test('native dialog titles and filters use English without altering file paths', () => {
    const {dialogOptions}=createRequire(import.meta.url)('../../src/main/ipc.cjs');
    const defaultPath='C:\\Проекты\\Мой проект.mlst';
    const options=dialogOptions({title:'Сохранить проект MollyStudio',defaultPath,filters:[{name:'Проекты MollyStudio',extensions:['mlst']}]},'en');
    assert.equal(options.title,'Save MollyStudio project');
    assert.equal(options.filters[0].name,'MollyStudio projects');
    assert.equal(options.defaultPath,defaultPath);
});
