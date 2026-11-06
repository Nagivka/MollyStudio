/**
 * AutoLayoutManager - Intelligent Adaptive Layout & Auto-Scaling Engine
 * Automatically adjusts and scales panels, buttons, tabs, toolbars, fonts, rulers, and controls
 * according to window size, display resolution, tab count, and viewport ergonomics.
 */
import ToolStrip from '../ui/ToolStrip.js';
import {inspectorBounds} from './LayoutMetrics.mjs';

export default class AutoLayoutManager {
    constructor(bus) {
        this.bus = bus;
        this.root = document.documentElement;
        this.body = document.body;
        this.app = document.getElementById('app');
        this.docTabBar = document.querySelector('.doc-tab-bar');
        this.rightPanel = document.getElementById('main-right-panel');
        this.workspace = document.getElementById('workspace');
        this.toolbar = document.getElementById('main-toolbar');
        this.toolStrip = new ToolStrip(this.toolbar, bus);
        
        this.isUserResizedPanel = Number(localStorage.getItem('molly_panel_width')) > 0;
        this.userCustomPanelWidth = null;
        this.rafId = null;

        this.init();
    }

    init() {
        // Track if user manually drags panel resizer
        const resizer = document.getElementById('right-panel-resizer') || document.getElementById('panel-resizer-v');
        if (resizer) {
            resizer.addEventListener('pointerdown', () => {
                this.isUserResizedPanel = true;
            });
        }

        // Window resize listener with requestAnimationFrame throttling
        window.addEventListener('resize', () => {
            this.scheduleUpdate();
        });

        // Document tabs observer (when tabs are added, removed, or renamed)
        const tabsContainer = document.querySelector('.doc-tabs-container');
        if (tabsContainer && window.MutationObserver) {
            const tabObserver = new MutationObserver(() => {
                this.updateTabsLayout();
            });
            tabObserver.observe(tabsContainer, { childList: true, subtree: true, characterData: true });
        }
        // Width transitions finish after the first resize frame. Reveal the active tab again
        // once its final geometry is known, including when the OS changes display scale.
        this.docTabBar?.addEventListener('transitionend',event=>{
            if(!event.target.matches('.doc-tab')||!['width','max-width'].includes(event.propertyName))return;
            if(this.tabVisibilityFrame)cancelAnimationFrame(this.tabVisibilityFrame);
            this.tabVisibilityFrame=requestAnimationFrame(()=>{this.tabVisibilityFrame=null;this.docTabBar.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});});
        });

        // Listen for internal app events
        this.bus?.on('SETTINGS_CHANGED', () => this.scheduleUpdate());
        this.bus?.on('PROJECT_LOADED', () => this.scheduleUpdate());
        this.bus?.on('PROJECT_CREATED', () => this.scheduleUpdate());
        this.bus?.on('TAB_ADDED', () => this.updateTabsLayout());
        this.bus?.on('TAB_CLOSED', () => this.updateTabsLayout());
        this.bus?.on('PANEL_TOGGLED', () => this.scheduleUpdate());

        // Fullscreen / Window state changes
        if (window.desktopAPI?.onWindowStateChange) {
            window.desktopAPI.onWindowStateChange(() => {
                this.scheduleUpdate();
            });
        }

        // ResizeObserver on workspace container
        if (window.ResizeObserver && this.workspace) {
            const ro = new ResizeObserver(() => {
                this.updateTabsLayout();
            });
            ro.observe(this.workspace);
        }
        if (this.toolbar) {
            this.toolbarObserver = new ResizeObserver(() => this.fitToolbar());
            this.toolbarObserver.observe(this.toolbar);
        }

        // Initial layout application
        this.updateLayout();
    }

    scheduleUpdate() {
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rafId = requestAnimationFrame(() => {
            this.updateLayout();
            this.rafId = null;
        });
    }

    updateLayout() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        const pixelTheme = ['minecraft', 'light-minecraft'].includes(this.root.dataset.theme);

        // 1. Calculate Continuous Ergonomic Scale Factor
        // Reference standard: 1366x768 to 1920x1080
        let scale = 1.0;
        if (w < 1000 || h < 640) {
            scale = 0.82; // Ultra Compact / Split-screen
        } else if (w < 1180 || h < 720) {
            scale = 0.90; // Compact laptop
        } else if (w < 1380 || h < 780) {
            scale = 0.96; // Standard 720p / 768p
        } else if (w <= 1680) {
            scale = 1.02; // Full HD comfort
        } else if (w <= 2000) {
            scale = 1.08; // Wide 1080p+
        } else {
            // 2K / 4K Ultra-wide scaling, clamped safely to 1.25x
            scale = Math.min(1.25, 1.10 + (w - 2000) * 0.00008);
        }

        scale *= Number(getComputedStyle(this.root).getPropertyValue('--md-ui-scale')) || 1;

        // 2. Compute Responsive Dimensions with safe ergonomic margins
        const tbHeight = Math.max(30, Math.round(30 * scale));
        const topHeight = Math.max(40, Math.round(40 * scale));
        const optHeight = 48;
        const docBarHeight = Math.max(36, Math.round(36 * scale));
        const toolBtnSize = Math.max(32, Math.min(38, Math.round(34 * scale)));
        const toolWidth = toolBtnSize + 16; // Guarantees 8px margin on both sides of toolbar buttons
        const toolIconSize = Math.max(16, Math.min(22, Math.round(19 * scale)));
        const toolBtnGap = Math.max(4, Math.min(8, Math.round(5 * scale)));
        const statusHeight = Math.max(28, Math.round(28 * scale));
        const rulerSize = Math.max(16, Math.min(22, Math.round(18 * scale)));
        const swatchSize = Math.max(18, Math.min(26, Math.round(22 * scale)));
        const rampSlotSize = Math.max(22, Math.min(30, Math.round(26 * scale)));
        const layerItemHeight = Math.max(28, Math.min(38, Math.round(32 * scale)));
        const layerThumbSize = Math.max(20, Math.min(28, Math.round(24 * scale)));
        const itemSlotSize = Math.max(28, Math.min(40, Math.round(32 * scale)));

        // 3. Inject CSS Variables into :root
        this.root.style.setProperty('--ui-scale', scale.toFixed(2));
        this.root.style.setProperty('--md-titlebar-height', `${tbHeight}px`);
        this.root.style.setProperty('--md-topbar-height', `${topHeight}px`);
        this.root.style.setProperty('--md-optbar-height', `${optHeight}px`);
        this.root.style.setProperty('--doc-bar-height', `${docBarHeight}px`);
        this.root.style.setProperty('--md-toolbar-width', `${toolWidth}px`);
        this.root.style.setProperty('--tool-btn-size', `${toolBtnSize}px`);
        this.root.style.setProperty('--tool-icon-size', `${toolIconSize}px`);
        this.root.style.setProperty('--tool-btn-gap', `${toolBtnGap}px`);
        this.root.style.setProperty('--md-status-height', `${statusHeight}px`);
        this.root.style.setProperty('--ruler-size', `${rulerSize}px`);
        this.root.style.setProperty('--swatch-size', `${swatchSize}px`);
        this.root.style.setProperty('--ramp-slot-size', `${rampSlotSize}px`);
        this.root.style.setProperty('--layer-item-height', `${layerItemHeight}px`);
        this.root.style.setProperty('--layer-thumb-size', `${layerThumbSize}px`);
        this.root.style.setProperty('--item-slot-size', `${itemSlotSize}px`);

        // 4. Responsive Breakpoint Classes on body
        // Horizontal breakpoints
        this.body.classList.toggle('layout-narrow', w < 1140);
        this.body.classList.toggle('layout-standard', w >= 1140 && w < 1650);
        this.body.classList.toggle('layout-wide', w >= 1650);

        // Vertical breakpoints
        const isUltraCompactH = h < 640;
        const isCompactH = h < 750;
        const isTallH = h >= 950;

        this.body.classList.toggle('ultra-compact-h', isUltraCompactH);
        this.body.classList.toggle('compact-h', isCompactH);
        this.body.classList.toggle('tall-h', isTallH);

        // Dynamic Color Picker SV-box Height
        let pickerSbHeight = 92;
        if (isUltraCompactH) {
            pickerSbHeight = 65;
        } else if (isCompactH) {
            pickerSbHeight = 78;
        } else if (isTallH) {
            pickerSbHeight = 125;
        } else {
            pickerSbHeight = Math.round(92 * scale);
        }
        this.root.style.setProperty('--picker-sb-height', `${pickerSbHeight}px`);

        // Panel header and vertical spacing
        const panelHeaderH = isCompactH ? 32 : Math.round(38 * scale);
        const panelGap = isCompactH ? 4 : Math.round(8 * scale);
        this.root.style.setProperty('--panel-header-height', `${panelHeaderH}px`);
        this.root.style.setProperty('--panel-gap', `${panelGap}px`);

        // 5. Intelligent Proportional Right Panel Auto-Scaling
        if (this.rightPanel) {
            const {minimum,maximum:safeMax}=inspectorBounds(w,toolWidth,pixelTheme);

            if (!this.isUserResizedPanel) {
                // Auto width clamped comfortably between 260px and 360px so controls never touch borders
                const idealWidth = pixelTheme ? Math.max(320, Math.min(400, Math.round(w * 0.26)))
                    : Math.max(260, Math.min(360, Math.round(w * 0.22)));
                this.root.style.setProperty('--md-panel-width', `${Math.max(minimum,Math.min(safeMax,idealWidth))}px`);
            } else {
                // Respect user manual resize, but defensively clamp so canvas is never crushed
                const preferredWidth = Number(localStorage.getItem('molly_panel_width')) || 270;
                this.root.style.setProperty('--md-panel-width', `${Math.max(minimum, Math.min(safeMax, preferredWidth))}px`);
            }
        }

        // 6. Distribute Tabs Layout
        this.updateTabsLayout();
        this.fitToolbar();

        // 7. Notify Workspace & Renderer for Pixel Precision
        this.bus?.emit('LAYOUT_AUTO_SCALED', {
            width: w,
            height: h,
            scale,
            isCompactH,
            isUltraCompactH,
            isTallH,
            isNarrow: w < 1140,
            rulerSize,
            toolWidth,
            optHeight,
            statusHeight
        });
    }

    fitToolbar() {
        this.toolStrip.fit();
    }

    updateTabsLayout() {
        if (!this.docTabBar) return;
        const tabsContainer = this.docTabBar.querySelector('.doc-tabs-container');
        const addBtn = this.docTabBar.querySelector('.add-tab-btn');
        if (!tabsContainer) return;

        const tabs = tabsContainer.querySelectorAll('.doc-tab');
        const tabCount = tabs.length;
        if (tabCount === 0) return;

        const totalBarWidth = this.docTabBar.clientWidth;
        const resized = this.lastTabBarWidth !== totalBarWidth || this.lastTabCount !== tabCount;
        this.lastTabBarWidth = totalBarWidth; this.lastTabCount = tabCount;
        const addBtnWidth = (addBtn?.offsetWidth || 30) + 12;
        const available = Math.max(80, totalBarWidth - addBtnWidth - 28);

        // Calculate dynamic width per tab
        const gap = 6;
        const calculatedWidth = Math.floor((available - (tabCount - 1) * gap) / tabCount);
        const dynamicTabWidth = Math.max(110, Math.min(220, calculatedWidth));

        this.root.style.setProperty('--md-tab-width', `${dynamicTabWidth}px`);

        // Apply compact and micro styling modes based on tab width
        const isCompactTabs = dynamicTabWidth < 130;
        const isMicroTabs = dynamicTabWidth < 95;

        tabs.forEach(tab => {
            const titleEl = tab.querySelector('.doc-tab-title');
            const titleText = titleEl?.textContent?.trim() || 'Документ';
            tab.title = titleText;

            tab.classList.toggle('tab-compact', isCompactTabs);
            tab.classList.toggle('tab-micro', isMicroTabs);
        });
        if (resized) requestAnimationFrame(() => tabsContainer.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    }
}
