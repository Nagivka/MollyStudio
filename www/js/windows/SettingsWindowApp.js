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
        // 1. Setup Titlebar Controls
        document.getElementById('btn-win-min')?.addEventListener('click', () => {
            window.electronAPI?.minimize();
        });

        document.getElementById('btn-win-close')?.addEventListener('click', () => {
            window.electronAPI?.close();
        });

        document.getElementById('btn-done')?.addEventListener('click', () => {
            window.electronAPI?.close();
        });

        window.addEventListener('keydown', (e) => {
            if (!e.defaultPrevented && e.key === 'Escape') {
                window.electronAPI?.close();
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
        this.switchTab(new URLSearchParams(location.search).get('tab') || 'appearance');
        window.electronAPI?.onSettingsTabRequested?.(tab => this.switchTab(tab));

    }

    switchTab(tabId) {
        if (!['appearance', 'canvas', 'tools', 'export', 'discord', 'backup', 'hotkeys'].includes(tabId)) tabId = 'appearance';
        this.activeTab = tabId;
        if (this.modalHelper.discordPollTimer) {
            clearInterval(this.modalHelper.discordPollTimer);
            this.modalHelper.discordPollTimer = null;
        }

        // Update active tab buttons
        document.querySelectorAll('#settings-tabs-list .settings-tab-btn').forEach(btn => {
            const isActive = btn.dataset.tab === tabId;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });

        const contentArea = document.getElementById('settings-content-area');
        if (!contentArea) return;
        contentArea.setAttribute('aria-labelledby', `settings-tab-${tabId}`);

        contentArea.innerHTML = '';
        this.modalHelper.activeTab = tabId;

        switch (tabId) {
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
        }
    }
}

// Start application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new SettingsWindowApp();
});
