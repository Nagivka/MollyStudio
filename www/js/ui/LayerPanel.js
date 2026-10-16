import { AddLayerCommand, RemoveLayerCommand, ReorderLayersCommand, MergeLayersCommand, FlattenLayersCommand, LayerPropertyCommand, LayerFXCommand, GroupLayersCommand, CompoundCommand } from '../core/Commands.js';

/**
 * LayerPanel - Clean, streamlined Material Design 3 Layer Manager.
 * Features layer thumbnails, quick actions, blend modes, opacity, live non-destructive FX,
 * layer groups/folders, multi-selection, and drag & drop reordering with complete Undo/Redo integration.
 */
export default class LayerPanel {
    constructor(bus, layerManager, history) {
        this.bus = bus;
        this.layerManager = layerManager;
        this.history = history;
        this.listElement = document.getElementById('layer-list');
        this.blendSelect = document.getElementById('layer-blend-mode');
        this.opacitySlider = document.getElementById('layer-opacity-slider');
        this.opacityNum = document.getElementById('layer-opacity-val');

        this.beforeOpacityVal = 1;
        this.activeFXLayer = null;
        this.initialEditingFX = null;

        this.bus.on('LAYER_ADDED', () => this.scheduleRender());
        this.bus.on('LAYER_REMOVED', () => this.scheduleRender());
        this.bus.on('LAYER_ORDER_CHANGED', () => this.scheduleRender());
        this.bus.on('LAYER_SELECTION_CHANGED', () => this.updateActiveHighlight());
        this.bus.on('LAYER_ACTIVE_CHANGED', () => {
            this.updateActiveHighlight();
            this.syncControlsWithActive();
            this.updateLayerNames();
        });
        this.bus.on('LAYER_NAME_CHANGED', (layer) => {
            if (!this.listElement || !layer) return;
            const li = this.layerElements?.get(layer.id);
            const nameEl = li?.querySelector('.layer-name');
            if (nameEl) nameEl.innerText = layer.name;
        });
        this.bus.on('CANVAS_UPDATED', () => {
            if (this.thumbnailsScheduled) return;
            this.thumbnailsScheduled = true;
            requestAnimationFrame(() => {
                this.thumbnailsScheduled = false;
                this.updateThumbnails();
            });
        });

        this.setupUI();
    }

    setupUI() {
        document.getElementById('btn-add-layer')?.addEventListener('click', () => {
            const newLayer = this.layerManager.addLayer();
            if (this.history && newLayer) {
                this.history.push(new AddLayerCommand(this.layerManager, newLayer));
            }
        });

        document.getElementById('btn-add-group')?.addEventListener('click', () => {
            const res = this.layerManager.groupSelectedLayers();
            if (res && this.history) {
                this.history.push(new GroupLayersCommand(this.layerManager, res.group, res.targets, res.oldOrder, res.oldGroupIds));
            }
        });

        // Close context menu on outside click or escape
        document.addEventListener('pointerdown', (e) => {
            if (!e.target.closest('#layer-context-menu')) {
                this.closeLayerContextMenu();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeLayerContextMenu();
            }
        });

        document.getElementById('btn-dup-layer')?.addEventListener('click', () => {
            const active = this.layerManager.getActiveLayer();
            if (active && !active.isBase) {
                this.duplicateLayer(active);
            }
        });

        document.getElementById('btn-del-layer')?.addEventListener('click', () => {
            const active = this.layerManager.getActiveLayer();
            if (active && !active.isBase) {
                this.deleteLayer(active);
            }
        });

        document.getElementById('btn-merge-down')?.addEventListener('click', () => {
            this.mergeDownActive();
        });

        document.getElementById('btn-layer-up')?.addEventListener('click', () => {
            const active = this.layerManager.getActiveLayer();
            if (active && !active.isBase) {
                const oldLayers = [...this.layerManager.layers];
                this.layerManager.moveLayer(active.id, 1);
                if (this.history) {
                    this.history.push(new ReorderLayersCommand(this.layerManager, oldLayers, this.layerManager.layers));
                }
            }
        });

        document.getElementById('btn-layer-down')?.addEventListener('click', () => {
            const active = this.layerManager.getActiveLayer();
            if (active && !active.isBase) {
                const oldLayers = [...this.layerManager.layers];
                this.layerManager.moveLayer(active.id, -1);
                if (this.history) {
                    this.history.push(new ReorderLayersCommand(this.layerManager, oldLayers, this.layerManager.layers));
                }
            }
        });

        this.blendSelect?.addEventListener('change', (e) => {
            const active = this.layerManager.getActiveLayer();
            if (!active) return;
            const oldMode = active.blendMode || 'source-over';
            const newMode = e.target.value;
            if (this.history) {
                this.history.push(new LayerPropertyCommand(active, 'blendMode', oldMode, newMode, this.bus));
            }
            active.blendMode = newMode;
            this.bus.emit('CANVAS_UPDATED');
        });

        this.opacitySlider?.addEventListener('focus', () => {
            const active = this.layerManager.getActiveLayer();
            if (active) this.beforeOpacityVal = active.opacity ?? 1;
        });
        this.opacitySlider?.addEventListener('pointerdown', () => {
            const active = this.layerManager.getActiveLayer();
            if (active) this.beforeOpacityVal = active.opacity ?? 1;
        });

        this.opacitySlider?.addEventListener('input', (e) => {
            const active = this.layerManager.getActiveLayer();
            if (!active) return;
            const val = parseInt(e.target.value, 10);
            active.opacity = val / 100;
            if (this.opacityNum) this.opacityNum.value = `${val}%`;
            this.bus.emit('CANVAS_UPDATED');
        });

        this.opacitySlider?.addEventListener('change', (e) => {
            const active = this.layerManager.getActiveLayer();
            if (!active) return;
            const newOp = parseInt(e.target.value, 10) / 100;
            if (this.history && this.beforeOpacityVal !== newOp) {
                this.history.push(new LayerPropertyCommand(active, 'opacity', this.beforeOpacityVal, newOp, this.bus));
            }
            this.beforeOpacityVal = newOp;
        });

        this.opacityNum?.addEventListener('change', (e) => {
            const active = this.layerManager.getActiveLayer();
            if (!active) return;
            const oldOp = active.opacity ?? 1;
            let val = parseInt(e.target.value.replace('%', ''), 10);
            val = Math.max(0, Math.min(100, isNaN(val) ? 100 : val));
            const newOp = val / 100;
            if (this.history && oldOp !== newOp) {
                this.history.push(new LayerPropertyCommand(active, 'opacity', oldOp, newOp, this.bus));
            }
            active.opacity = newOp;
            if (this.opacitySlider) this.opacitySlider.value = val;
            this.opacityNum.value = `${val}%`;
            this.bus.emit('CANVAS_UPDATED');
        });
    }

    mergeDownActive() {
        const active = this.layerManager.getActiveLayer();
        if (!active || active.isBase) return;

        const index = this.layerManager.layers.indexOf(active);
        if (index <= 0) return;

        const lowerLayer = this.layerManager.layers[index - 1];
        if (lowerLayer.isBase) return;

        const lowerBeforeData = lowerLayer.getImageData();
        const res = this.layerManager.mergeDown(active.id);

        if (res && this.history) {
            this.history.push(new MergeLayersCommand(
                this.layerManager,
                res.lowerLayer,
                lowerBeforeData,
                res.upperLayer,
                res.index
            ));
        }
    }

    flattenImage() {
        const res = this.layerManager.flattenImage();
        if (res && this.history) {
            this.history.push(new FlattenLayersCommand(this.layerManager, res.oldLayers, res.newLayers));
        }
    }

    syncControlsWithActive() {
        const active = this.layerManager.getActiveLayer();
        if (!active) return;

        if (this.blendSelect) {
            this.blendSelect.value = active.blendMode || 'source-over';
        }

        const opacityPercent = Math.round((active.opacity !== undefined ? active.opacity : 1) * 100);
        if (this.opacitySlider) {
            this.opacitySlider.value = opacityPercent;
        }
        if (this.opacityNum) {
            this.opacityNum.value = `${opacityPercent}%`;
        }
    }

    scheduleRender() {
        if (this.renderScheduled) return;
        this.renderScheduled = true;
        requestAnimationFrame(() => { this.renderScheduled = false; this.render(); });
    }

    beginRename(layer) {
        if (layer.isBase) return;
        const name = this.layerElements?.get(layer.id)?.querySelector('.layer-name');
        if (!name) return;
        const input = document.createElement('input');
        input.className = 'layer-rename-input';
        input.type = 'text';
        input.maxLength = 200;
        input.setAttribute('aria-label', 'Название слоя');
        input.value = layer.name;
        name.replaceWith(input);
        let finished = false;
        const finish = commit => {
            if (finished) return;
            finished = true;
            const value = input.value.trim() || layer.name;
            if (commit && value !== layer.name) {
                const command = new LayerPropertyCommand(layer, 'name', layer.name, value, this.bus);
                command.execute();
                this.history.push(command);
            }
            this.render();
            this.layerElements?.get(layer.id)?.focus();
        };
        input.addEventListener('blur', () => finish(true));
        input.addEventListener('keydown', event => {
            if (event.key === 'Escape' || event.key === 'Enter') {
                event.preventDefault(); event.stopPropagation(); finish(event.key === 'Enter');
            }
        });
        input.focus(); input.select();
    }

    ungroupLayer(group) {
        const children = this.layerManager.getGroupLayers(group.id);
        const commands = children.map(layer => new LayerPropertyCommand(layer, 'groupId', group.id, group.groupId || null, this.bus));
        commands.push(new RemoveLayerCommand(this.layerManager, group, this.layerManager.layers.indexOf(group)));
        const command = new CompoundCommand(commands);
        command.name = 'Разгруппировать';
        command.execute();
        this.history.push(command);
        this.render();
    }

    mkIcon(name) {
        const i = document.createElement('i');
        i.className = 'material-symbols-rounded';
        i.innerText = name;
        return i;
    }

    setAccessibleButtonName(button, name) {
        button.title = name;
        button.setAttribute('aria-label', name);
    }

    render() {
        if (!this.listElement) return;
        this.listElement.innerHTML = '';
        this.layerElements = new Map();
        this.listElement.setAttribute('role', 'listbox');
        this.listElement.setAttribute('aria-label', 'Слои проекта');
        this.listElement.setAttribute('aria-multiselectable', 'true');

        const layers = this.layerManager.getLayers();
        const activeLayer = this.layerManager.getActiveLayer();

        [...layers].reverse().forEach((layer) => {
            const visited = new Set([layer.id]);
            for (let parentId = layer.groupId; parentId; ) {
                if (visited.has(parentId)) return;
                visited.add(parentId);
                const parent = layers.find(group => group.id === parentId);
                if (!parent) break;
                if (!parent.expanded) return;
                parentId = parent.groupId;
            }

            const li = document.createElement('li');
            li.className = 'layer-item';
            li.dataset.id = layer.id;
            this.layerElements.set(layer.id, li);
            li.tabIndex = layer.id === activeLayer?.id ? 0 : -1;
            li.setAttribute('role', 'option');
            li.setAttribute('aria-selected', String(this.layerManager.isLayerSelected(layer.id)));
            li.setAttribute('aria-label', layer.name);
            li.addEventListener('keydown', event => {
                if (event.target !== li) return;
                const items = [...this.listElement.children];
                const index = items.indexOf(li);
                const nextIndex = event.key === 'ArrowDown' ? Math.min(items.length - 1, index + 1)
                    : event.key === 'ArrowUp' ? Math.max(0, index - 1)
                    : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1;
                if (nextIndex >= 0) {
                    event.preventDefault();
                    this.layerManager.selectLayer(items[nextIndex].dataset.id, false, event.shiftKey);
                    items[nextIndex].focus();
                } else if (event.key === 'F2') { event.preventDefault(); this.beginRename(layer); }
                else if (event.key === 'Delete') { event.preventDefault(); this.deleteLayer(layer); }
                else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.layerManager.selectLayer(layer.id, event.ctrlKey, false); }
            });
            if (activeLayer && layer.id === activeLayer.id) li.classList.add('active');
            if (this.layerManager.isLayerSelected(layer.id)) li.classList.add('selected');
            if (layer.groupId) li.classList.add('is-child');

            if (layer.isGroup) {
                li.classList.add('is-group');

                // Expand / Collapse Chevron Button
                const btnExpand = document.createElement('button');
                btnExpand.className = 'layer-group-chevron';
                this.setAccessibleButtonName(btnExpand, layer.expanded ? 'Свернуть папку' : 'Развернуть папку');
                const iconChev = this.mkIcon(layer.expanded ? 'keyboard_arrow_down' : 'chevron_right');
                btnExpand.appendChild(iconChev);
                btnExpand.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.layerManager.toggleGroupExpand(layer.id);
                    this.render();
                });
                li.appendChild(btnExpand);

                // Folder Icon
                const fIcon = this.mkIcon(layer.expanded ? 'folder_open' : 'folder');
                fIcon.className = 'material-symbols-rounded layer-folder-icon';
                li.appendChild(fIcon);

                // Group Name
                const nameSpan = document.createElement('span');
                nameSpan.className = 'layer-name';
                nameSpan.innerText = layer.name;
                nameSpan.title = 'Двойной клик для переименования папки';
                nameSpan.addEventListener('dblclick', e => { e.stopPropagation(); this.beginRename(layer); });
                li.appendChild(nameSpan);

                // Child count badge
                const childCount = layers.filter(l => l.groupId === layer.id).length;
                const countBadge = document.createElement('span');
                countBadge.className = 'layer-badge-count';
                countBadge.innerText = `${childCount}`;
                countBadge.title = `Слоев в папке: ${childCount}`;
                li.appendChild(countBadge);

                // Right indicators (Ungroup, Vis, Lock)
                const rightWrap = document.createElement('div');
                rightWrap.className = 'layer-right-indicators';

                const btnUngroup = document.createElement('button');
                btnUngroup.className = 'layer-btn';
                this.setAccessibleButtonName(btnUngroup, 'Разгруппировать и извлечь слои');
                btnUngroup.appendChild(this.mkIcon('folder_off'));
                btnUngroup.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.ungroupLayer(layer);
                });
                rightWrap.appendChild(btnUngroup);

                const btnVis = document.createElement('button');
                btnVis.className = 'layer-btn layer-vis-btn';
                this.setAccessibleButtonName(btnVis, layer.visible ? 'Скрыть папку' : 'Показать папку');
                const iconEye = this.mkIcon(layer.visible ? 'visibility' : 'visibility_off');
                btnVis.appendChild(iconEye);
                btnVis.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const oldVis = layer.visible;
                    const newVis = !oldVis;
                    if (this.history) {
                        this.history.push(new LayerPropertyCommand(layer, 'visible', oldVis, newVis, this.bus));
                    }
                    layer.visible = newVis;
                    iconEye.innerText = layer.visible ? 'visibility' : 'visibility_off';
                    this.setAccessibleButtonName(btnVis, layer.visible ? 'Скрыть папку' : 'Показать папку');
                    this.bus.emit('CANVAS_UPDATED');
                });
                rightWrap.appendChild(btnVis);

                const btnLock = document.createElement('button');
                btnLock.className = 'layer-btn';
                this.setAccessibleButtonName(btnLock, layer.locked ? 'Разблокировать папку' : 'Заблокировать папку');
                btnLock.style.opacity = layer.locked ? '1' : '0.4';
                const iconLock = this.mkIcon(layer.locked ? 'lock' : 'lock_open');
                btnLock.appendChild(iconLock);
                btnLock.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const oldLocked = !!layer.locked;
                    const newLocked = !oldLocked;
                    if (this.history) {
                        this.history.push(new LayerPropertyCommand(layer, 'locked', oldLocked, newLocked, this.bus));
                    }
                    layer.locked = newLocked;
                    btnLock.style.opacity = layer.locked ? '1' : '0.4';
                    iconLock.innerText = layer.locked ? 'lock' : 'lock_open';
                    this.setAccessibleButtonName(btnLock, layer.locked ? 'Разблокировать папку' : 'Заблокировать папку');
                    this.bus.emit('LAYER_ACTIVE_CHANGED', layer);
                    this.bus.emit('CANVAS_UPDATED');
                });
                rightWrap.appendChild(btnLock);

                const btnDel = document.createElement('button');
                btnDel.className = 'layer-btn layer-btn-delete';
                this.setAccessibleButtonName(btnDel, 'Удалить папку');
                btnDel.appendChild(this.mkIcon('delete'));
                btnDel.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteLayer(layer);
                });
                rightWrap.appendChild(btnDel);

                li.appendChild(rightWrap);
            } else {
                // Visibility Eye Button
                const btnVis = document.createElement('button');
                btnVis.className = 'layer-btn layer-vis-btn';
                this.setAccessibleButtonName(btnVis, layer.visible ? 'Скрыть слой' : 'Показать слой');
                const iconEye = this.mkIcon(layer.visible ? 'visibility' : 'visibility_off');
                btnVis.appendChild(iconEye);
                btnVis.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const oldVis = layer.visible;
                    const newVis = !oldVis;
                    if (this.history) {
                        this.history.push(new LayerPropertyCommand(layer, 'visible', oldVis, newVis, this.bus));
                    }
                    layer.visible = newVis;
                    iconEye.innerText = layer.visible ? 'visibility' : 'visibility_off';
                    this.setAccessibleButtonName(btnVis, layer.visible ? 'Скрыть слой' : 'Показать слой');
                    this.bus.emit('CANVAS_UPDATED');
                });

                // Live Thumbnail Preview
                const thumbImg = document.createElement('img');
                thumbImg.className = 'layer-thumb-img';
                thumbImg.src = layer.getThumbnailDataUrl();
                thumbImg.alt = layer.name;

                // Layer Name
                const nameSpan = document.createElement('span');
                nameSpan.className = 'layer-name';
                if (layer.isBase) nameSpan.classList.add('layer-base');
                nameSpan.innerText = layer.name;

                if (!layer.isBase) {
                    nameSpan.title = 'Двойной клик для переименования';
                    nameSpan.addEventListener('dblclick', e => { e.stopPropagation(); this.beginRename(layer); });
                }

                // Right Indicators (Lock Button + Delete Button directly on row)
                const rightWrap = document.createElement('div');
                rightWrap.className = 'layer-right-indicators';

                const btnLock = document.createElement('button');
                btnLock.className = 'layer-btn';
                this.setAccessibleButtonName(btnLock, layer.locked ? 'Разблокировать слой' : 'Заблокировать слой');
                btnLock.style.opacity = layer.locked ? '1' : '0.4';
                const iconLock = this.mkIcon(layer.locked ? 'lock' : 'lock_open');
                btnLock.appendChild(iconLock);

                btnLock.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const oldLocked = !!layer.locked;
                    const newLocked = !oldLocked;
                    if (this.history) {
                        this.history.push(new LayerPropertyCommand(layer, 'locked', oldLocked, newLocked, this.bus));
                    }
                    layer.locked = newLocked;
                    btnLock.style.opacity = layer.locked ? '1' : '0.4';
                    iconLock.innerText = layer.locked ? 'lock' : 'lock_open';
                    this.setAccessibleButtonName(btnLock, layer.locked ? 'Разблокировать слой' : 'Заблокировать слой');
                    this.bus.emit('LAYER_ACTIVE_CHANGED', layer);
                    this.bus.emit('CANVAS_UPDATED');
                });
                rightWrap.appendChild(btnLock);

                if (!layer.isBase) {
                    const btnDel = document.createElement('button');
                    btnDel.className = 'layer-btn layer-btn-delete';
                    this.setAccessibleButtonName(btnDel, 'Удалить слой');
                    btnDel.appendChild(this.mkIcon('delete'));
                    btnDel.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.deleteLayer(layer);
                    });
                    rightWrap.appendChild(btnDel);
                }

                li.appendChild(btnVis);
                li.appendChild(thumbImg);
                li.appendChild(nameSpan);
                li.appendChild(rightWrap);
            }

            // Click to select layer (supports Ctrl/Cmd multi-selection and Shift range)
            li.addEventListener('click', (e) => {
                this.layerManager.selectLayer(layer.id, e.ctrlKey || e.metaKey, e.shiftKey);
            });

            // Context Menu on Right Click (ПКМ плашка)
            li.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.layerManager.setActive(layer.id);
                this.openLayerContextMenu(e, layer);
            });

            // Drag & Drop Reordering
            if (!layer.isBase) {
                li.draggable = true;
                li.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', layer.id);
                    e.dataTransfer.effectAllowed = 'move';
                    li.style.opacity = '0.4';
                });
                li.addEventListener('dragend', () => {
                    li.style.opacity = '1';
                    document.querySelectorAll('.layer-item').forEach(item => {
                        item.classList.remove('drag-over-top', 'drag-over-bottom');
                    });
                });
                li.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    const rect = li.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    li.classList.toggle('drag-over-top', e.clientY < midY);
                    li.classList.toggle('drag-over-bottom', e.clientY >= midY);
                });
                li.addEventListener('dragleave', () => {
                    li.classList.remove('drag-over-top', 'drag-over-bottom');
                });
                li.addEventListener('drop', (e) => {
                    e.preventDefault();
                    const srcId = e.dataTransfer.getData('text/plain');
                    if (!srcId || srcId === layer.id) return;

                    const srcIndex = this.layerManager.layers.findIndex(l => l.id === srcId);
                    const targetIndex = this.layerManager.layers.findIndex(l => l.id === layer.id);
                    if (srcIndex === -1 || targetIndex === -1) return;

                    const rect = li.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    const insertAfter = e.clientY < midY; // in reversed list

                    const oldLayers = [...this.layerManager.layers];
                    const [moved] = this.layerManager.layers.splice(srcIndex, 1);
                    const oldGroupId = moved.groupId;

                    // Update group membership based on drop target
                    if (!moved.isGroup) {
                        if (layer.isGroup) {
                            moved.groupId = layer.id;
                        } else if (layer.groupId) {
                            moved.groupId = layer.groupId;
                        } else {
                            moved.groupId = null;
                        }
                    }

                    const newTargetIdx = this.layerManager.layers.findIndex(l => l.id === layer.id);
                    const finalIdx = insertAfter ? newTargetIdx + 1 : newTargetIdx;
                    const baseIndex = this.layerManager.layers.findIndex(l => l.isBase);
                    const minIndex = baseIndex !== -1 ? baseIndex + 1 : 0;
                    this.layerManager.layers.splice(Math.max(minIndex, finalIdx), 0, moved);

                    if (this.history) {
                        const command = new CompoundCommand([
                            new LayerPropertyCommand(moved, 'groupId', oldGroupId, moved.groupId, this.layerManager.bus),
                            new ReorderLayersCommand(this.layerManager, oldLayers, this.layerManager.layers)
                        ]);
                        command.name = 'Перемещение слоя';
                        this.history.push(command);
                    }

                    this.layerManager.bus.emit('LAYER_ORDER_CHANGED');
                    this.layerManager.bus.emit('CANVAS_UPDATED');
                });
            }

            this.listElement.appendChild(li);
        });

        this.syncControlsWithActive();
    }

    updateActiveHighlight() {
        const activeId = this.layerManager.activeLayerId;
        if (!this.listElement) return;
        this.listElement.querySelectorAll('.layer-item').forEach(li => {
            const id = li.dataset.id;
            li.classList.toggle('active', id === activeId);
            li.tabIndex = id === activeId ? 0 : -1;
            li.setAttribute('aria-selected', String(this.layerManager.isLayerSelected(id)));
            li.classList.toggle('selected', this.layerManager.isLayerSelected(id));
        });
    }

    updateLayerNames() {
        if (!this.listElement) return;
        this.layerManager.layers.forEach(layer => {
            const li = this.layerElements?.get(layer.id);
            const nameEl = li?.querySelector('.layer-name');
            if (nameEl && nameEl.innerText !== layer.name) {
                nameEl.innerText = layer.name;
            }
        });
    }

    updateThumbnails() {
        if (!this.listElement) return;
        const layers = this.layerManager.getLayers();
        layers.forEach(layer => {
            const li = this.layerElements?.get(layer.id);
            if (li) {
                const img = li.querySelector('.layer-thumb-img');
                if (img && layer.thumbNeedsUpdate) img.src = layer.getThumbnailDataUrl();
            }
        });
    }

    deleteLayer(layer) {
        if (!layer || layer.isBase) return;
        const idx = this.layerManager.layers.indexOf(layer);
        const command = new RemoveLayerCommand(this.layerManager, layer, idx);
        if (this.layerManager.removeLayer(layer.id)) {
            if (this.history) {
                this.history.push(command);
            }
        }
    }

    duplicateLayer(layer) {
        if (!layer || layer.isBase) return;
        const previous = new Set(this.layerManager.layers);
        const dup = this.layerManager.duplicateLayer(layer.id);
        if (this.history && dup) {
            const commands = this.layerManager.layers.filter(item => !previous.has(item)).map(item => new AddLayerCommand(this.layerManager, item));
            const command = new CompoundCommand(commands);
            command.name = 'Дублирование слоя';
            this.history.push(command);
        }
    }

    openLayerContextMenu(e, layer) {
        if (!layer) return;
        this.closeLayerContextMenu();

        const menu = document.getElementById('layer-context-menu');
        if (!menu) return;
        menu.innerHTML = '';

        // Header: thumbnail & title
        const header = document.createElement('div');
        header.className = 'm3-ctx-header';
        if (!layer.isGroup) {
            const thumb = document.createElement('img');
            thumb.className = 'm3-ctx-thumb';
            thumb.src = layer.getThumbnailDataUrl();
            header.appendChild(thumb);
        } else {
            const icon = this.mkIcon('folder');
            icon.className = 'material-symbols-rounded';
            icon.style.color = '#F59E0B';
            header.appendChild(icon);
        }
        const title = document.createElement('span');
        title.className = 'm3-ctx-title';
        title.innerText = layer.name;
        header.appendChild(title);
        menu.appendChild(header);

        if (!layer.isGroup) {
            // Blend Mode Block
            const blendBlock = document.createElement('div');
            blendBlock.className = 'm3-ctx-control-block';

            const blendLabel = document.createElement('span');
            blendLabel.className = 'm3-ctx-label';
            blendLabel.innerText = 'Режим наложения:';
            blendBlock.appendChild(blendLabel);

            const blendSelect = document.createElement('select');
            blendSelect.className = 'md-select md-select-mini';
            blendSelect.setAttribute('aria-label', 'Режим наложения');
            const modes = [
                { id: 'source-over', name: 'Обычный' },
                { id: 'multiply', name: 'Умножение' },
                { id: 'screen', name: 'Осветление' },
                { id: 'overlay', name: 'Перекрытие' },
                { id: 'darken', name: 'Затемнение' },
                { id: 'lighten', name: 'Замена светлым' },
                { id: 'color-dodge', name: 'Осветление основы' },
                { id: 'color-burn', name: 'Затемнение основы' },
                { id: 'hard-light', name: 'Жесткий свет' },
                { id: 'soft-light', name: 'Мягкий свет' },
                { id: 'difference', name: 'Разница' },
                { id: 'exclusion', name: 'Исключение' }
            ];
            modes.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.innerText = m.name;
                if ((layer.blendMode || 'source-over') === m.id) opt.selected = true;
                blendSelect.appendChild(opt);
            });
            blendSelect.addEventListener('change', (ev) => {
                const oldMode = layer.blendMode || 'source-over';
                const newMode = ev.target.value;
                if (this.history) {
                    this.history.push(new LayerPropertyCommand(layer, 'blendMode', oldMode, newMode, this.bus));
                }
                layer.blendMode = newMode;
                this.bus.emit('CANVAS_UPDATED');
            });
            blendBlock.appendChild(blendSelect);

            // Opacity slider
            const opRow = document.createElement('div');
            opRow.className = 'm3-ctx-row';
            const opLabel = document.createElement('span');
            opLabel.className = 'm3-ctx-label';
            opLabel.innerText = 'Непрозрачность:';
            const opVal = document.createElement('span');
            opVal.className = 'm3-ctx-label';
            const curOpPct = Math.round((layer.opacity ?? 1) * 100);
            opVal.innerText = `${curOpPct}%`;
            opVal.style.fontWeight = '600';
            opRow.appendChild(opLabel);
            opRow.appendChild(opVal);
            blendBlock.appendChild(opRow);

            const opSlider = document.createElement('input');
            opSlider.type = 'range';
            opSlider.className = 'md-slider md-slider-mini';
            opSlider.min = '0';
            opSlider.max = '100';
            opSlider.value = `${curOpPct}`;
            opSlider.setAttribute('aria-label', 'Непрозрачность слоя');
            let beforeOp = layer.opacity ?? 1;
            opSlider.addEventListener('focus', () => { beforeOp = layer.opacity ?? 1; });
            opSlider.addEventListener('pointerdown', () => { beforeOp = layer.opacity ?? 1; });
            opSlider.addEventListener('input', (ev) => {
                const v = parseInt(ev.target.value, 10);
                opVal.innerText = `${v}%`;
                layer.opacity = v / 100;
                this.bus.emit('CANVAS_UPDATED');
            });
            opSlider.addEventListener('change', (ev) => {
                const newOp = parseInt(ev.target.value, 10) / 100;
                if (this.history && beforeOp !== newOp) {
                    this.history.push(new LayerPropertyCommand(layer, 'opacity', beforeOp, newOp, this.bus));
                }
                beforeOp = newOp;
            });
            blendBlock.appendChild(opSlider);
            menu.appendChild(blendBlock);

            const div1 = document.createElement('div');
            div1.className = 'm3-ctx-divider';
            menu.appendChild(div1);
        }

        // Action: Duplicate layer
        if (!layer.isBase) {
            const btnDup = document.createElement('button');
            btnDup.className = 'm3-ctx-item';
            btnDup.type = 'button';
            btnDup.appendChild(this.mkIcon('content_copy'));
            const txtDup = document.createElement('span');
            txtDup.innerText = 'Копировать слой';
            btnDup.appendChild(txtDup);
            btnDup.addEventListener('click', () => {
                this.closeLayerContextMenu();
                this.duplicateLayer(layer);
            });
            menu.appendChild(btnDup);
        }

        // Action: Merge Down
        if (!layer.isBase && !layer.isGroup) {
            const btnMerge = document.createElement('button');
            btnMerge.className = 'm3-ctx-item';
            btnMerge.type = 'button';
            btnMerge.appendChild(this.mkIcon('call_merge'));
            const txtMerge = document.createElement('span');
            txtMerge.innerText = 'Слить со слоем ниже';
            btnMerge.appendChild(txtMerge);
            btnMerge.addEventListener('click', () => {
                this.closeLayerContextMenu();
                this.mergeDownActive();
            });
            menu.appendChild(btnMerge);
        }

        // Action: Rename layer
        const btnRename = document.createElement('button');
        btnRename.className = 'm3-ctx-item';
        btnRename.type = 'button';
        btnRename.appendChild(this.mkIcon('edit'));
        const txtRename = document.createElement('span');
        txtRename.innerText = 'Переименовать';
        btnRename.appendChild(txtRename);
        btnRename.addEventListener('click', () => {
            this.closeLayerContextMenu();
            this.beginRename(layer);
        });
        menu.appendChild(btnRename);

        // Action: Lock toggle
        const btnLock = document.createElement('button');
        btnLock.className = 'm3-ctx-item';
        btnLock.type = 'button';
        btnLock.appendChild(this.mkIcon(layer.locked ? 'lock_open' : 'lock'));
        const txtLock = document.createElement('span');
        txtLock.innerText = layer.locked ? 'Разблокировать' : 'Заблокировать';
        btnLock.appendChild(txtLock);
        btnLock.addEventListener('click', () => {
            this.closeLayerContextMenu();
            const oldLocked = !!layer.locked;
            const newLocked = !oldLocked;
            if (this.history) {
                this.history.push(new LayerPropertyCommand(layer, 'locked', oldLocked, newLocked, this.bus));
            }
            layer.locked = newLocked;
            this.bus.emit('LAYER_ACTIVE_CHANGED', layer);
            this.bus.emit('CANVAS_UPDATED');
            this.render();
        });
        menu.appendChild(btnLock);

        // Action: Delete layer
        if (!layer.isBase) {
            const div2 = document.createElement('div');
            div2.className = 'm3-ctx-divider';
            menu.appendChild(div2);

            const btnDel = document.createElement('button');
            btnDel.className = 'm3-ctx-item destructive';
            btnDel.type = 'button';
            btnDel.appendChild(this.mkIcon('delete'));
            const txtDel = document.createElement('span');
            txtDel.innerText = layer.isGroup ? 'Удалить папку' : 'Удалить слой';
            btnDel.appendChild(txtDel);
            btnDel.addEventListener('click', () => {
                this.closeLayerContextMenu();
                this.deleteLayer(layer);
            });
            menu.appendChild(btnDel);
        }

        // Show and position menu
        menu.style.display = 'flex';
        menu.classList.add('show');
        menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Действия со слоем');
        menu.querySelectorAll('button').forEach(button => { button.setAttribute('role', 'menuitem'); button.tabIndex = -1; });
        menu.onkeydown = event => {
            // Embedded native controls own their adjustment keys; Escape still closes the menu.
            if (event.target.closest('input, select, textarea') && !['Escape', 'Tab'].includes(event.key)) return;
            const items = [...menu.querySelectorAll('[role="menuitem"]')];
            const index = items.indexOf(document.activeElement);
            let next;
            if (event.key === 'ArrowDown') next = items[(index + 1) % items.length];
            else if (event.key === 'ArrowUp') next = items[(index - 1 + items.length) % items.length];
            else if (event.key === 'Home') next = items[0];
            else if (event.key === 'End') next = items.at(-1);
            else if (event.key === 'Escape' || event.key === 'Tab') { this.closeLayerContextMenu(); this.layerElements?.get(layer.id)?.focus(); }
            if (next) { event.preventDefault(); next.focus(); }
        };
        const menuRect = menu.getBoundingClientRect();
        let left = e.clientX;
        let top = e.clientY;
        if (left + menuRect.width > window.innerWidth - 10) {
            left = window.innerWidth - menuRect.width - 10;
        }
        if (top + menuRect.height > window.innerHeight - 10) {
            top = window.innerHeight - menuRect.height - 10;
        }
        menu.style.left = `${Math.max(10, left)}px`;
        menu.style.top = `${Math.max(10, top)}px`;
    }

    closeLayerContextMenu() {
        const menu = document.getElementById('layer-context-menu');
        if (menu) { menu.classList.remove('show'); menu.style.display = 'none'; }
    }
}
