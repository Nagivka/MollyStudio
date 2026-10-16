import { readProjectThumbnail, writeProjectThumbnail } from './core/ProjectThumbnailCache.mjs';
import UtilitiesPanel from './ui/UtilitiesPanel.js';
import './core/DesktopBridge.js';
import SettingsManager from './core/SettingsManager.js';
import SettingsModal from './ui/SettingsModal.js';
import EventBus from './core/EventBus.js';
import { initRippleEffect } from './ui/Ripple.js';
import { confirmDialog } from './ui/ConfirmDialog.js';
import { installKeyboardNavigation } from './ui/KeyboardNavigation.js';
import { buildEditorUrl, createProjectFromForm } from './core/ProjectFactory.mjs';
import { LEGACY_DRAFT_KEY, PROJECT_DRAFT_PREFIX } from './core/ProjectDraftStore.mjs';
import { deleteRecoveryDraft, listRecoveryDrafts } from './core/RecoveryDraftStore.mjs';

/**
 * MollyStudio - Material Design 3 Launcher Logic with Settings synchronization
 */

function startLauncher() {
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
        textElement.textContent = message;
        toast.append(iconElement, textElement);
        container.append(toast);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 220);
        }, 3000);
    };

    try {
        window.electronAPI?.updateDiscordPresence?.({
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
            const themes = ['dark', 'oled', 'midnight', 'forest', 'amethyst', 'light', 'light-nord', 'light-warm', 'light-rose', 'light-mint'];
            const idx = themes.indexOf(cur);
            const next = themes[(idx + 1) % themes.length];
            settingsManager.set('theme', next);
        });
    }

    const btnSettings = document.getElementById('btn-open-settings');
    if (btnSettings) {
        btnSettings.addEventListener('click', () => {
            if (window.electronAPI?.openSettingsWindow) {
                window.electronAPI.openSettingsWindow();
            } else {
                settingsModal.open();
            }
        });
    }

    // Handle project created from separate New Project window
    window.electronAPI?.onProjectCreated?.((projectData) => {
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
            btnWinMax.title = isMax ? 'Восстановить окно' : 'Развернуть';
            btnWinMax.setAttribute('aria-label', isMax ? 'Восстановить' : 'Развернуть');
        }
    };

    const handleWinMin = (e) => {
        e?.stopPropagation?.();
        if (window.electronAPI?.minimize) window.electronAPI.minimize();
        else if (window.DesktopBridge?.minimize) window.DesktopBridge.minimize();
    };

    const handleWinMax = async (e) => {
        e?.stopPropagation?.();
        let isMax = false;
        if (window.electronAPI?.maximize) {
            isMax = await window.electronAPI.maximize();
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
        if (window.electronAPI?.close) window.electronAPI.close();
        else if (window.DesktopBridge?.close) window.DesktopBridge.close();
        else window.close();
    };

    btnWinMin?.addEventListener('click', handleWinMin);
    btnWinMax?.addEventListener('click', handleWinMax);
    btnWinClose?.addEventListener('click', handleWinClose);

    if (window.electronAPI?.onWindowStateChange) {
        window.electronAPI.onWindowStateChange((isMax) => {
            updateMaxUI(isMax);
        });
    }
    window.electronAPI?.isMaximized?.()?.then?.((isMax) => {
        updateMaxUI(!!isMax);
    })?.catch?.(() => {});

    document.addEventListener('fullscreenchange', () => {
        if (!window.electronAPI) {
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
                    preview = await createProjectThumbnail(entry.draft.project);
                } else {
                    if (!previewCache.has(key)) {
                        previewCache.set(key, (async () => {
                            const cached = await readProjectThumbnail(entry.path, entry.previewRevision);
                            if (cached) return cached;
                            if (!window.electronAPI?.readFile) return null;
                            const text = await window.electronAPI.readFile(entry.path);
                            if (typeof text !== 'string' || text.length > 64 * 1024 * 1024) return null;
                            const { createProjectThumbnail } = await import('./ui/ProjectThumbnail.js');
                            const result = await createProjectThumbnail(JSON.parse(text));
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
                card.querySelector('.launcher-preview-type').textContent += ' · ' + preview.width + ' × ' + preview.height;
                card.dataset.preview = 'ready';
            } catch (_) {
                if (card.isConnected) card.querySelector('.launcher-preview-message').textContent = 'Предпросмотр недоступен';
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
        const query = (search?.value || '').trim().toLocaleLowerCase('ru');
        const entries = [
            ...drafts.map(item => ({ ...item, name: item.draft.project.name || 'Несохранённый проект', type: item.draft.project.type, order: item.timestamp || 0 })),
            ...recent.map((item, index) => ({ ...item, order: item.modifiedAt || recent.length - index }))
        ].filter(item => !query || (item.name + ' ' + (item.path || '')).toLocaleLowerCase('ru').includes(query));
        entries.sort((a, b) => sort?.value === 'name' ? String(a.name).localeCompare(String(b.name), 'ru') : b.order - a.order);
        recentCountChip.textContent = entries.length + ' ' + getNounPlural(entries.length, 'проект', 'проекта', 'проектов');
        btnClearRecent.disabled = !recent.length;
        recentList.replaceChildren();
        if (!entries.length) {
            const empty = document.createElement('div'); empty.className = 'm3-empty-recent';
            empty.innerHTML = '<i class="material-symbols-rounded" aria-hidden="true">' + (query ? 'search_off' : 'folder_open') + '</i><h4>' + (query ? 'Проекты не найдены' : 'Здесь будут ваши проекты') + '</h4><p>' + (query ? 'Попробуйте другое название или путь к файлу.' : 'Создайте проект или откройте файл .mlst. Здесь появится его настоящее превью.') + '</p>';
            recentList.append(empty); return;
        }
        for (const entry of entries) {
            const draft = Boolean(entry.draft);
            const name = entry.name || 'Без названия';
            const type = entry.type === 'deluxemenu' ? 'Меню' : entry.type === 'prefix' ? 'Префиксы' : entry.type === 'canvas' ? 'Холст' : 'GUI';
            const date = draft ? 'Автокопия · ' + new Date(entry.timestamp || Date.now()).toLocaleString('ru', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : entry.updatedAt || 'Локальный проект';
            const card = document.createElement('article'); card.className = 'm3-recent-card' + (draft ? ' unsaved-draft-card' : '');card.setAttribute('role', 'group');card.setAttribute('aria-label', name);card.dataset.name = name;
            card.innerHTML = '<button class="m3-recent-open" type="button" aria-label="' + (draft ? 'Восстановить ' : 'Открыть ') + escapeHtml(name) + '"><span class="launcher-project-preview"><span class="launcher-preview-placeholder"><i class="material-symbols-rounded" aria-hidden="true">' + (draft ? 'history' : 'image') + '</i><span class="launcher-preview-message">Загрузка превью…</span></span><span class="launcher-preview-type">' + type + '</span></span><span class="m3-recent-info"><span class="m3-recent-title-row"><span class="m3-recent-name">' + escapeHtml(name) + '</span>' + (draft ? '<span class="m3-type-badge unsaved">Автокопия</span>' : '') + '</span><span class="launcher-project-date">' + escapeHtml(date) + '</span><span class="m3-recent-path" title="' + escapeHtml(entry.path || '') + '">' + escapeHtml(entry.path || 'Несохранённый проект') + '</span></span></button><div class="m3-recent-actions">' + (!draft ? '<button class="m3-icon-action-btn open-folder" type="button" title="Показать в проводнике" aria-label="Показать проект в проводнике"><i class="material-symbols-rounded" aria-hidden="true">folder_open</i></button>' : '') + '<button class="m3-icon-action-btn ' + (draft ? 'delete-draft' : 'delete-proj') + '" type="button" title="' + (draft ? 'Удалить автокопию' : 'Убрать из недавних') + '" aria-label="' + (draft ? 'Удалить автокопию ' : 'Убрать из недавних ') + escapeHtml(name) + '"><i class="material-symbols-rounded" aria-hidden="true">close</i></button></div>';
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
        if (window.electronAPI?.openNewProjectWindow) {
            window.electronAPI.openNewProjectWindow();
        } else {
            openModal();
        }
    });

    const isNativeDesktop = Boolean(window.electronAPI || (window.DesktopBridge && window.DesktopBridge.isNative?.()));

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
            const bridge = window.DesktopBridge || window.electronAPI;
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
        if (window.electronAPI?.showOpenDialog) {
            try {
                const result = await window.electronAPI.showOpenDialog({
                    title: 'Выберите папку с проектами',
                    properties: ['openDirectory']
                });
                if (!result.canceled && result.filePaths?.length > 0) {
                    if (window.electronAPI.openPath) {
                        await window.electronAPI.openPath(result.filePaths[0]);
                    }
                    return;
                }
            } catch (err) {
                console.error('Error opening folder dialog:', err);
            }
        } else if (window.electronAPI?.getDocumentsPath && window.electronAPI?.openPath) {
            try {
                const docs = await window.electronAPI.getDocumentsPath();
                if (docs) {
                    await window.electronAPI.openPath(docs);
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
            const p = (window.electronAPI?.getPathForFile ? window.electronAPI.getPathForFile(file) : file.path) || file.name;
            if (!isNativeDesktop && !file.path) {
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
            for (const [projectType, section] of [['prefix','new-proj-section-prefix'],['deluxemenu','new-proj-section-deluxemenu']]) {
                const element = document.getElementById(section);
                if (element) element.style.display = type === projectType ? 'block' : 'none';
            }
            if (type === 'gui') {
                newProjName?.focus();
            } else if (type === 'deluxemenu') {
                document.getElementById('new-deluxemenu-name')?.focus();
            } else {
                if (type === 'prefix') document.getElementById('new-prefix-name')?.focus();
                    else newCanvasName?.focus();
            }
        });
    });

    const tplSelect = document.getElementById('new-proj-template');
    const updateTplVisibility = () => {
        const val = tplSelect?.value || '';
        const isVanillaContainer = val.startsWith('gui_container/');
        const frameGroup = document.getElementById('new-proj-frame-group');
        if (frameGroup) frameGroup.style.display = isVanillaContainer ? 'none' : 'block';
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

    const newInputs = [newProjName, newCanvasName, newCanvasW, newCanvasH, document.getElementById('new-prefix-name'), document.getElementById('new-deluxemenu-name')];
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
