import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('editor, launcher, and settings expose named tab lists and panels', async () => {
    const [editor, launcher, settings, buttons, newProject, keyboard, material, launcherLogic, buttonGenerator, layerPanel] = await Promise.all([
        read('../www/editor.html'), read('../www/index.html'), read('../www/settings.html'),
        read('../www/buttons.html'), read('../www/new-project.html'),
        read('../www/js/ui/KeyboardNavigation.js'), read('../www/css/material-you.css'),
        read('../www/js/launcher.js'), read('../www/js/ui/ButtonGeneratorModal.js'), read('../www/js/ui/LayerPanel.js')
    ]);
    assert.match(editor, /id="doc-tab-container"[^>]*role="tablist"[^>]*aria-label="Открытые проекты"/);
    for (const html of [editor, launcher]) {
        assert.match(html, /id="new-proj-type-selector"[^>]*role="tablist"[^>]*aria-label="Тип проекта"/);
        assert.match(html, /role="tabpanel"[^>]*aria-labelledby="new-proj-tab-gui"/);
    }
    assert.match(settings, /role="tablist"[^>]*aria-label="Разделы настроек"[^>]*aria-orientation="vertical"/);
    assert.match(settings, /role="tabpanel"[^>]*aria-labelledby="settings-tab-appearance"/);
    assert.match(keyboard, /ArrowRight/);
    assert.match(keyboard, /ArrowLeft/);
    assert.match(keyboard, /event\.key === 'Home'/);
    assert.match(keyboard, /event\.key === 'End'/);
    assert.match(keyboard, /event\.key !== 'Tab'/);
    for (const html of [editor, launcher, settings, buttons, newProject]) {
        assert.match(html, /css\/material-you\.css/);
        const buttonsInMarkup = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)];
        for (const [, attributes, body] of buttonsInMarkup) {
            const iconOnlyContent = body
                .replace(/<i\b[^>]*class="[^"]*material-symbols-rounded[^"]*"[^>]*>[\s\S]*?<\/i>/gi, '')
                .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
                .replace(/<[^>]+>/g, '')
                .replace(/&(?:nbsp|#\d+|#x[\da-f]+|amp|lt|gt|quot|apos);/gi, '')
                .trim();
            if (!iconOnlyContent) assert.match(attributes, /(?:aria-label|title)=/i, `Unnamed icon button in page`);
        }
    }
    assert.match(material, /prefers-reduced-motion/);
    assert.match(material, /forced-colors/);
    assert.match(buttonGenerator, /aria-labelledby', 'btn-gen-title'/);
    assert.match(buttonGenerator, /id="btn-gen-title"/);
    assert.match(layerPanel, /setAccessibleButtonName\(button, name\)/);
    assert.match(layerPanel, /setAccessibleButtonName\(btnVis, layer\.visible \? 'Скрыть слой' : 'Показать слой'\)/);
    assert.match(layerPanel, /setAccessibleButtonName\(btnLock, layer\.locked \? 'Разблокировать слой' : 'Заблокировать слой'\)/);
    assert.match(editor, /data-tool="brush"[^>]*aria-label="Кисть"/);
    assert.match(editor, /id="btn-quick-recolor"[^>]*aria-label="Замена цвета на холсте"/);
    assert.match(editor, /id="btn-toggle-rulers"[^>]*aria-label="Показать или скрыть линейки"/);
    assert.doesNotMatch(settings, /(?:fontFamily|accentFontFamily|uiFont|typeface)/i);
    assert.doesNotMatch(newProject, /<option\b[^>]*value=["'](?:medieval|modern)["']/i);
    assert.doesNotMatch(launcher, /<option\b[^>]*value=["'](?:medieval|modern)["']/i);
    assert.match(material, /--md-sys-font-family:\s*['"]?Google Sans['"]?,\s*sans-serif/i);
    assert.match(launcherLogic, /class="m3-recent-open" type="button"/);
    assert.match(launcherLogic, /setAttribute\('role', 'group'\)/);
    assert.doesNotMatch(launcherLogic, /setAttribute\('role', 'button'\)/);

    for (const [name, html] of [['editor', editor], ['launcher', launcher], ['settings', settings], ['new project', newProject]]) {
        const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id);
        assert.equal(new Set(ids).size, ids.length, `Duplicate id in ${name} markup`);
        const knownIds = new Set(ids);
        for (const [, rawIds] of html.matchAll(/\baria-(?:controls|labelledby)="([^"]+)"/g)) {
            for (const id of rawIds.split(/\s+/)) assert.equal(knownIds.has(id), true, `Missing aria target #${id} in ${name}`);
        }
    }
});
