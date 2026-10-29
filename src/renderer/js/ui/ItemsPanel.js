import {bindAttribute, bindText, translate, getLanguage, uiLabel, localeValue} from '../core/Locale.mjs';
import { MINECRAFT_ITEMS, ITEM_CATEGORIES } from '../utils/MinecraftItems.js';
import { MINECRAFT_BLOCKS } from '../utils/MinecraftBlocks.js';

export default class ItemsPanel {
    constructor(bus, layerManager, tools, history = null) {
        this.bus = bus;
        this.layerManager = layerManager;
        this.tools = tools;
        this.history = history;

        // Pre-compute search keys for instant zero-allocation search
        this.items = [...MINECRAFT_ITEMS, ...MINECRAFT_BLOCKS].map(item => ({
            ...item, _searchKey: `${item.name || ''} ${item.en || ''} ${item.id || ''} ${item.pack || ''}`.toLowerCase()
        }));
        this.itemsById = new Map(this.items.map(item => [item.id, item]));

        this.favorites=new Set(this.readSavedItems('molly-items-favorites-v1'));
        this.recent=this.readSavedItems('molly-items-recent-v1');
        this.categories = [ITEM_CATEGORIES[0], {id:'favorites',name:'Избранное',icon:'star'}, {id:'recent',name:'Недавние',icon:'history'}, { id: 'block_renders', name: 'Объёмные блоки', icon: 'deployed_code' }, ...ITEM_CATEGORIES.slice(1)];
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
        window.addEventListener('storage',event=>{
            if(!['molly-items-favorites-v1','molly-items-recent-v1'].includes(event.key))return;
            this.favorites=new Set(this.readSavedItems('molly-items-favorites-v1'));this.recent=this.readSavedItems('molly-items-recent-v1').slice(0,40);this.renderItems();
        });
    }

    init() {
        this.setupEventDelegation();
        this.renderCategories();
        this.setupListeners();
        this.renderItems();
    }

    setupEventDelegation() {
        if (!this.gridElement) return;
        this.gridElement.setAttribute('role','group');bindAttribute(this.gridElement, "aria-label", 'Ресурсы Minecraft');
        this.gridElement.addEventListener('contextmenu',event=>{
            const card=event.target.closest('.md-item-card');if(!card)return;event.preventDefault();this.toggleFavorite(card.dataset.id);
        });
        this.gridElement.addEventListener('keydown',event=>{
            const card=event.target.closest('.md-item-card');if(!card)return;
            if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();event.stopPropagation();this.toggleFavorite(card.dataset.id);return;}
            if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
            event.preventDefault();event.stopPropagation();
            const cards=[...this.gridElement.querySelectorAll('.md-item-card')],index=cards.indexOf(card),columns=getComputedStyle(this.gridElement).gridTemplateColumns.split(' ').length;
            let next=event.key==='Home'?0:event.key==='End'?cards.length-1:index+({ArrowLeft:-1,ArrowRight:1,ArrowUp:-columns,ArrowDown:columns}[event.key]||0);
            next=Math.max(0,Math.min(cards.length-1,next));cards.forEach((item,i)=>item.tabIndex=i===next?0:-1);cards[next]?.focus();
        });

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
            chip.type='button';chip.setAttribute('aria-pressed',String(cat.id===this.activeCategory));

            const icon = document.createElement('i');
            icon.className = 'material-symbols-rounded';
            icon.innerText = cat.icon || 'grid_view';

            const span = document.createElement('span');
            bindText(span, cat.name);

            chip.appendChild(icon);
            chip.appendChild(span);

            chip.addEventListener('click', () => {
                this.activeCategory = cat.id;
                this.categoriesElement.querySelectorAll('.md-item-category-chip').forEach(c => {
                    c.classList.toggle('active', c.dataset.category === this.activeCategory);
                    c.setAttribute('aria-pressed',String(c.dataset.category===this.activeCategory));
                });
                this.renderItems();
            });

            this.categoriesElement.appendChild(chip);
        });
        requestAnimationFrame(()=>{
            const scroll=document.getElementById('items-categories-scroll'),active=this.categoriesElement.querySelector('[aria-pressed="true"]');
            if(!scroll||!active||!scroll.clientWidth)return;
            const viewport=scroll.getBoundingClientRect(),chip=active.getBoundingClientRect();
            if(chip.left<viewport.left)scroll.scrollLeft+=chip.left-viewport.left;
            else if(chip.right>viewport.right)scroll.scrollLeft+=chip.right-viewport.right;
        });
    }

    getFilteredItems() {
        const source=this.activeCategory==='favorites'?this.items.filter(item=>this.favorites.has(item.id))
            :this.activeCategory==='recent'?this.recent.map(id=>this.itemsById.get(id)).filter(Boolean):this.items;
        const hasCategory = !['all','favorites','recent'].includes(this.activeCategory);
        const query = this.searchQuery;

        if (!hasCategory && !query) {
            return source;
        }

        return source.filter(item => {
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
        this._itemObserver?.disconnect();

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
            bindAttribute(cell, "title", "{0} [{1}]\nID: {2}\nНажмите или перетащите на холст\nПравой кнопкой / Shift+F10 — {3}", {0: localeValue(item.name || item.id, item.en || item.id), 1: item.en || '', 2: item.id, 3: uiLabel(this.favorites.has(item.id)?'убрать из избранного':'в избранное')});
            cell.tabIndex=-1;
            cell.dataset.id = item.id;
            cell.draggable = true;

            const folder = item.folder || 'items_minecraft';
            const assetPath = `assets/${folder}/${item.file}`;

            const img = document.createElement('img');
            img.src = assetPath;
            img.alt = item.name || item.id;
            img.decoding = 'async';
            // Tinted previews decode through an off-DOM image, which must not
            // wait for the visibility-based lazy loader.
            img.loading = item.designable ? 'eager' : 'lazy';
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
            if(this.favorites.has(item.id)){const star=document.createElement('i');star.className='material-symbols-rounded item-favorite-mark';star.textContent='star';star.setAttribute('aria-hidden','true');cell.append(star);}
            return cell;
        };

        const INITIAL_BATCH = 60;
        const fragment = document.createDocumentFragment();
        const firstCount = Math.min(filtered.length, INITIAL_BATCH);

        for (let i = 0; i < firstCount; i++) {
            fragment.appendChild(createCard(filtered[i]));
        }
        this.gridElement.appendChild(fragment);
        this.gridElement.firstElementChild?.setAttribute('tabindex','0');

        if (filtered.length > INITIAL_BATCH) {
            let currentIndex = INITIAL_BATCH;
            const BATCH_SIZE = 80;

            const renderNextBatch = () => {
                this._itemObserver?.disconnect();
                const batchFrag = document.createDocumentFragment();
                const limit = Math.min(filtered.length, currentIndex + BATCH_SIZE);
                for (let i = currentIndex; i < limit; i++) {
                    batchFrag.appendChild(createCard(filtered[i]));
                }
                this.gridElement.appendChild(batchFrag);
                currentIndex = limit;

                if (currentIndex < filtered.length) {
                    if(this._itemObserver)this._itemObserver.observe(this.gridElement.lastElementChild);
                    else this._renderChunkTimer = requestAnimationFrame(renderNextBatch);
                }
            };
            if(typeof IntersectionObserver!=='undefined'){
                this._itemObserver=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))renderNextBatch();},{root:this.gridElement.parentElement,rootMargin:'200px'});
                this._itemObserver.observe(this.gridElement.lastElementChild);
            }else this._renderChunkTimer = requestAnimationFrame(renderNextBatch);
        }
    }

    async addItemToCanvas(item, targetX = null, targetY = null) {
        item = this.itemsById.get(item?.id);
        const app = window.mollyEditor;
        if (!item || !app) return false;
        const result = await app.importImage(`assets/${item.folder || 'items_minecraft'}/${item.file}`, {
            name: getLanguage()==='en'?(item.en||item.name||item.id):(item.name||item.en||item.id), position: 'item', x: targetX, y: targetY
        });
        if (!result) return false;
        this.recent = [item.id, ...this.recent.filter(id => id !== item.id)].slice(0, 40);
        this.saveItems('molly-items-recent-v1', this.recent);
        app.showToast('Ресурс добавлен на холст.','category');
        return true;
    }


    readSavedItems(key) {
        try {const raw=localStorage.getItem(key);if(!raw||raw.length>50000)return[];const value=JSON.parse(raw);return Array.isArray(value)?[...new Set(value.filter(id=>this.itemsById.has(id)))].slice(0,200):[];}catch{return[];}
    }

    saveItems(key,value) {try{localStorage.setItem(key,JSON.stringify(value));}catch{window.mollyEditor?.showToast?.('Не удалось сохранить список ресурсов.','error');}}

    toggleFavorite(id) {
        if(!this.itemsById.has(id))return;
        if(this.favorites.has(id))this.favorites.delete(id);
        else if(this.favorites.size<200)this.favorites.add(id);
        else {window.mollyEditor?.showToast?.('В избранном может быть до 200 ресурсов.','info');return;}
        this.saveItems('molly-items-favorites-v1',[...this.favorites]);this.renderItems();
        const card=[...this.gridElement.querySelectorAll('.md-item-card')].find(item=>item.dataset.id===id)||this.gridElement.firstElementChild;
        if(card){this.gridElement.querySelectorAll('.md-item-card').forEach(item=>item.tabIndex=item===card?0:-1);card.focus();}
    }
}

