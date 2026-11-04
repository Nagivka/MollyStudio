import {bindAttribute, bindText} from '../core/Locale.mjs';
import { AddLayerCommand, RemoveLayerCommand, ReorderLayersCommand, MergeLayersCommand, FlattenLayersCommand, LayerPropertyCommand, LayerFXCommand, GroupLayersCommand, CompoundCommand } from '../core/Commands.js';
import { LAYER_LABELS, normalizeLayerLabel, planLayerDrop } from '../core/LayerOrganization.mjs';
import { isObjectLocked } from '../core/ObjectProperties.mjs';
import {safeBlendMode} from '../graphics/LayerCompositing.js';

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

        this.opacityCommand = null;
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
        this.setupOrganization();
    }

    setupOrganization() {
        const toolbar = document.getElementById('btn-add-layer')?.parentElement;
        if (!toolbar || !this.listElement) return;
        this.isolateButton = document.createElement('button');
        this.isolateButton.className = 'md-icon-btn'; this.isolateButton.type = 'button';
        this.isolateButton.id = 'btn-isolate-layer';
        this.setAccessibleButtonName(this.isolateButton, 'Изолировать слой или группу');
        this.isolateButton.append(this.mkIcon('filter_center_focus'));
        this.isolateButton.addEventListener('click', () => this.layerManager.toggleIsolation());
        toolbar.append(this.isolateButton);
        this.isolationNotice = document.createElement('div');
        this.isolationNotice.className = 'isolation-notice'; this.isolationNotice.hidden = true;
        const text = document.createElement('span'); bindText(text, 'Изоляция: остальные объекты временно скрыты.');
        const exit = document.createElement('button'); exit.className = 'md-btn outlined'; exit.type = 'button';
        bindText(exit, 'Показать всё'); exit.addEventListener('click', () => this.layerManager.toggleIsolation(this.layerManager.isolatedLayerId));
        this.isolationNotice.append(text, exit); this.listElement.before(this.isolationNotice);
        this.bus.on('ISOLATION_CHANGED', () => this.updateActiveHighlight());
    }

    setupUI() {
        document.getElementById('layer-search')?.addEventListener('input',()=>this.scheduleRender());
        document.getElementById('layer-type-filter')?.addEventListener('change',()=>this.render());
        document.getElementById('btn-add-layer')?.addEventListener('click', () => {
            this.addLayer();
        });

        document.getElementById('btn-add-group')?.addEventListener('click', () => {
            if (!this.finishEditing()) return;
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
            if (!this.finishEditing()) return;
            const active = this.layerManager.getActiveLayer();
            if (active && !active.isBase) {
                const oldLayers = [...this.layerManager.layers];
                const changed=this.layerManager.moveLayer(active.id, 1);
                if (changed && this.history) {
                    this.history.push(new ReorderLayersCommand(this.layerManager, oldLayers, this.layerManager.layers));
                }
            }
        });

        document.getElementById('btn-layer-down')?.addEventListener('click', () => {
            if (!this.finishEditing()) return;
            const active = this.layerManager.getActiveLayer();
            if (active && !active.isBase) {
                const oldLayers = [...this.layerManager.layers];
                const changed=this.layerManager.moveLayer(active.id, -1);
                if (changed && this.history) {
                    this.history.push(new ReorderLayersCommand(this.layerManager, oldLayers, this.layerManager.layers));
                }
            }
        });

        this.blendSelect?.addEventListener('change', (e) => {
            const active = this.layerManager.getActiveLayer();
            this.setProperty(active,'blendMode',e.target.value);this.syncControlsWithActive();
        });

        this.opacitySlider?.addEventListener('focus', () => {
            this.opacityCommand=null;
        });
        this.opacitySlider?.addEventListener('pointerdown', () => {
            this.opacityCommand=null;
        });

        this.opacitySlider?.addEventListener('input', (e) => {
            const active = this.layerManager.getActiveLayer();
            if (!active) return;
            this.opacityCommand=this.setProperty(active,'opacity',Number(e.target.value)/100,this.opacityCommand);
            this.syncControlsWithActive();
        });

        this.opacitySlider?.addEventListener('change', (e) => {
            const active = this.layerManager.getActiveLayer();
            if (!active) return;
            this.setProperty(active,'opacity',Number(e.target.value)/100,this.opacityCommand);this.opacityCommand=null;
        });

        this.opacityNum?.addEventListener('change', (e) => {
            if (!this.finishEditing()) { this.syncControlsWithActive(); return; }
            const active = this.layerManager.getActiveLayer();
            if (!active) return;
            const raw=e.target.value.trim().replace(/%$/,'').trim(),val=Number(raw);
            if(!/^\d{1,3}$/.test(raw)||val>100){
                this.syncControlsWithActive();globalThis.window?.mollyEditor?.showToast?.('Непрозрачность: целое число от 0 до 100.','warning');return;
            }
            const newOp = val / 100;
            this.setProperty(active,'opacity',newOp);this.syncControlsWithActive();
        });
    }

    finishEditing() {
        return globalThis.window?.mollyEditor?.tools?.finishDocument?.({preserveSelection:true}) !== false;
    }

    setProperty(layer,key,value,pending=null) {
        if(!layer||!this.finishEditing()||!this.layerManager.layers.includes(layer))return null;
        if(['opacity','blendMode'].includes(key)&&(isObjectLocked(layer,this.layerManager.layers)||this.layerManager.isInIsolation?.(layer.id)===false))return null;
        if(key==='opacity'&&(!Number.isFinite(value)||value<0||value>1))return null;
        if(key==='blendMode'&&safeBlendMode(value)!==value)return null;
        if(layer[key]===value)return pending;
        // A live slider has a valid undo step from its first change, including
        // when its menu is closed before a native `change` event is delivered.
        if(pending&&pending.layer===layer&&pending.property===key&&this.history?.undoStack.at(-1)===pending){
            layer[key]=value;pending.newValue=value;this.bus.emit('CANVAS_UPDATED');return pending;
        }
        const command=new LayerPropertyCommand(layer,key,layer[key],value,this.bus);
        command.execute();this.history?.push(command);return command;
    }

    addLayer() {
        if (!this.finishEditing()) return null;
        const layer = this.layerManager.addLayer();
        if (layer && this.history) this.history.push(new AddLayerCommand(this.layerManager, layer));
        return layer;
    }

    mergeDownActive() {
        if (!this.finishEditing()) return;
        const active = this.layerManager.getActiveLayer();
        if (!active || active.isBase) return;

        const index = this.layerManager.layers.indexOf(active);
        if (index <= 0) return;

        const lowerLayer = this.layerManager.layers[index - 1];
        if (lowerLayer.isBase) return;

        let res;
        try { res = this.layerManager.mergeDown(active.id); }
        catch (error) {
            console.error('Не удалось объединить слои:', error);
            globalThis.window?.mollyEditor?.showToast?.('Не удалось объединить слои. Повторите действие.', 'error');
            return null;
        }

        if (res && this.history) {
            this.history.push(new MergeLayersCommand(
                this.layerManager,
                res.lowerLayer,
                res.before,
                res.upperLayer,
                res.index,
                res.after
            ));
        }
    }

    flattenImage() {
        if (!this.finishEditing()) return;
        let res;
        try{res=this.layerManager.flattenImage();}
        catch(error){console.error('Не удалось свести слои:',error);globalThis.window?.mollyEditor?.showToast?.('Не удалось свести слои. Исходные слои сохранены.','error');return null;}
        if (res && this.history) {
            this.history.push(new FlattenLayersCommand(this.layerManager, res.oldLayers, res.newLayers));
        }
    }

    syncControlsWithActive() {
        const active = this.layerManager.getActiveLayer();
        const disabled=!active||isObjectLocked(active,this.layerManager.layers)||this.layerManager.isInIsolation?.(active.id)===false;
        for(const input of [this.blendSelect,this.opacitySlider,this.opacityNum])if(input)input.disabled=disabled;
        if (!active) return;

        if (this.blendSelect) {
            const mode=active.blendMode||'source-over';
            for(const option of this.blendSelect.querySelectorAll('[data-file-blend]'))if(option.value!==mode)option.remove();
            if(![...this.blendSelect.options].some(option=>option.value===mode)){
                const option=document.createElement('option');option.dataset.fileBlend='true';option.value=mode;bindText(option, 'Режим из файла');this.blendSelect.append(option);
            }
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
        if (layer.isBase || !this.finishEditing()) return;
        const name = this.layerElements?.get(layer.id)?.querySelector('.layer-name');
        if (!name) return;
        const input = document.createElement('input');
        input.className = 'layer-rename-input';
        input.type = 'text';
        input.maxLength = 200;
        bindAttribute(input, "aria-label", 'Название слоя');
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
        if(!group||isObjectLocked(group,this.layerManager.layers)||!this.finishEditing())return;
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
        bindAttribute(button, 'title', name);
        bindAttribute(button, 'aria-label', name);
    }

    render() {
        if (!this.listElement) return;
        this.listElement.innerHTML = '';
        this.layerElements = new Map();
        this.listElement.setAttribute('role', 'listbox');
        bindAttribute(this.listElement, "aria-label", 'Слои проекта');
        this.listElement.setAttribute('aria-multiselectable', 'true');

        const layers = this.layerManager.getLayers();
        const activeLayer = this.layerManager.getActiveLayer();
        const byId=new Map(layers.map(layer=>[layer.id,layer]));
        const childCounts=new Map();for(const item of layers)childCounts.set(item.groupId,(childCounts.get(item.groupId)||0)+1);
        const query=document.getElementById('layer-search')?.value.trim().toLocaleLowerCase()||'';
        const type=document.getElementById('layer-type-filter')?.value||'all';
        const filtering=Boolean(query||type!=='all');

        [...layers].reverse().forEach((layer) => {
            if(query&&!`${layer.name||''} ${layer.textData?.text||''}`.toLocaleLowerCase().includes(query))return;
            if(type!=='all'&&(layer.isGroup?'group':layer.type)!==type)return;
            const visited = new Set([layer.id]);
            for (let parentId = layer.groupId; parentId; ) {
                if (visited.has(parentId)) return;
                visited.add(parentId);
                const parent = byId.get(parentId);
                if (!parent) break;
                if (!filtering&&!parent.expanded) return;
                parentId = parent.groupId;
            }

            const li = document.createElement('li');
            li.className = 'layer-item';
            li.dataset.id = layer.id;
            li.style.setProperty('--layer-label-color', LAYER_LABELS[normalizeLayerLabel(layer.colorLabel)][1]);
            li.classList.add('layer-labelled');
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
                    if (!this.finishEditing()) return;
                    this.layerManager.selectLayer(items[nextIndex].dataset.id, false, event.shiftKey);
                    items[nextIndex].focus();
                } else if (event.key === 'F2') { event.preventDefault(); this.beginRename(layer); }
                else if (event.key === 'Delete') { event.preventDefault(); this.deleteLayer(layer); }
                else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if(this.finishEditing())this.layerManager.selectLayer(layer.id, event.ctrlKey || event.metaKey, false); }
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
                bindAttribute(nameSpan, "title", 'Двойной клик для переименования папки');
                nameSpan.addEventListener('dblclick', e => { e.stopPropagation(); this.beginRename(layer); });
                li.appendChild(nameSpan);

                // Child count badge
                const childCount = childCounts.get(layer.id)||0;
                const countBadge = document.createElement('span');
                countBadge.className = 'layer-badge-count';
                countBadge.innerText = `${childCount}`;
                bindAttribute(countBadge, "title", "Слоев в папке: {0}", {0: childCount});
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
                btnVis.dataset.layerProperty='visible';
                btnVis.className = 'layer-btn layer-vis-btn';
                this.setAccessibleButtonName(btnVis, layer.visible ? 'Скрыть папку' : 'Показать папку');
                const iconEye = this.mkIcon(layer.visible ? 'visibility' : 'visibility_off');
                btnVis.appendChild(iconEye);
                btnVis.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!this.finishEditing()) return;
                    const oldVis = layer.visible;
                    const newVis = !oldVis;
                    if(!this.setProperty(layer,'visible',newVis))return;
                    iconEye.innerText = layer.visible ? 'visibility' : 'visibility_off';
                    this.setAccessibleButtonName(btnVis, layer.visible ? 'Скрыть папку' : 'Показать папку');
                    this.bus.emit('CANVAS_UPDATED');
                });
                rightWrap.appendChild(btnVis);

                const btnLock = document.createElement('button');
                btnLock.dataset.layerProperty='locked';
                btnLock.className = 'layer-btn';
                this.setAccessibleButtonName(btnLock, layer.locked ? 'Разблокировать папку' : 'Заблокировать папку');
                btnLock.style.opacity = layer.locked ? '1' : '0.4';
                const iconLock = this.mkIcon(layer.locked ? 'lock' : 'lock_open');
                btnLock.appendChild(iconLock);
                btnLock.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!this.finishEditing()) return;
                    const oldLocked = !!layer.locked;
                    const newLocked = !oldLocked;
                    if(!this.setProperty(layer,'locked',newLocked))return;
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
                btnVis.dataset.layerProperty='visible';
                btnVis.className = 'layer-btn layer-vis-btn';
                this.setAccessibleButtonName(btnVis, layer.visible ? 'Скрыть слой' : 'Показать слой');
                const iconEye = this.mkIcon(layer.visible ? 'visibility' : 'visibility_off');
                btnVis.appendChild(iconEye);
                btnVis.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!this.finishEditing()) return;
                    const oldVis = layer.visible;
                    const newVis = !oldVis;
                    if(!this.setProperty(layer,'visible',newVis))return;
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
                    bindAttribute(nameSpan, "title", 'Двойной клик для переименования');
                    nameSpan.addEventListener('dblclick', e => { e.stopPropagation(); this.beginRename(layer); });
                }

                // All row actions reuse the same undoable operations as the menu.
                const rightWrap = document.createElement('div');
                rightWrap.className = 'layer-right-indicators';
                if(!layer.isBase)for(const [action,label,icon,run] of [['rename','Переименовать','edit',()=>this.beginRename(layer)],['duplicate','Дублировать слой','content_copy',()=>this.duplicateLayer(layer)]]){
                    const button=document.createElement('button');button.type='button';button.className='layer-btn';button.dataset.layerQuickAction=action;
                    this.setAccessibleButtonName(button,label);button.append(this.mkIcon(icon));button.addEventListener('click',event=>{event.stopPropagation();if(this.finishEditing())run();});rightWrap.append(button);
                }

                const btnLock = document.createElement('button');
                btnLock.dataset.layerProperty='locked';
                btnLock.className = 'layer-btn';
                this.setAccessibleButtonName(btnLock, layer.locked ? 'Разблокировать слой' : 'Заблокировать слой');
                btnLock.style.opacity = layer.locked ? '1' : '0.4';
                const iconLock = this.mkIcon(layer.locked ? 'lock' : 'lock_open');
                btnLock.appendChild(iconLock);

                btnLock.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!this.finishEditing()) return;
                    const oldLocked = !!layer.locked;
                    const newLocked = !oldLocked;
                    if(!this.setProperty(layer,'locked',newLocked))return;
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
                if (!this.finishEditing()) return;
                this.layerManager.selectLayer(layer.id, e.ctrlKey || e.metaKey, e.shiftKey);
            });

            // Context Menu on Right Click (ПКМ плашка)
            li.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!this.finishEditing()) return;
                this.layerManager.setActive(layer.id);
                this.openLayerContextMenu(e, layer);
            });

            // Drag & Drop Reordering
            if (!layer.isBase) {
                li.draggable = true;
                li.addEventListener('dragstart', (e) => {
                    if (!this.finishEditing()) { e.preventDefault(); return; }
                    e.dataTransfer.setData('text/plain', layer.id);
                    e.dataTransfer.effectAllowed = 'move';
                    li.style.opacity = '0.4';
                });
                li.addEventListener('dragend', () => {
                    li.style.opacity = '1';
                    document.querySelectorAll('.layer-item').forEach(item => {
                        item.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-inside');
                    });
                });
                li.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    const rect = li.getBoundingClientRect();
                    const ratio = (e.clientY - rect.top) / rect.height;
                    const inside = layer.isGroup && ratio >= .25 && ratio <= .75;
                    li.classList.toggle('drag-over-inside', inside);
                    li.classList.toggle('drag-over-top', !inside && ratio < .5);
                    li.classList.toggle('drag-over-bottom', !inside && ratio >= .5);
                });
                li.addEventListener('dragleave', (event) => {
                    if (!li.contains(event.relatedTarget)) li.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-inside');
                });
                li.addEventListener('drop', (e) => {
                    e.preventDefault();
                    if (!this.finishEditing()) return;
                    const srcId = e.dataTransfer.getData('text/plain');
                    if (!srcId || srcId === layer.id) return;

                    const rect = li.getBoundingClientRect();
                    const ratio = (e.clientY - rect.top) / rect.height;
                    const position = layer.isGroup && ratio >= .25 && ratio <= .75 ? 'inside' : ratio < .5 ? 'above' : 'below';
                    const plan = planLayerDrop(this.layerManager.layers, srcId, layer.id, position);
                    li.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-inside');
                    if (!plan) return;
                    const oldLayers = [...this.layerManager.layers];
                    const moved = oldLayers.find(item => item.id === srcId);
                    const oldGroupId = moved.groupId;
                    moved.groupId = plan.groupId;
                    this.layerManager.layers = plan.order;

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
        this.updateActiveHighlight();
        const empty=document.getElementById('layer-filter-empty');if(empty)empty.hidden=this.layerElements.size>0;
    }

    updateActiveHighlight() {
        const activeId = this.layerManager.activeLayerId;
        if (!this.listElement) return;
        const isolated = this.layerManager.getIsolationIds?.();
        if (this.isolationNotice) this.isolationNotice.hidden = !isolated;
        this.isolateButton?.setAttribute('aria-pressed', String(Boolean(isolated)));
        if (this.isolateButton) this.isolateButton.disabled = !this.layerManager.getActiveLayer();
        const layersById=new Map(this.layerManager.layers.map(layer=>[layer.id,layer]));
        this.listElement.querySelectorAll('.layer-item').forEach(li => {
            const id = li.dataset.id;
            li.classList.toggle('active', id === activeId);
            li.tabIndex = id === activeId ? 0 : -1;
            li.setAttribute('aria-selected', String(this.layerManager.isLayerSelected(id)));
            li.classList.toggle('selected', this.layerManager.isLayerSelected(id));
            li.classList.toggle('outside-isolation', Boolean(isolated && !isolated.has(id)));
            const layer = layersById.get(id);
            li.style.setProperty('--layer-label-color', LAYER_LABELS[normalizeLayerLabel(layer?.colorLabel)][1]);
            if(layer)for(const [key,on,off,label] of [['visible','visibility','visibility_off',layer.isGroup?'папку':'слой'],['locked','lock','lock_open',layer.isGroup?'папку':'слой']]){
                const button=li.querySelector(`[data-layer-property="${key}"]`);if(!button)continue;
                const icon=button.querySelector('.material-symbols-rounded');if(icon)icon.innerText=layer[key]?on:off;
                const action=key==='visible'?(layer.visible?'Скрыть':'Показать'):(layer.locked?'Разблокировать':'Заблокировать');
                this.setAccessibleButtonName(button,`${action} ${label}`);
                if(key==='locked')button.style.opacity=layer.locked?'1':'0.4';
            }
        });
        if(!this.listElement.querySelector('.layer-item[tabindex="0"]'))this.listElement.querySelector('.layer-item')?.setAttribute('tabindex','0');
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
        if (!layer || layer.isBase || isObjectLocked(layer,this.layerManager.layers) || !this.finishEditing()) return;
        const idx = this.layerManager.layers.indexOf(layer);
        const command = new RemoveLayerCommand(this.layerManager, layer, idx);
        if (this.layerManager.removeLayer(layer.id)) {
            if (this.history) {
                this.history.push(command);
            }
        }
    }

    deleteSelectedLayers() {
        if(!this.finishEditing())return false;
        const manager=this.layerManager,layers=manager.layers;
        const ids=new Set(manager.getSelectedLayers().map(layer=>layer.id));
        if(!ids.size&&manager.getActiveLayer())ids.add(manager.activeLayerId);
        for(let pass=0;pass<layers.length;pass++){
            let added=false;
            for(const layer of layers)if(ids.has(layer.groupId)&&!ids.has(layer.id)){ids.add(layer.id);added=true;}
            if(!added)break;
        }
        const targets=layers.filter(layer=>ids.has(layer.id)&&!layer.isBase&&!isObjectLocked(layer,layers)&&manager.isInIsolation?.(layer.id)!==false);
        // A locked descendant keeps its containing group intact.
        for(const layer of layers)if(ids.has(layer.id)&&isObjectLocked(layer,layers)){
            let parent=layer.groupId;
            while(parent){const index=targets.findIndex(item=>item.id===parent);if(index>=0)targets.splice(index,1);parent=layers.find(item=>item.id===parent)?.groupId;}
        }
        if(!targets.length)return false;
        const commands=targets.map(layer=>new RemoveLayerCommand(manager,layer,layers.indexOf(layer))).reverse();
        const command=new CompoundCommand(commands);command.name='Удаление объектов';
        command.execute();this.history?.push(command);return true;
    }

    duplicateLayer(layer) {
        if (!layer || layer.isBase || !this.finishEditing()) return;
        const previous = new Set(this.layerManager.layers);
        let dup;
        try { dup = this.layerManager.duplicateLayer(layer.id); }
        catch (error) {
            console.error('Не удалось скопировать слой:', error);
            globalThis.window?.mollyEditor?.showToast?.('Не удалось скопировать слой. Повторите действие.', 'error');
            return null;
        }
        if (this.history && dup) {
            const commands = this.layerManager.layers.filter(item => !previous.has(item)).map(item => new AddLayerCommand(this.layerManager, item));
            const command = new CompoundCommand(commands);
            command.name = 'Дублирование слоя';
            this.history.push(command);
        }
    }

    openLayerContextMenu(e, layer) {
        if (!layer || !this.finishEditing()) return;
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

        const labelRow = document.createElement('label'); labelRow.className = 'm3-ctx-control-block';
        const labelTitle = document.createElement('span'); bindText(labelTitle, 'Цветовая метка');
        const labelSelect = document.createElement('select'); labelSelect.className = 'md-select';
        bindAttribute(labelSelect, "aria-label", 'Цветовая метка слоя');
        for (const [id, [title]] of Object.entries(LAYER_LABELS)) {
            const option = document.createElement('option'); option.value = id; bindText(option, title);
            labelSelect.append(option);
        }
        labelSelect.value = normalizeLayerLabel(layer.colorLabel);
        labelSelect.addEventListener('change', () => {
            const command = new LayerPropertyCommand(layer, 'colorLabel', normalizeLayerLabel(layer.colorLabel), labelSelect.value, this.bus);
            command.name = 'Цветовая метка слоя'; command.execute(); this.history?.push(command);
        });
        labelRow.append(labelTitle, labelSelect); menu.append(labelRow);

        if (!layer.isGroup) {
            // Blend Mode Block
            const blendBlock = document.createElement('div');
            blendBlock.className = 'm3-ctx-control-block';

            const blendLabel = document.createElement('span');
            blendLabel.className = 'm3-ctx-label';
            bindText(blendLabel, 'Режим наложения:');
            blendBlock.appendChild(blendLabel);

            const blendSelect = document.createElement('select');
            blendSelect.className = 'md-select md-select-mini';
            bindAttribute(blendSelect, "aria-label", 'Режим наложения');
            const modes = [
                { id: 'source-over', name: 'Обычный' },
                { id: 'multiply', name: 'Умножение' },
                { id: 'screen', name: 'Экран' },
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
                bindText(opt, m.name);
                if ((layer.blendMode || 'source-over') === m.id) opt.selected = true;
                blendSelect.appendChild(opt);
            });
            if(!modes.some(mode=>mode.id===(layer.blendMode||'source-over'))){
                const option=document.createElement('option');option.value=layer.blendMode;bindText(option, 'Режим из файла');option.selected=true;blendSelect.append(option);
            }
            blendSelect.addEventListener('change', (ev) => {
                this.setProperty(layer,'blendMode',ev.target.value);ev.target.value=layer.blendMode||'source-over';
            });
            blendBlock.appendChild(blendSelect);

            // Opacity slider
            const opRow = document.createElement('div');
            opRow.className = 'm3-ctx-row';
            const opLabel = document.createElement('span');
            opLabel.className = 'm3-ctx-label';
            bindText(opLabel, 'Непрозрачность:');
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
            bindAttribute(opSlider, "aria-label", 'Непрозрачность слоя');
            let opacityCommand=null;
            const readonly=isObjectLocked(layer,this.layerManager.layers)||this.layerManager.isInIsolation?.(layer.id)===false;
            blendSelect.disabled=opSlider.disabled=readonly;
            opSlider.addEventListener('focus', () => { opacityCommand=null; });
            opSlider.addEventListener('pointerdown', () => { opacityCommand=null; });
            opSlider.addEventListener('input', (ev) => {
                opacityCommand=this.setProperty(layer,'opacity',Number(ev.target.value)/100,opacityCommand);
                const value=Math.round((layer.opacity??1)*100);opVal.innerText=`${value}%`;opSlider.value=value;
            });
            opSlider.addEventListener('change', (ev) => {
                this.setProperty(layer,'opacity',Number(ev.target.value)/100,opacityCommand);opacityCommand=null;
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
            bindText(txtDup, 'Копировать слой');
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
            bindText(txtMerge, 'Слить со слоем ниже');
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
        bindText(txtRename, 'Переименовать');
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
        bindText(txtLock, layer.locked ? 'Разблокировать' : 'Заблокировать');
        btnLock.appendChild(txtLock);
        btnLock.addEventListener('click', () => {
            this.closeLayerContextMenu();
            this.setProperty(layer,'locked',!layer.locked);
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
            bindText(txtDel, layer.isGroup ? 'Удалить папку' : 'Удалить слой');
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
        menu.setAttribute('role', 'menu'); bindAttribute(menu, "aria-label", 'Действия со слоем');
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
        if (menu) { menu.classList.remove('show'); menu.style.display = 'none';menu.onkeydown=null;menu.replaceChildren(); }
    }
}
