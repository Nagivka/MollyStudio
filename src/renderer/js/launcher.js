import {revealTheme} from './ui/VisualEffects.js';
import {bindAttribute, bindText, translate, getLocale, getLanguage, labelHTML, localeValue, uiLabel} from './core/Locale.mjs';
import { readProjectThumbnail, writeProjectThumbnail } from './core/ProjectThumbnailCache.mjs';
import UtilitiesPanel from './ui/UtilitiesPanel.js';
import { installProjectOpenRequests } from './core/ProjectOpenRequests.js';
import './core/DesktopBridge.js';
import SettingsManager from './core/SettingsManager.js';
import SettingsModal from './ui/SettingsModal.js';
import EventBus from './core/EventBus.js';
import { initRippleEffect } from './ui/Ripple.js';
import { confirmDialog } from './ui/ConfirmDialog.js';
import { installKeyboardNavigation } from './ui/KeyboardNavigation.js';
import { buildEditorUrl, createProjectFromForm } from './core/ProjectFactory.mjs';
import { LEGACY_DRAFT_KEY, PROJECT_DRAFT_PREFIX } from './core/ProjectDraftStore.mjs';
import { deleteRecoveryDraft, listRecoveryDrafts, readRecoveryDraft } from './core/RecoveryDraftStore.mjs';
import { parseProjectJSON } from './core/ProjectValidation.mjs';
import {mountUpdatePanel} from './ui/UpdatePanel.js';

/**
 * MollyStudio - Material Design 3 Launcher Logic with Settings synchronization
 */

function startLauncher() {
    const updateContainer = document.getElementById('launcher-update');
    if (updateContainer) {
        const disposeUpdates = mountUpdatePanel(updateContainer,{banner:true});
        window.addEventListener('pagehide',disposeUpdates,{once:true});
    }
    installProjectOpenRequests({ launcher: true });
    const utilities = new UtilitiesPanel();
    document.querySelectorAll('[data-open-utility]').forEach(button => button.addEventListener('click', () => utilities.open(button.dataset.openUtility)));
    initRippleEffect();
    installKeyboardNavigation();
    const bus = new EventBus();
    const settingsManager = new SettingsManager(bus);
    const settingsModal = new SettingsModal(bus, settingsManager);

    const showLauncherToast = (message, icon = 'info') => {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = 'md-toast show';
        const iconElement = document.createElement('i');
        iconElement.className = 'material-symbols-rounded toast-icon';
        iconElement.textContent = icon;
        const textElement = document.createElement('span');
        bindText(textElement, message);
        toast.append(iconElement, textElement);
        container.append(toast);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 220);
        }, 3000);
    };

    try {
        window.desktopAPI?.updateDiscordPresence?.({
            details: 'MollyStudio',
            state: 'В главном меню',
            showTime: true,
            startTimestamp: Date.now()
        })?.catch?.(() => {});
    } catch (_) {}

    const btnTheme = document.getElementById('btn-toggle-theme');
    if (btnTheme) {
        btnTheme.addEventListener('click', () => {
            const cur = settingsManager.get('theme');
            const themes = ['dark', 'oled', 'midnight', 'forest', 'amethyst', 'light', 'light-nord', 'light-warm', 'light-rose', 'light-mint', 'minecraft', 'light-minecraft'];
            const idx = themes.indexOf(cur);
            const next = themes[(idx + 1) % themes.length];
            revealTheme(()=>settingsManager.set('theme', next),btnTheme);
        });
    }

    const btnSettings = document.getElementById('btn-open-settings');
    if (btnSettings) {
        btnSettings.addEventListener('click', () => {
            if (window.desktopAPI?.openSettingsWindow) {
                window.desktopAPI.openSettingsWindow();
            } else {
                settingsModal.open();
            }
        });
    }

    // Handle project created from separate New Project window
    window.desktopAPI?.onProjectCreated?.((projectData) => {
        if (projectData) {
            window.location.href = buildEditorUrl(projectData);
        }
    });

    const btnWinMin = document.getElementById('btn-win-min');
    const btnWinMax = document.getElementById('btn-win-max');
    const btnWinClose = document.getElementById('btn-win-close');
    const iconWinMax = document.getElementById('icon-win-max');

    const maxSvg = `<rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1.2" rx="0.5"/>`;
    const restoreSvg = `<rect x="1" y="3" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1.1" rx="0.5"/><path d="M3 1h5.5a.5.5 0 0 1 .5.5V7" fill="none" stroke="currentColor" stroke-width="1.1"/>`;

    const updateMaxUI = (isMax) => {
        if (iconWinMax) iconWinMax.innerHTML = isMax ? restoreSvg : maxSvg;
        if (btnWinMax) {
            bindAttribute(btnWinMax, "title", isMax ? 'Восстановить окно' : 'Развернуть');
            bindAttribute(btnWinMax, 'aria-label', isMax ? 'Восстановить' : 'Развернуть');
        }
    };

    const handleWinMin = (e) => {
        e?.stopPropagation?.();
        if (window.desktopAPI?.minimize) window.desktopAPI.minimize();
        else if (window.DesktopBridge?.minimize) window.DesktopBridge.minimize();
    };

    const handleWinMax = async (e) => {
        e?.stopPropagation?.();
        let isMax = false;
        if (window.desktopAPI?.maximize) {
            isMax = await window.desktopAPI.maximize();
        } else if (window.DesktopBridge?.maximize) {
            isMax = await window.DesktopBridge.maximize();
        } else {
            if (!document.fullscreenElement) {
                await document.documentElement.requestFullscreen?.();
                isMax = true;
            } else {
                await document.exitFullscreen?.();
                isMax = false;
            }
        }
        updateMaxUI(isMax);
    };

    const handleWinClose = (e) => {
        e?.stopPropagation?.();
        if (window.desktopAPI?.close) window.desktopAPI.close();
        else if (window.DesktopBridge?.close) window.DesktopBridge.close();
        else window.close();
    };

    btnWinMin?.addEventListener('click', handleWinMin);
    btnWinMax?.addEventListener('click', handleWinMax);
    btnWinClose?.addEventListener('click', handleWinClose);

    if (window.desktopAPI?.onWindowStateChange) {
        window.desktopAPI.onWindowStateChange((isMax) => {
            updateMaxUI(isMax);
        });
    }
    window.desktopAPI?.isMaximized?.()?.then?.((isMax) => {
        updateMaxUI(!!isMax);
    })?.catch?.(() => {});

    document.addEventListener('fullscreenchange', () => {
        if (!window.desktopAPI) {
            updateMaxUI(!!document.fullscreenElement);
        }
    });

    const titlebar = document.querySelector('.custom-titlebar');
    titlebar?.addEventListener('dblclick', (e) => {
        if (e.target.closest('.titlebar-controls') || e.target.closest('button')) return;
        handleWinMax(e);
    });

    const getRecentProjects = () => {
        try {
            const stored = localStorage.getItem('molly_recent');
            if (!stored) return [];
            const parsed = JSON.parse(stored);
            return Array.isArray(parsed) ? parsed.filter(item => item && typeof item === 'object' && item.path) : [];
        } catch (e) {
            return [];
        }
    };

    const saveRecentProjects = (projects) => {
        localStorage.setItem('molly_recent', JSON.stringify(projects));
    };

    const removeFromRecent = (filePath) => {
        const recent = getRecentProjects().filter(r => r.path !== filePath);
        saveRecentProjects(recent);
        renderRecentProjects();
    };

    const clearAllRecent = async () => {
        if (await confirmDialog({
            title: 'Очистить недавние проекты?',
            message: 'Список можно будет заполнить снова, открывая проекты.',
            confirmLabel: 'Очистить',
            danger: true
        })) {
            saveRecentProjects([]);
            renderRecentProjects();
        }
    };

    const openProjectByPath = (filePath) => {
        if (!filePath) return;
        window.location.href = `editor.html?file=${encodeURIComponent(filePath)}`;
    };

    const recentList = document.getElementById('recent-list');
    const recentCountChip = document.getElementById('recent-count-chip');
    const btnClearRecent = document.getElementById('btn-clear-recent');
    const search = document.getElementById('recent-search');
    const sort = document.getElementById('recent-sort');
    let recentRenderGeneration = 0;
    const previewJobs = [];
    const previewCache = new Map();
    let activePreviews = 0;
    const drainPreviews = () => {
        while (activePreviews < 2 && previewJobs.length) {
            const job = previewJobs.shift();
            activePreviews++;
            Promise.resolve().then(job).finally(() => { activePreviews--; drainPreviews(); });
        }
    };
    const attachPreview = (card, entry, generation) => {
        previewJobs.push(async () => {
            if (!card.isConnected || generation !== recentRenderGeneration) return;
            try {
                const key = entry.path + '|' + (entry.previewRevision || '');
                let preview;
                if (entry.draft) {
                    const { createProjectThumbnail } = await import('./ui/ProjectThumbnail.js');
                    const draft = entry.draft.summary
                        ? (await readRecoveryDraft(localStorage, entry.draftId))?.draft
                        : entry.draft;
                    if (!draft?.project) return;
                    preview = await createProjectThumbnail(draft.project);
                } else {
                    if (!previewCache.has(key)) {
                        previewCache.set(key, (async () => {
                            const cached = await readProjectThumbnail(entry.path, entry.previewRevision);
                            if (cached) return cached;
                            if (!window.desktopAPI?.readFile) return null;
                            const text = await window.desktopAPI.readFile(entry.path);
                            if (typeof text !== 'string' || text.length > 64 * 1024 * 1024) return null;
                            const { createProjectThumbnail } = await import('./ui/ProjectThumbnail.js');
                            const result = await createProjectThumbnail(parseProjectJSON(text));
                            if (entry.previewRevision) await writeProjectThumbnail(entry.path, entry.previewRevision, result);
                            return result;
                        })().catch(() => null));
                        if (previewCache.size > 24) previewCache.delete(previewCache.keys().next().value);
                    }
                    preview = await previewCache.get(key);
                }
                if (!card.isConnected || generation !== recentRenderGeneration) return;
                if (!preview?.dataUrl) throw new Error('Preview unavailable');
                const image = document.createElement('img'); image.alt = ''; image.className = 'launcher-project-image'; image.src = preview.dataUrl; image.decoding = 'async';
                card.querySelector('.launcher-project-preview').prepend(image);
                card.querySelector('.launcher-preview-placeholder').hidden = true;
                bindText(card.querySelector('.launcher-preview-type'), '{0} · {1} × {2}', {0:uiLabel(entry.type === 'prefix'?'Префиксы':entry.type === 'canvas'?'Холст':'GUI'),1:preview.width,2:preview.height});
                card.dataset.preview = 'ready';
            } catch (_) {
                if (card.isConnected) bindText(card.querySelector('.launcher-preview-message'), 'Предпросмотр недоступен');
            }
        });
        drainPreviews();
    };

    const renderRecentProjects = async () => {
        if (!recentList) return;
        const generation = ++recentRenderGeneration;
        const recent = getRecentProjects();
        const drafts = await listRecoveryDrafts(localStorage);
        if (generation !== recentRenderGeneration) return;
        previewJobs.length = 0;
        const query = (search?.value || '').trim().toLocaleLowerCase(getLocale());
        const entries = [
            ...drafts.map(item => ({ ...item, name: item.draft.project.name || 'Несохранённый проект', type: item.draft.project.type, order: item.timestamp || 0 })),
            ...recent.map((item, index) => ({ ...item, order: item.modifiedAt || recent.length - index }))
        ].filter(item => (!item.type || ['gui', 'canvas', 'prefix'].includes(item.type))).filter(item => !query || (item.name + ' ' + (item.path || '')).toLocaleLowerCase('ru').includes(query));
        entries.sort((a, b) => sort?.value === 'name' ? String(a.name).localeCompare(String(b.name), 'ru') : b.order - a.order);
        bindText(recentCountChip,'{0} {1}',{0:entries.length,1:localeValue(getNounPlural(entries.length,'проект','проекта','проектов'),entries.length===1?'project':'projects')});
        btnClearRecent.disabled = !recent.length;
        recentList.replaceChildren();
        if (!entries.length) {
            const empty = document.createElement('div'); empty.className = 'm3-empty-recent';
            empty.innerHTML = '<i class="material-symbols-rounded" aria-hidden="true">' + (query ? 'search_off' : 'folder_open') + '</i><h4>' + labelHTML(query ? 'Проекты не найдены' : 'Здесь будут ваши проекты') + '</h4><p>' + labelHTML(query ? 'Попробуйте другое название или путь к файлу.' : 'Создайте проект или откройте файл .mlst. Здесь появится его настоящее превью.') + '</p>';
            recentList.append(empty); return;
        }
        for (const entry of entries) {
            const draft = Boolean(entry.draft);
            const name = entry.name || 'Без названия';
            const type = entry.type === 'prefix' ? 'Префиксы' : entry.type === 'canvas' ? 'Холст' : 'GUI';
            const date = draft || entry.modifiedAt ? (draft ? translate('Автокопия') + ' · ' : '') + new Date(entry.timestamp || entry.modifiedAt || Date.now()).toLocaleString(getLocale(), {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : translate(entry.updatedAt || 'Локальный проект');
            const card = document.createElement('article'); card.className = 'm3-recent-card' + (draft ? ' unsaved-draft-card' : '');card.setAttribute('role', 'group');card.setAttribute('aria-label', name);card.dataset.name = name;
            card.innerHTML = '<button class="m3-recent-open" type="button" aria-label="' + (draft ? 'Восстановить ' : 'Открыть ') + escapeHtml(name) + '"><span class="launcher-project-preview"><span class="launcher-preview-placeholder"><i class="material-symbols-rounded" aria-hidden="true">' + (draft ? 'history' : 'image') + "</i><span class=\"launcher-preview-message\"><!--i18n-->Загрузка превью…</span></span><span class=\"launcher-preview-type\">" + labelHTML(type) + '</span></span><span class="m3-recent-info"><span class="m3-recent-title-row"><span class="m3-recent-name">' + escapeHtml(name) + '</span>' + (draft ? "<span class=\"m3-type-badge unsaved\"><!--i18n-->Автокопия</span>" : '') + '</span><span class="launcher-project-date">' + escapeHtml(date) + '</span><span class="m3-recent-path" title="' + escapeHtml(entry.path || '') + '">' + (entry.path ? escapeHtml(entry.path) : labelHTML('Несохранённый проект')) + '</span></span></button><div class="m3-recent-actions">' + (!draft ? "<button class=\"m3-icon-action-btn open-folder\" type=\"button\" title=\"Показать в проводнике\" data-i18n-title=\"%D0%9F%D0%BE%D0%BA%D0%B0%D0%B7%D0%B0%D1%82%D1%8C%20%D0%B2%20%D0%BF%D1%80%D0%BE%D0%B2%D0%BE%D0%B4%D0%BD%D0%B8%D0%BA%D0%B5\" aria-label=\"Показать проект в проводнике\" data-i18n-aria-label=\"%D0%9F%D0%BE%D0%BA%D0%B0%D0%B7%D0%B0%D1%82%D1%8C%20%D0%BF%D1%80%D0%BE%D0%B5%D0%BA%D1%82%20%D0%B2%20%D0%BF%D1%80%D0%BE%D0%B2%D0%BE%D0%B4%D0%BD%D0%B8%D0%BA%D0%B5\"><i class=\"material-symbols-rounded\" aria-hidden=\"true\">folder_open</i></button>" : '') + '<button class="m3-icon-action-btn ' + (draft ? 'delete-draft' : 'delete-proj') + '" type="button" title="' + (draft ? 'Удалить автокопию' : 'Убрать из недавних') + '" aria-label="' + (draft ? 'Удалить автокопию ' : 'Убрать из недавних ') + escapeHtml(name) + '"><i class="material-symbols-rounded" aria-hidden="true">close</i></button></div>';
            bindAttribute(card.querySelector('.m3-recent-open'),'aria-label',draft?'Восстановить {0}':'Открыть {0}',{0:name});
            const remove=card.querySelector(draft?'.delete-draft':'.delete-proj');
            bindAttribute(remove,'title',draft?'Удалить автокопию':'Убрать из недавних');
            bindAttribute(remove,'aria-label',draft?'Удалить автокопию {0}':'Убрать из недавних {0}',{0:name});
            card.querySelector('.m3-recent-open').addEventListener('click', () => {
                if (draft) window.location.href = 'editor.html?restoreDraft=' + encodeURIComponent(entry.key === LEGACY_DRAFT_KEY ? 'true' : entry.draftId || 'true');
                else openProjectByPath(entry.path);
            });
            card.querySelector('.open-folder')?.addEventListener('click', async () => {
                try { await window.DesktopBridge?.showItemInFolder(entry.path); } catch (_) { showLauncherToast('Не удалось показать файл в проводнике.', 'error'); }
            });
            card.querySelector('.delete-proj')?.addEventListener('click', () => removeFromRecent(entry.path));
            card.querySelector('.delete-draft')?.addEventListener('click', async () => {
                try { await deleteRecoveryDraft(localStorage, entry.draftId, entry.key); await renderRecentProjects(); }
                catch (_) { showLauncherToast('Не удалось удалить автокопию.', 'error'); }
            });
            recentList.append(card); attachPreview(card, entry, generation);
        }
    };
    let filterTimer;
    search?.addEventListener('input', () => { clearTimeout(filterTimer); filterTimer = setTimeout(renderRecentProjects, 100); });
    sort?.addEventListener('change', renderRecentProjects);

    function escapeHtml(str) {
        return String(str ?? '').replace(/[&<>'"]/g, tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag));
    }

    function getNounPlural(number, one, two, five) {
        let n = Math.abs(number);
        n %= 100;
        if (n >= 5 && n <= 20) return five;
        n %= 10;
        if (n === 1) return one;
        if (n >= 2 && n <= 4) return two;
        return five;
    }

    btnClearRecent?.addEventListener('click', clearAllRecent);

    renderRecentProjects();
    document.addEventListener('molly-language-changed', () => { void renderRecentProjects(); });

    const newProjModal = document.getElementById('new-project-modal');
    const openModal = () => {
        if (newProjModal) {
            newProjModal.classList.add('show');
            document.getElementById('new-proj-name')?.focus();
        }
    };
    const closeModal = () => {
        if (newProjModal) newProjModal.classList.remove('show');
    };

    document.querySelectorAll('.btn-close-modal, .btn-cancel-modal').forEach(btn => {
        btn.addEventListener('click', closeModal);
    });

    newProjModal?.addEventListener('click', (e) => {
        if (e.target === newProjModal) closeModal();
    });

    const btnHeroCreate = document.getElementById('btn-hero-create');
    btnHeroCreate?.addEventListener('click', () => {
        if (window.desktopAPI?.openNewProjectWindow) {
            window.desktopAPI.openNewProjectWindow();
        } else {
            openModal();
        }
    });

    const isNativeDesktop = Boolean(window.desktopAPI || (window.DesktopBridge && window.DesktopBridge.isNative?.()));

    const openBrowserProjectFile = (file) => {
        if (!file || !file.name.toLowerCase().endsWith('.mlst')) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                sessionStorage.setItem('molly_pending_project', String(event.target.result || ''));
                window.location.href = `editor.html?file=${encodeURIComponent(file.name)}&source=session`;
            } catch (error) {
                console.error('Не удалось открыть файл проекта:', error);
                showLauncherToast('Не удалось прочитать файл проекта.', 'error');
            }
        };
        reader.onerror = () => showLauncherToast('Не удалось прочитать файл проекта.', 'error');
        reader.readAsText(file);
    };

    const openFileDialog = async () => {
        if (!isNativeDesktop) {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.mlst';
            input.onchange = (e) => openBrowserProjectFile(e.target.files?.[0]);
            input.click();
            return;
        }

        try {
            const bridge = window.DesktopBridge || window.desktopAPI;
            const result = await bridge.showOpenDialog({
                title: 'Открыть проект MollyStudio',
                filters: [{ name: 'MollyStudio Project (*.mlst)', extensions: ['mlst'] }],
                properties: ['openFile']
            });
            if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
                const filePath = result.filePaths[0];
                openProjectByPath(filePath);
            }
        } catch (err) {
            console.error('Open dialog error:', err);
        }
    };

    const openFolderDialog = async () => {
        if (window.desktopAPI?.showOpenDialog) {
            try {
                const result = await window.desktopAPI.showOpenDialog({
                    title: 'Выберите папку с проектами',
                    properties: ['openDirectory']
                });
                if (!result.canceled && result.filePaths?.length > 0) {
                    if (window.desktopAPI.openPath) {
                        await window.desktopAPI.openPath(result.filePaths[0]);
                    }
                    return;
                }
            } catch (err) {
                console.error('Error opening folder dialog:', err);
            }
        } else if (window.desktopAPI?.getDocumentsPath && window.desktopAPI?.openPath) {
            try {
                const docs = await window.desktopAPI.getDocumentsPath();
                if (docs) {
                    await window.desktopAPI.openPath(docs);
                    return;
                }
            } catch (err) {
                console.error('Error opening folder:', err);
            }
        }
        openFileDialog();
    };

    document.getElementById('btn-hero-open')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openFileDialog();
    });

    document.getElementById('btn-open-projects-folder')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openFolderDialog();
    });

    const dropZone = document.getElementById('card-explorer-dropzone');
    dropZone?.addEventListener('click', (e) => {
        if (e.target.closest('#btn-open-projects-folder')) return;
        openFileDialog();
    });

    window.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    window.addEventListener('dragleave', (e) => {
        if (!e.relatedTarget || e.relatedTarget === document.documentElement) {
            dropZone.classList.remove('drag-over');
        }
    });

    window.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            const nativePath = (window.desktopAPI?.getPathForFile ? window.desktopAPI.getPathForFile(file) : file.path) || '';
            const p = nativePath || file.name;
            if (!nativePath) {
                openBrowserProjectFile(file);
            } else if (file.name.toLowerCase().endsWith('.mlst') || p.toLowerCase().endsWith('.mlst')) {
                openProjectByPath(p);
            }
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
        }
    });

    // Shared project type switcher for all project kinds.
    let activeProjectType = 'gui';
    const typeButtons = document.querySelectorAll('#new-proj-type-selector .type-option');
    const secGui = document.getElementById('new-proj-section-gui');
    const secCanvas = document.getElementById('new-proj-section-canvas');
    const newProjName = document.getElementById('new-proj-name');
    const newCanvasName = document.getElementById('new-canvas-name');

    typeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            activeProjectType = type;
            typeButtons.forEach(b => {
                const isSelected = b === btn;
                b.classList.toggle('active', isSelected);
                b.setAttribute('aria-selected', isSelected ? 'true' : 'false');
            });
            if (secGui) secGui.style.display = type === 'gui' ? 'block' : 'none';
            if (secCanvas) secCanvas.style.display = type === 'canvas' ? 'block' : 'none';
            for (const [projectType, section] of [['prefix','new-proj-section-prefix']]) {
                const element = document.getElementById(section);
                if (element) element.style.display = type === projectType ? 'block' : 'none';
            }
            if (type === 'gui') {
                newProjName?.focus();
            } else {
                if (['prefix'].includes(type)) document.getElementById(`new-${type}-name`)?.focus();
                    else newCanvasName?.focus();
            }
        });
    });

    const tplSelect = document.getElementById('new-proj-template');
    const updateTplVisibility = () => {
        const val = tplSelect?.value || '';
        const isVanillaContainer = val.startsWith('gui_container/');
        const frameGroup = document.getElementById('new-proj-frame-group');
        if (frameGroup) frameGroup.style.display = isVanillaContainer ? 'none' : '';
    };
    tplSelect?.addEventListener('change', updateTplVisibility);
    updateTplVisibility();

    // 3. Canvas presets and dimensions
    const newCanvasW = document.getElementById('new-canvas-w');
    const newCanvasH = document.getElementById('new-canvas-h');
    const btnNewCanvasLock = document.getElementById('btn-new-canvas-lock-aspect');
    let newCanvasAspectLocked = true;
    let newCanvasAspect = 1;

    btnNewCanvasLock?.addEventListener('click', () => {
        newCanvasAspectLocked = !newCanvasAspectLocked;
        btnNewCanvasLock.classList.toggle('active', newCanvasAspectLocked);
        btnNewCanvasLock.setAttribute('aria-pressed', String(newCanvasAspectLocked));
        if (newCanvasAspectLocked) {
            const w = parseInt(newCanvasW?.value, 10) || 32;
            const h = parseInt(newCanvasH?.value, 10) || 32;
            newCanvasAspect = w / Math.max(1, h);
        }
    });

    newCanvasW?.addEventListener('input', () => {
        if (newCanvasAspectLocked && newCanvasAspect) {
            const w = parseInt(newCanvasW.value, 10);
            if (w > 0) newCanvasH.value = Math.min(4096, Math.max(1, Math.round(w / newCanvasAspect)));
        }
        syncCanvasPresetSelection();
    });

    newCanvasH?.addEventListener('input', () => {
        if (newCanvasAspectLocked && newCanvasAspect) {
            const h = parseInt(newCanvasH.value, 10);
            if (h > 0) newCanvasW.value = Math.min(4096, Math.max(1, Math.round(h * newCanvasAspect)));
        }
        syncCanvasPresetSelection();
    });

    const syncCanvasPresetSelection = () => {
        document.querySelectorAll('#new-canvas-presets .preset-chip').forEach(chip => {
            const selected = Number(chip.dataset.w) === Number(newCanvasW?.value)
                && Number(chip.dataset.h) === Number(newCanvasH?.value);
            chip.classList.toggle('active', selected);
            chip.setAttribute('aria-pressed', String(selected));
        });
    };

    document.querySelectorAll('#new-canvas-presets .preset-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const w = chip.dataset.w;
            const h = chip.dataset.h;
            if (w && h) {
                if (newCanvasW) newCanvasW.value = w;
                if (newCanvasH) newCanvasH.value = h;
                newCanvasAspect = parseInt(w, 10) / parseInt(h, 10);
                syncCanvasPresetSelection();
            }
        });
    });

    const newInputs = [newProjName, newCanvasName, newCanvasW, newCanvasH, document.getElementById('new-prefix-name')];
    newInputs.forEach(input => {
        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('btn-create-project')?.click();
            }
        });
    });

    document.getElementById('btn-create-project')?.addEventListener('click', () => {
        let projectData;
        try {
            projectData = createProjectFromForm(document, activeProjectType);
        } catch (_) {
            newCanvasW?.reportValidity();
            newCanvasH?.reportValidity();
            if (!newCanvasW?.checkValidity()) newCanvasW?.focus();
            else newCanvasH?.focus();
            return;
        }
        closeModal();
        window.location.href = buildEditorUrl(projectData);
    });

    window.addEventListener('storage', event => {
        if (event.key === null || event.key === 'molly_recent'
            || event.key === LEGACY_DRAFT_KEY || event.key?.startsWith(PROJECT_DRAFT_PREFIX)) {
            renderRecentProjects();
        }
    });
    try {
        const recoveryChannel = new BroadcastChannel('molly_recovery_drafts');
        recoveryChannel.addEventListener('message', () => { void renderRecentProjects(); });
    } catch (_) {}
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startLauncher);
} else {
    startLauncher();
}
