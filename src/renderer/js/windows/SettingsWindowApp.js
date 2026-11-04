import SettingsManager from '../core/SettingsManager.js';
import SettingsModal from '../ui/SettingsModal.js';
import { installKeyboardNavigation } from '../ui/KeyboardNavigation.js';

class SettingsWindowApp {
    constructor() {
        this.settings = new SettingsManager();
        this.activeTab = 'appearance';
        this.modalHelper = new SettingsModal(null, this.settings);
        this.modalHelper.onTabRequested = tab => this.switchTab(tab);

        this.init();
    }

    init() {
        installKeyboardNavigation();
        const tabsResizeObserver = new ResizeObserver(() => {
            document.querySelector('#settings-tabs-list .settings-tab-btn.active')?.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'nearest' });
        });
        tabsResizeObserver.observe(document.getElementById('settings-tabs-list'));
        window.addEventListener('unload', () => tabsResizeObserver.disconnect(), { once: true });
        // 1. Setup Titlebar Controls
        document.getElementById('btn-win-min')?.addEventListener('click', () => {
            window.desktopAPI?.minimize();
        });

        document.getElementById('btn-win-close')?.addEventListener('click', () => {
            window.desktopAPI?.close();
        });

        document.getElementById('btn-done')?.addEventListener('click', () => {
            window.desktopAPI?.close();
        });

        window.addEventListener('keydown', (e) => {
            if (!e.defaultPrevented && e.key === 'Escape') {
                window.desktopAPI?.close();
            }
        });

        // 2. Setup Tab Switching
        const tabButtons = document.querySelectorAll('#settings-tabs-list .settings-tab-btn');
        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                this.switchTab(tab);
            });
        });

        // 3. Render Initial Tab
        this.modalHelper.ensureDeveloperTab();
        this.switchTab(new URLSearchParams(location.search).get('tab') || 'appearance');
        window.desktopAPI?.onSettingsTabRequested?.(tab => this.switchTab(tab));

    }

    switchTab(tabId) {
        if (!['appearance', 'effects', 'canvas', 'tools', 'export', 'discord', 'backup', 'hotkeys', 'about','developer'].includes(tabId)) tabId = 'appearance';
        if(tabId==='developer'&&!this.settings.get('developerUnlocked'))tabId='about';
        this.activeTab = tabId;
        this.modalHelper.disposeTab();

        // Update active tab buttons
        document.querySelectorAll('#settings-tabs-list .settings-tab-btn').forEach(btn => {
            const isActive = btn.dataset.tab === tabId;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
            btn.tabIndex = isActive ? 0 : -1;
            if (isActive) btn.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'nearest' });
        });

        const contentArea = document.getElementById('settings-content-area');
        if (!contentArea) return;
        contentArea.setAttribute('aria-labelledby', `settings-tab-${tabId}`);

        contentArea.innerHTML = '';
        this.modalHelper.activeTab = tabId;

        switch (tabId) {
            case 'developer':this.modalHelper.renderDeveloperTab(contentArea);break;
            case 'effects':this.modalHelper.renderEffectsTab(contentArea);break;
            case 'appearance':
                this.modalHelper.renderAppearanceTab(contentArea);
                break;
            case 'canvas':
                this.modalHelper.renderCanvasTab(contentArea);
                break;
            case 'tools':
                this.modalHelper.renderToolsTab(contentArea);
                break;
            case 'export':
                this.modalHelper.renderExportTab(contentArea);
                break;
            case 'discord':
                this.modalHelper.renderDiscordTab(contentArea);
                break;
            case 'backup':
                this.modalHelper.renderBackupTab(contentArea);
                break;
            case 'hotkeys':
                this.modalHelper.renderHotkeysTab(contentArea);
                break;
            case 'about':
                this.modalHelper.renderAboutTab(contentArea);
                break;
        }
        contentArea.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }
}

// Start application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new SettingsWindowApp();
});
