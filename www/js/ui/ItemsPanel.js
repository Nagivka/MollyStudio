import { MINECRAFT_ITEMS, ITEM_CATEGORIES } from '../utils/MinecraftItems.js';
import { MINECRAFT_BLOCKS } from '../utils/MinecraftBlocks.js';
import { AddLayerCommand } from '../core/Commands.js';

export default class ItemsPanel {
    constructor(bus, layerManager, tools, history = null) {
        this.bus = bus;
        this.layerManager = layerManager;
        this.tools = tools;
        this.history = history;

        // Pre-compute search keys for instant zero-allocation search
        this.items = [...MINECRAFT_ITEMS, ...MINECRAFT_BLOCKS].map(item => ({
            ...item, _searchKey: `${item.name || ''} ${item.en || ''} ${item.id || ''}`.toLowerCase()
        }));
        this.itemsById = new Map(this.items.map(item => [item.id, item]));

        this.categories = [ITEM_CATEGORIES[0], { id: 'block_renders', name: 'Объёмные блоки', icon: 'deployed_code' }, ...ITEM_CATEGORIES.slice(1)];
        this.activeCategory = 'all';
        this.searchQuery = '';
        this.searchDebounceTimer = null;

        this.panelElement = document.getElementById('items-panel-section');
        this.gridElement = document.getElementById('items-grid');
        this.categoriesElement = document.getElementById('items-categories-bar');
        this.searchInput = document.getElementById('items-search-input');
        this.clearSearchBtn = document.getElementById('btn-clear-items-search');
        this.countBadge = document.getElementById('items-count-badge');
        this.emptyState = document.getElementById('items-empty-state');

        this.init();
    }

    init() {
        this.setupEventDelegation();
        this.renderCategories();
        this.setupListeners();
        this.renderItems();
    }

    setupEventDelegation() {
        if (!this.gridElement) return;

        this.gridElement.addEventListener('click', (e) => {
            const card = e.target.closest('.md-item-card');
            if (!card) return;
            const itemId = card.dataset.id;
            const item = this.itemsById.get(itemId);
            if (item) this.addItemToCanvas(item);
        });

        this.gridElement.addEventListener('dragstart', (e) => {
            const card = e.target.closest('.md-item-card');
            if (!card) return;
            const itemId = card.dataset.id;
            const item = this.itemsById.get(itemId);
            if (item) {
                e.dataTransfer.setData('application/minecraft-item', JSON.stringify(item));
                e.dataTransfer.setData('text/plain', item.id);
                e.dataTransfer.effectAllowed = 'copy';
                card.classList.add('dragging');
            }
        });

        this.gridElement.addEventListener('dragend', (e) => {
            const card = e.target.closest('.md-item-card');
            if (card) card.classList.remove('dragging');
        });
    }

    setupListeners() {
        if (this.searchInput) {
            this.searchInput.addEventListener('input', (e) => {
                const query = e.target.value.trim().toLowerCase();
                if (this.searchQuery === query) return;
                this.searchQuery = query;

                if (this.clearSearchBtn) {
                    this.clearSearchBtn.style.display = this.searchQuery.length > 0 ? 'flex' : 'none';
                }

                if (this.searchDebounceTimer) {
                    clearTimeout(this.searchDebounceTimer);
                }
                this.searchDebounceTimer = setTimeout(() => {
                    this.renderItems();
                }, 30);
            });
        }

        if (this.clearSearchBtn) {
            this.clearSearchBtn.addEventListener('click', () => {
                if (this.searchInput) {
                    this.searchInput.value = '';
                    this.searchQuery = '';
                    this.clearSearchBtn.style.display = 'none';
                    this.searchInput.focus();
                    this.renderItems();
                }
            });
        }

        const catPrev = document.getElementById('btn-cat-prev');
        const catNext = document.getElementById('btn-cat-next');
        const catScroll = document.getElementById('items-categories-scroll');

        if (catPrev && catScroll) {
            catPrev.addEventListener('click', () => {
                catScroll.scrollBy({ left: -140, behavior: 'smooth' });
            });
        }
        if (catNext && catScroll) {
            catNext.addEventListener('click', () => {
                catScroll.scrollBy({ left: 140, behavior: 'smooth' });
            });
        }
        if (catScroll) {
            catScroll.addEventListener('wheel', (e) => {
                if (e.deltaY && !e.shiftKey) {
                    catScroll.scrollLeft += e.deltaY;
                    e.preventDefault();
                }
            }, { passive: false });
        }
    }

    renderCategories() {
        if (!this.categoriesElement) return;
        this.categoriesElement.innerHTML = '';

        this.categories.forEach(cat => {
            const chip = document.createElement('button');
            chip.className = `md-item-category-chip ${cat.id === this.activeCategory ? 'active' : ''}`;
            chip.dataset.category = cat.id;

            const icon = document.createElement('i');
            icon.className = 'material-symbols-rounded';
            icon.innerText = cat.icon || 'grid_view';

            const span = document.createElement('span');
            span.innerText = cat.name;

            chip.appendChild(icon);
            chip.appendChild(span);

            chip.addEventListener('click', () => {
                this.activeCategory = cat.id;
                this.categoriesElement.querySelectorAll('.md-item-category-chip').forEach(c => {
                    c.classList.toggle('active', c.dataset.category === this.activeCategory);
                });
                this.renderItems();
            });

            this.categoriesElement.appendChild(chip);
        });
    }

    getFilteredItems() {
        const hasCategory = this.activeCategory !== 'all';
        const query = this.searchQuery;

        if (!hasCategory && !query) {
            return this.items;
        }

        return this.items.filter(item => {
            if (hasCategory && item.category !== this.activeCategory) {
                return false;
            }
            if (query && !item._searchKey.includes(query)) {
                return false;
            }
            return true;
        });
    }

    renderItems() {
        if (!this.gridElement) return;

        if (this._renderChunkTimer) {
            cancelAnimationFrame(this._renderChunkTimer);
            this._renderChunkTimer = null;
        }

        const filtered = this.getFilteredItems();
        if (this.countBadge) {
            this.countBadge.innerText = filtered.length;
        }

        if (filtered.length === 0) {
            this.gridElement.style.display = 'none';
            if (this.emptyState) this.emptyState.style.display = 'flex';
            return;
        }

        this.gridElement.style.display = 'grid';
        if (this.emptyState) this.emptyState.style.display = 'none';

        this.gridElement.innerHTML = '';

        const createCard = (item) => {
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'md-item-card';
            cell.title = `${item.name || item.id} [${item.en || ''}]\nID: ${item.id}\nНажмите или перетащите на холст`;
            cell.dataset.id = item.id;
            cell.draggable = true;

            const folder = item.folder || 'items_minecraft';
            const assetPath = `assets/${folder}/${item.file}`;

            const img = document.createElement('img');
            img.src = assetPath;
            img.alt = item.name || item.id;
            img.decoding = 'async';
            img.loading = 'lazy';
            img.draggable = false;
            img.width = 32;
            img.height = 32;
            img.className = 'md-item-icon';
            img.onerror = () => {
                img.style.display = 'none';
                const icon = document.createElement('i');
                icon.className = 'material-symbols-rounded';
                icon.style.fontSize = '20px';
                icon.style.color = 'var(--md-outline)';
                icon.textContent = 'category';
                cell.appendChild(icon);
            };

            cell.appendChild(img);
            return cell;
        };

        const INITIAL_BATCH = 60;
        const fragment = document.createDocumentFragment();
        const firstCount = Math.min(filtered.length, INITIAL_BATCH);

        for (let i = 0; i < firstCount; i++) {
            fragment.appendChild(createCard(filtered[i]));
        }
        this.gridElement.appendChild(fragment);

        if (filtered.length > INITIAL_BATCH) {
            let currentIndex = INITIAL_BATCH;
            const BATCH_SIZE = 80;

            const renderNextBatch = () => {
                const batchFrag = document.createDocumentFragment();
                const limit = Math.min(filtered.length, currentIndex + BATCH_SIZE);
                for (let i = currentIndex; i < limit; i++) {
                    batchFrag.appendChild(createCard(filtered[i]));
                }
                this.gridElement.appendChild(batchFrag);
                currentIndex = limit;

                if (currentIndex < filtered.length) {
                    this._renderChunkTimer = requestAnimationFrame(renderNextBatch);
                }
            };

            this._renderChunkTimer = requestAnimationFrame(renderNextBatch);
        }
    }

    addItemToCanvas(item, targetX = null, targetY = null) {
        item = this.itemsById.get(item?.id);
        if (!item) return;
        const app = window.mollyEditor;
        if (app?.getActiveProject?.()?.type === 'prefix') {
            app.showToast('Для добавления изображений создайте копию префикса на холсте.', 'info');
            return;
        }
        const projectId = app?.activeProjectId;
        const folder = item.folder || 'items_minecraft';
        const assetPath = `assets/${folder}/${item.file}`;
        const img = new Image();
        img.onload = () => {
            if (app && app.activeProjectId !== projectId) {
                app.showToast('Повторите добавление предмета в нужной вкладке.', 'info');
                return;
            }
            if (img.naturalWidth > 4096 || img.naturalHeight > 4096) return;
            const layerName = item.name || item.en || item.id;
            const activeLayer = this.layerManager.getActiveLayer();
            const newLayer = this.layerManager.addLayer(layerName);
            if (!newLayer) return;

            if (activeLayer && (activeLayer.isGroup || activeLayer.type === 'group')) {
                newLayer.groupId = activeLayer.id;
            } else if (activeLayer && activeLayer.groupId) {
                newLayer.groupId = activeLayer.groupId;
            }

            newLayer.ctx.imageSmoothingEnabled = false;

            const w = img.naturalWidth || img.width || 16;
            const h = img.naturalHeight || img.height || 16;

            let posX = targetX;
            let posY = targetY;

            if (posX === null || posY === null) {
                // Center on canvas
                const cw = newLayer.width || 256;
                const ch = newLayer.height || 256;
                posX = Math.round((cw - w) / 2);
                posY = Math.round((ch - h) / 2);
            } else {
                // Center around cursor position
                posX = Math.round(targetX - w / 2);
                posY = Math.round(targetY - h / 2);
            }

            newLayer.ctx.drawImage(img, posX, posY, w, h);

            // Retain pristine master source for non-destructive, loss-less scaling
            const srcC = document.createElement('canvas');
            srcC.width = w;
            srcC.height = h;
            const sCtx = srcC.getContext('2d');
            sCtx.imageSmoothingEnabled = false;
            sCtx.drawImage(img, 0, 0, w, h);
            newLayer.setMasterSource(srcC, { x: posX, y: posY, w, h });

            if (this.history) {
                this.history.push(new AddLayerCommand(this.layerManager, newLayer));
            }

            this.layerManager.setActive(newLayer.id);
            this.bus.emit('CANVAS_UPDATED');
            this.bus.emit('LAYER_ORDER_CHANGED');

            // Switch to move tool so user can immediately transform / position it
            this.bus.emit('REQUEST_TOOL_CHANGE', 'move');

            if (window.mollyEditor?.showToast) {
                window.mollyEditor.showToast(`Предмет ${item.name || item.id} добавлен на холст!`, 'category');
            }
        };
        img.onerror = () => app?.showToast('Не удалось загрузить изображение предмета.', 'error');
        img.src = assetPath;
    }
}

