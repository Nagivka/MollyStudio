

/** App-facing controller methods; document serialization lives in core. */
export default class SessionController {
    getNounPlural(number, one, two, five) {
        let n = Math.abs(number);
        n %= 100;
        if (n >= 5 && n <= 20) return five;
        n %= 10;
        if (n === 1) return one;
        if (n >= 2 && n <= 4) return two;
        return five;
    }

    setupAutosave() {
        if (this.autosaveTimer) {
            clearInterval(this.autosaveTimer);
            this.autosaveTimer = null;
        }
        const mins = this.settingsManager?.get('autosaveInterval') || 0;
        if (mins > 0) {
            this.autosaveTimer = setInterval(() => {
                if (this.activeProjectId) {
                    this.saveProjectState();
                    void this.projectManager?.performAutosave().then(saved => {
                        if (saved) this.showToast('Черновик сохранён', 'cloud_done', 1500);
                    });
                }
            }, mins * 60 * 1000);
        }
    }

    setupDiscordPresence() {
        const update = () => this.updateDiscordPresence();
        this.bus.on('TOOL_CHANGED', update);
        this.bus.on('LAYER_ADDED', update);
        this.bus.on('LAYER_REMOVED', update);
        this.bus.on('LAYER_ORDER_CHANGED', update);
        this.bus.on('LAYER_ACTIVE_CHANGED', update);
        this.bus.on('SETTINGS_CHANGED', update);
        this.bus.on('CANVAS_RESIZED', update);
        this.bus.on('PROJECT_LOADED', update);
        setTimeout(update, 100);
        setTimeout(update, 800);
        setInterval(update, 15000);
    }

    updateDiscordPresence() {
        if (!window.desktopAPI?.updateDiscordPresence) return;

        const discordEnabled = this.settingsManager.get('discordRPC') ?? true;
        if (!discordEnabled) {
            window.desktopAPI.clearDiscordPresence?.();
            return;
        }

        const activeProj = this.getActiveProject();
        const isCanvas = activeProj?.type === 'canvas';
        const projName = activeProj?.name || (isCanvas ? 'Холст' : 'GUI Меню');
        const layers = this.layerManager?.getLayers() || [];
        const layerCount = layers.length || 1;
        const currentToolId = this.tools?.currentToolId || 'move';

        const toolNames = {
            'move': 'Перемещение',
            'marquee': 'Выделение',
            'lasso': 'Лассо',
            'wand': 'Волшебная палочка',
            'brush': 'Кисть',
            'pencil': 'Карандаш',
            'eraser': 'Ластик',
            'bucket': 'Заливка',
            'fill': 'Заливка',
            'gradient': 'Градиент',
            'pipette': 'Пипетка',
            'line': 'Линия',
            'rect-empty': 'Контур прямоуг.',
            'rect-filled': 'Прямоугольник',
            'circle-empty': 'Контур круга',
            'circle-filled': 'Круг',
            'text': 'Текст',
            'hand': 'Панорама'
        };

        const toolName = toolNames[currentToolId] || 'Редактирование';
        const showProject = this.settingsManager.get('discordShowProject') ?? true;
        const showTool = this.settingsManager.get('discordShowTool') ?? true;
        const showTime = this.settingsManager.get('discordShowTime') ?? true;

        const prefix = ({prefix:'Префиксы',canvas:'Холст'})[activeProj?.type] || 'GUI Меню';
        const details = showProject ? `${prefix}: ${projName}` : 'MollyStudio';
        const layersText = `${layerCount} ${this.getNounPlural(layerCount, 'слой', 'слоя', 'слоёв')}`;
        const state = showTool ? `Инструмент: ${toolName} • ${layersText}` : `Холст ${this.config.width}×${this.config.height} • ${layersText}`;

        try {
            window.desktopAPI?.updateDiscordPresence?.({
                details,
                state,
                showTime,
                startTimestamp: this.projectStartTimestamp || Date.now()
            })?.catch?.(() => {});
        } catch (_) {}
    }
}
