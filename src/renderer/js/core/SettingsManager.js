import {installDiagnostics} from './Diagnostics.mjs';
import {syncAmbientWeather} from '../ui/AmbientWeather.js';
import {syncUISounds} from '../ui/UISounds.js';
import {syncSeasonalDetails} from '../ui/SeasonalDetails.js';
import {syncDeveloperMonitor} from '../ui/DeveloperMonitor.js';
import {installLiquidGlassMotion} from '../ui/LiquidGlassMotion.js';
import {syncBasementPalette} from '../utils/Palettes.js';
/**
 * SettingsManager - Pure Material Design 3 Configuration and Dynamic Color Manager.
 * Manages standard themes and the experimental Minecraft dark/light pair,
 * UI fonts, accent typography, dynamic M3 color tokens, canvas settings,
 * undo limit, and workspace behavior.
 */
import {normalizeShortcutBindings} from './Shortcuts.mjs';
import {setLanguage, LANGUAGES} from './Locale.mjs';

export const NUMERIC_SETTING_RANGES = {
    uiSoundVolume: [0, 100],
    gridOpacity: [0, 100], gridMinZoom: [1, 32], undoLimit: [10, 200],
    snapThreshold: [0, 64], exportScale: [1, 16], autosaveInterval: [0, 10],
    weatherSpeed: [25, 200], weatherWind: [-100, 100], weatherOpacity: [15, 100], weatherSize: [25, 400]
};

export default class SettingsManager {
    constructor(bus) {
        if(typeof window!=='undefined'&&typeof window.addEventListener==='function'&&typeof location!=='undefined')installDiagnostics();
        this.bus = bus;
        this.defaults = {
            theme: 'dark',
            language: 'ru',
            fontFamily: 'google-sans',
            accentFontFamily: 'google-sans',
            accentColor: 'auto',
            uiScale: '100%',
            animationsEnabled: true,
            clickEffectsEnabled: true,
            animatedAccentsEnabled: true,
            cardMotionEnabled: true,
            themeTransitionsEnabled: true,
            saveFeedbackEnabled: true,
            liquidGlassEnabled: false,
            seasonalDetailsEnabled: true,
            developerUnlocked: false,
            basementPaletteUnlocked: false,
            developerLayoutBounds: false,
            developerWeatherBounds: false,
            developerPerformance: false,
            developerCanvasHits: false,
            developerPixelGrid: false,
            developerTitleMesh: false,
            developerHoliday: 'auto',
            uiSoundProfile: 'auto',
            uiSoundsEnabled: false,
            uiSoundVolume: 35,
            weatherEffect: 'none',
            weatherDensity: 'normal',
            weatherLeaves: 'all',
            weatherScope: 'home',
            weatherSpeed: 100,
            weatherWind: -15,
            weatherOpacity: 75,
            weatherSize: 200,
            weatherQuality: 'auto',
            shortcutBindings: {},
            showPixelGrid: true,
            gridOpacity: 20,
            gridColor: 'white',
            gridMinZoom: 3,
            checkerStyle: 'dark',
            wheelBehavior: 'zoom',
            invertZoom: false,
            pixelPerfect: true,
            undoLimit: 50,
            snapEnabled: true,
            snapThreshold: 5,
            moveLockAspect: false,
            pipetteSampleSize: '1x1',
            exportScale: 1,
            exportTrim: false,
            autosaveInterval: 0,
            confirmClose: true,
            discordRPC: true,
            discordShowProject: true,
            discordShowTool: true,
            discordShowTime: true,
            discordClientId: '1543550000133574677'
        };

        this.settings = this.loadSettings();
        this.applyAll();

        // Multi-window real-time IPC synchronization
        if (typeof window !== 'undefined' && window.desktopAPI?.onSettingsUpdated) {
            window.desktopAPI.onSettingsUpdated((data) => {
                if (data && (data.key==='all'||Object.hasOwn(this.defaults,data.key))) {
                    this.settings = this.normalizeSettings(data.key === 'all' ? data.settings : { ...this.settings, [data.key]: data.value });
                    this.settings.theme = this.normalizeTheme(this.settings.theme);
                    this.settings.accentColor = this.normalizeAccentColor(this.settings.accentColor);
                    this.settings.fontFamily = 'google-sans';
                    this.settings.accentFontFamily = 'google-sans';
                    if (data.key === 'all') {
                        this.applyAll();
                    } else {
                        this.apply(data.key, this.settings[data.key]);
                    }
                    this.bus?.emit('SETTINGS_CHANGED', { key: data.key, value: this.settings[data.key], settings: this.settings });
                }
            });
        }

        // Cross-window localStorage sync fallback
        if (typeof window !== 'undefined') {
            window.addEventListener('storage', (e) => {
                if (e.key === 'molly_settings_m3' && e.newValue) {
                    try {
                        this.settings = this.normalizeSettings(JSON.parse(e.newValue));
                        this.settings.theme = this.normalizeTheme(this.settings.theme);
                        this.settings.accentColor = this.normalizeAccentColor(this.settings.accentColor);
                        this.settings.fontFamily = 'google-sans';
                        this.settings.accentFontFamily = 'google-sans';
                        this.applyAll();
                        this.bus?.emit('SETTINGS_CHANGED', { key: 'all', settings: this.settings });
                    } catch (_) {}
                }
            });
        }
    }

    loadSettings() {
        try {
            const stored = localStorage.getItem('molly_settings_m3');
            if (stored) return this.normalizeSettings(JSON.parse(stored));
        } catch (e) {
            console.warn('Could not load settings from localStorage:', e);
        }
        return { ...this.defaults };
    }

    normalizeSettings(input) {
        const values = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
        const settings = { ...this.defaults };
        for (const key of Object.keys(settings)) {
            const fallback = settings[key];
            if (typeof fallback === 'boolean') {
                settings[key] = typeof values[key] === 'boolean' ? values[key] : fallback;
            } else if (typeof fallback === 'number') {
                const number = Number(values[key]);
                const bounds = NUMERIC_SETTING_RANGES[key];
                settings[key] = values[key] != null && Number.isFinite(number) && bounds
                    ? Math.max(bounds[0], Math.min(bounds[1], key === 'gridMinZoom' ? number : Math.round(number))) : fallback;
            } else if (typeof values[key] === 'string') settings[key] = values[key];
        }
        const choices = {
            developerHoliday:['auto','newyear','christmas','halloween','studioBirthday','authorBirthday'],
            uiSoundProfile: ['auto','soft','pixel'],
            language: LANGUAGES.map(language=>language.id),
            weatherEffect: ['none', 'rain', 'snow', 'leaves'],
            weatherDensity: ['light', 'normal', 'dense'],
            weatherLeaves: ['autumn', 'spring', 'summer', 'all'],
            weatherScope: ['home', 'all'],
            weatherQuality: ['auto', 'economy'],
            uiScale: ['90%', '100%', '110%'], checkerStyle: ['dark','light','black'],
            gridColor: ['white','black','accent'], wheelBehavior: ['zoom','pan-v','pan-h'], pipetteSampleSize: ['1x1','3x3','5x5'],
            exportScale: [1,2,4,8,16], autosaveInterval: [0,1,3,5,10]
        };
        if (settings.wheelBehavior === 'scroll') settings.wheelBehavior = 'pan-v';
        for (const [key, options] of Object.entries(choices)) {
            if (!options.includes(settings[key])) settings[key] = this.defaults[key];
        }
        settings.theme = this.normalizeTheme(settings.theme);
        settings.accentColor = this.normalizeAccentColor(settings.accentColor);
        settings.fontFamily = settings.accentFontFamily = 'google-sans';
        settings.discordClientId = this.defaults.discordClientId;
        settings.shortcutBindings = normalizeShortcutBindings(values.shortcutBindings);
        return settings;
    }

    normalizeTheme(theme) {
        const supported = ['dark', 'oled', 'midnight', 'forest', 'amethyst', 'light', 'light-nord', 'light-warm', 'light-rose', 'light-mint', 'minecraft', 'light-minecraft'];
        return supported.includes(theme) ? theme : 'dark';
    }

    normalizeAccentColor(color) {
        if (typeof color !== 'string') return 'auto';
        const normalized = color.trim();
        if (normalized.toLowerCase() === 'auto') return 'auto';
        return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toUpperCase() : 'auto';
    }

    saveSettings() {
        try {
            localStorage.setItem('molly_settings_m3', JSON.stringify(this.settings));
        } catch (e) {
            console.warn('Could not save settings to localStorage:', e);
        }
    }

    get(key) {
        return this.settings[key] !== undefined ? this.settings[key] : this.defaults[key];
    }

    set(key, value) {
        if (key === 'fontFamily' || key === 'accentFontFamily') value = 'google-sans';
        if (key === 'theme') value = this.normalizeTheme(value);
        if (key === 'accentColor') value = this.normalizeAccentColor(value);
        if (!Object.hasOwn(this.defaults, key)) return;
        this.settings = this.normalizeSettings({ ...this.loadSettings(), [key]: value });
        value = this.settings[key];
        this.saveSettings();
        this.apply(key, value);
        this.bus?.emit('SETTINGS_CHANGED', { key, value, settings: this.settings });
        try {
            window.desktopAPI?.broadcastSettings?.({ key, value, settings: this.settings })?.catch(error => console.warn('Settings broadcast:', error));
        } catch (_) {}
    }

    resetToDefaults() {
        this.settings = { ...this.defaults };
        this.saveSettings();
        this.applyAll();
        this.bus?.emit('SETTINGS_RESET', { settings: this.settings });
        this.bus?.emit('SETTINGS_CHANGED', { key: 'all', settings: this.settings });
        try {
            window.desktopAPI?.broadcastSettings?.({ key: 'all', settings: this.settings })?.catch(error => console.warn('Settings broadcast:', error));
        } catch (_) {}
    }

    exportSettingsJSON() {
        return JSON.stringify(this.settings, null, 2);
    }

    importSettingsJSON(jsonStr) {
        try {
            const parsed = JSON.parse(jsonStr);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
            this.settings = this.normalizeSettings(parsed);
            this.saveSettings();
            this.applyAll();
            this.bus?.emit('SETTINGS_CHANGED', { key: 'all', settings: this.settings });
            try {
                window.desktopAPI?.broadcastSettings?.({ key: 'all', settings: this.settings })?.catch(error => console.warn('Settings broadcast:', error));
            } catch (_) {}
            return true;
        } catch (e) {
            console.error('Invalid settings JSON:', e);
            return false;
        }
    }

    clearCornerProps() {
        const root = document.documentElement;
        const cornerProps = [
            '--md-shape-corner-none',
            '--md-shape-corner-xs',
            '--md-shape-corner-small',
            '--md-shape-corner-medium',
            '--md-shape-corner-large',
            '--md-shape-corner-xl',
            '--md-shape-corner-extra-large',
            '--md-shape-corner-full',
            '--md-shape-corner-btn',
            '--md-shape-corner-icon-btn',
            '--md-shape-corner-input',
            '--md-shape-corner-chip',
            '--md-shape-corner-card',
            '--md-shape-corner-panel',
            '--md-shape-corner-dialog',
            '--md-shape-corner-menu',
            '--md-shape-corner-toast',
            '--md-shape-corner-tab',
            '--md-shape-corner-thumb'
        ];
        cornerProps.forEach(p => root.style.removeProperty(p));
    }

    clearAccentCssVars() {
        const root = document.documentElement;
        const props = [
            '--md-primary',
            '--md-on-primary',
            '--md-primary-container',
            '--md-on-primary-container',
            '--md-primary-rgb',
            '--md-primary-fixed',
            '--md-primary-fixed-dim',
            '--md-on-primary-fixed',
            '--md-on-primary-fixed-variant',
            '--md-inverse-primary',
            '--md-primary-hover',
            '--md-primary-active',
            '--md-primary-subtle',
            '--md-secondary',
            '--md-on-secondary',
            '--md-secondary-container',
            '--md-on-secondary-container',
            '--md-tertiary',
            '--md-on-tertiary',
            '--md-tertiary-container',
            '--md-on-tertiary-container',
            '--md-sys-color-primary',
            '--md-sys-color-primary-rgb',
            '--md-sys-color-on-primary',
            '--md-sys-color-primary-container',
            '--md-sys-color-on-primary-container',
            '--md-sys-color-primary-container-rgb',
            '--md-sys-color-primary-fixed',
            '--md-sys-color-primary-fixed-dim',
            '--md-sys-color-on-primary-fixed',
            '--md-sys-color-on-primary-fixed-variant',
            '--md-sys-color-inverse-primary',
            '--md-sys-color-primary-hover',
            '--md-sys-color-primary-active',
            '--md-sys-color-primary-subtle',
            '--md-sys-color-secondary',
            '--md-sys-color-on-secondary',
            '--md-sys-color-secondary-container',
            '--md-sys-color-on-secondary-container',
            '--md-sys-color-tertiary',
            '--md-sys-color-on-tertiary',
            '--md-sys-color-tertiary-container',
            '--md-sys-color-on-tertiary-container'
        ];
        props.forEach(p => root.style.removeProperty(p));
    }

    applyAll() {
        this.clearCornerProps();
        this.applyingAll = true;
        try { Object.keys(this.settings).forEach(key => this.apply(key, this.settings[key])); }
        finally { this.applyingAll = false; }
        syncAmbientWeather(this.settings);
        syncSeasonalDetails(this.settings);
    }

    apply(key, value) {
        if(key==='basementPaletteUnlocked')syncBasementPalette(value);
        if(key==='developerUnlocked'||key==='developerWeatherBounds')document.documentElement.classList.toggle('developer-weather-bounds',this.settings.developerUnlocked&&this.settings.developerWeatherBounds);
        if(key==='developerUnlocked'||key==='developerPerformance')syncDeveloperMonitor(this.settings.developerUnlocked&&this.settings.developerPerformance);
        if((key==='developerHoliday'||key==='developerUnlocked')&&!this.applyingAll)syncSeasonalDetails(this.settings);
        if(key==='developerUnlocked'||key==='developerLayoutBounds')document.documentElement.classList.toggle('developer-layout-bounds',this.settings.developerUnlocked&&this.settings.developerLayoutBounds);
        const root = document.documentElement;
        switch (key) {
            case 'shortcutBindings':
                if(globalThis.window?.desktopAPI?.platform==='darwin')window.desktopAPI.setNativeShortcuts?.(value)?.catch(error=>console.warn('Native shortcuts:',error));
                break;
            case 'seasonalDetailsEnabled':if(!this.applyingAll)syncSeasonalDetails(this.settings);break;
            case 'liquidGlassEnabled':
                if(value===true)installLiquidGlassMotion();
                root.toggleAttribute('data-liquid-glass',value===true&&!this.settings.theme.includes('minecraft'));
                break;
            case 'clickEffectsEnabled':root.classList.toggle('no-click-effects',value===false);break;
            case 'animatedAccentsEnabled':root.classList.toggle('no-animated-accents',value===false);break;
            case 'cardMotionEnabled':root.classList.toggle('no-card-motion',value===false);break;
            case 'themeTransitionsEnabled':root.classList.toggle('no-theme-transition',value===false);break;
            case 'saveFeedbackEnabled':root.classList.toggle('no-save-feedback',value===false);break;
            case 'uiSoundProfile':syncUISounds(this.settings);break;
            case 'uiSoundsEnabled':
            case 'uiSoundVolume':
                syncUISounds(this.settings);
                break;
            case 'language':
                setLanguage(value);
                globalThis.window?.desktopAPI?.setLanguage?.(value)?.catch(error => console.warn('Native language:', error));
                break;
            case 'theme': {
                value = this.normalizeTheme(value);
                this.settings.theme = value;
                root.setAttribute('data-theme', value);
                this.apply('liquidGlassEnabled',this.settings.liquidGlassEnabled);
                if(!this.applyingAll)syncSeasonalDetails(this.settings);
                const currentAccent = this.get('accentColor');
                if (!currentAccent || currentAccent === 'auto') {
                    this.clearAccentCssVars();
                } else {
                    this.updateAccentCssVars(currentAccent);
                }
                break;
            }

            case 'fontFamily': {
                root.style.setProperty('--md-sys-font-family', "'Google Sans', sans-serif");
                break;
            }

            case 'accentFontFamily': {
                root.style.setProperty('--md-sys-font-accent', "'Google Sans', sans-serif");
                break;
            }

            case 'pipetteSampleSize': {
                const sample = document.getElementById('pipette-sample');
                if (sample) sample.value = value === '1x1' ? 'point' : value;
                break;
            }
            case 'snapEnabled': {
                const toggle = document.getElementById('move-snap');
                if (toggle) toggle.checked = value;
                break;
            }
            case 'moveLockAspect': {
                for (const id of ['move-lock-aspect', 'prop-lock-aspect']) {
                    const toggle = document.getElementById(id);
                    if (toggle) toggle.checked = value;
                }
                break;
            }
            case 'pixelPerfect': {
                const toggle = document.getElementById('pencil-pixel-perfect');
                if (toggle) toggle.checked = value;
                break;
            }
            case 'uiScale': {
                const scaleMap = { '90%': '0.92', '100%': '1', '110%': '1.08' };
                root.style.setProperty('--md-ui-scale', scaleMap[value] || '1');
                break;
            }

            case 'animationsEnabled':
                root.classList.toggle('no-animations', value === false);
                if (!this.applyingAll) syncAmbientWeather(this.settings);
                break;

            case 'weatherEffect':
            case 'weatherDensity':
            case 'weatherLeaves':
            case 'weatherScope':
            case 'weatherSpeed':
            case 'weatherWind':
            case 'weatherOpacity':
            case 'weatherSize':
            case 'weatherQuality':
                if (!this.applyingAll) syncAmbientWeather(this.settings);
                break;

            case 'accentColor':
                if (!value || value === 'auto') {
                    this.clearAccentCssVars();
                } else {
                    this.updateAccentCssVars(value);
                }
                break;

            case 'checkerStyle':
                root.setAttribute('data-checker', value);
                break;

            case 'discordRPC':
                window.desktopAPI?.setDiscordEnabled?.(value)?.catch?.(() => {});
                break;

            case 'discordClientId':
                window.desktopAPI?.setDiscordClientId?.(value)?.catch?.(() => {});
                break;

            case 'showPixelGrid':
            case 'gridOpacity':
            case 'gridColor':
            case 'gridMinZoom':
                window.mollyEditor?.workspace?.renderGrid();
                break;
        }
    }

    updateAccentCssVars(hex) {
        hex = this.normalizeAccentColor(hex);
        if (hex === 'auto') {
            this.clearAccentCssVars();
            return;
        }

        const root = document.documentElement;
        const rgb = this.hexToRgb(hex);
        if (!rgb) return;

        const currentTheme = root.getAttribute('data-theme') || '';
        const isLight = currentTheme.startsWith('light');
        const hsl = this.rgbToHsl(rgb.r, rgb.g, rgb.b);

        // Derive tonal companions from the selected hue and pair each surface
        // with the higher-contrast black or white foreground.
        const clamp = (number, min, max) => Math.min(max, Math.max(min, number));
        const containerLightness = isLight
            ? clamp(hsl.l + 38, 86, 96)
            : clamp(hsl.l - 30, 14, 28);
        const primaryRgb = this.readableAccentTone(hsl.h, Math.min(70, hsl.s), hsl.l, isLight);
        const containerRgb = this.hslToRgb(hsl.h, Math.min(70, hsl.s), containerLightness);
        const fixedRgb = this.hslToRgb(hsl.h, Math.min(70, hsl.s), 92);
        const fixedDimRgb = this.hslToRgb(hsl.h, Math.min(70, hsl.s), 82);
        const secondarySaturation = hsl.s === 0 ? 0 : clamp(Math.round(hsl.s * 0.35), 10, 28);
        const tertiarySaturation = hsl.s === 0 ? 0 : clamp(Math.round(hsl.s * 0.65), 24, 52);
        const secondaryRgb = this.readableAccentTone(hsl.h, secondarySaturation, isLight ? 40 : 80, isLight);
        const secondaryContainerRgb = this.hslToRgb(hsl.h, secondarySaturation, isLight ? 92 : 28);
        const tertiaryHue = (hsl.h + 40) % 360;
        const tertiaryRgb = this.readableAccentTone(tertiaryHue, tertiarySaturation, isLight ? 40 : 80, isLight);
        const tertiaryContainerRgb = this.hslToRgb(tertiaryHue, tertiarySaturation, isLight ? 92 : 32);
        const primaryHex = this.rgbToHex(primaryRgb);
        const onPrimary = this.bestOnColor(primaryRgb);
        const onContainer = this.bestOnColor(containerRgb);
        const onFixed = this.bestOnColor(fixedRgb);
        const onFixedDim = this.bestOnColor(fixedDimRgb);
        const onSecondary = this.bestOnColor(secondaryRgb);
        const onSecondaryContainer = this.bestOnColor(secondaryContainerRgb);
        const onTertiary = this.bestOnColor(tertiaryRgb);
        const onTertiaryContainer = this.bestOnColor(tertiaryContainerRgb);
        const container = `rgb(${containerRgb.r}, ${containerRgb.g}, ${containerRgb.b})`;
        const secondaryContainer = `rgb(${secondaryContainerRgb.r}, ${secondaryContainerRgb.g}, ${secondaryContainerRgb.b})`;
        const tertiaryContainer = `rgb(${tertiaryContainerRgb.r}, ${tertiaryContainerRgb.g}, ${tertiaryContainerRgb.b})`;

        root.style.setProperty('--md-primary', primaryHex);
        root.style.setProperty('--md-on-primary', onPrimary);
        root.style.setProperty('--md-primary-container', container);
        root.style.setProperty('--md-on-primary-container', onContainer);
        root.style.setProperty('--md-primary-rgb', `${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}`);
        root.style.setProperty('--md-primary-fixed', `rgb(${fixedRgb.r}, ${fixedRgb.g}, ${fixedRgb.b})`);
        root.style.setProperty('--md-primary-fixed-dim', `rgb(${fixedDimRgb.r}, ${fixedDimRgb.g}, ${fixedDimRgb.b})`);
        root.style.setProperty('--md-on-primary-fixed', onFixed);
        root.style.setProperty('--md-on-primary-fixed-variant', onFixedDim);
        root.style.setProperty('--md-inverse-primary', primaryHex);
        root.style.setProperty('--md-secondary', `rgb(${secondaryRgb.r}, ${secondaryRgb.g}, ${secondaryRgb.b})`);
        root.style.setProperty('--md-on-secondary', onSecondary);
        root.style.setProperty('--md-secondary-container', secondaryContainer);
        root.style.setProperty('--md-on-secondary-container', onSecondaryContainer);
        root.style.setProperty('--md-tertiary', `rgb(${tertiaryRgb.r}, ${tertiaryRgb.g}, ${tertiaryRgb.b})`);
        root.style.setProperty('--md-on-tertiary', onTertiary);
        root.style.setProperty('--md-tertiary-container', tertiaryContainer);
        root.style.setProperty('--md-on-tertiary-container', onTertiaryContainer);

        root.style.setProperty('--md-sys-color-primary', primaryHex);
        root.style.setProperty('--md-sys-color-primary-rgb', `${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}`);
        root.style.setProperty('--md-sys-color-on-primary', onPrimary);
        root.style.setProperty('--md-sys-color-primary-container', container);
        root.style.setProperty('--md-sys-color-on-primary-container', onContainer);
        root.style.setProperty('--md-sys-color-primary-container-rgb', `${containerRgb.r}, ${containerRgb.g}, ${containerRgb.b}`);
        root.style.setProperty('--md-sys-color-primary-fixed', `rgb(${fixedRgb.r}, ${fixedRgb.g}, ${fixedRgb.b})`);
        root.style.setProperty('--md-sys-color-primary-fixed-dim', `rgb(${fixedDimRgb.r}, ${fixedDimRgb.g}, ${fixedDimRgb.b})`);
        root.style.setProperty('--md-sys-color-on-primary-fixed', onFixed);
        root.style.setProperty('--md-sys-color-on-primary-fixed-variant', onFixedDim);
        root.style.setProperty('--md-sys-color-inverse-primary', primaryHex);
        root.style.setProperty('--md-sys-color-secondary', `rgb(${secondaryRgb.r}, ${secondaryRgb.g}, ${secondaryRgb.b})`);
        root.style.setProperty('--md-sys-color-on-secondary', onSecondary);
        root.style.setProperty('--md-sys-color-secondary-container', secondaryContainer);
        root.style.setProperty('--md-sys-color-on-secondary-container', onSecondaryContainer);
        root.style.setProperty('--md-sys-color-tertiary', `rgb(${tertiaryRgb.r}, ${tertiaryRgb.g}, ${tertiaryRgb.b})`);
        root.style.setProperty('--md-sys-color-on-tertiary', onTertiary);
        root.style.setProperty('--md-sys-color-tertiary-container', tertiaryContainer);
        root.style.setProperty('--md-sys-color-on-tertiary-container', onTertiaryContainer);

        // Material state layers (pure flat opacity overlays without glows)
        root.style.setProperty('--md-primary-hover', `rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0.08)`);
        root.style.setProperty('--md-primary-active', `rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0.14)`);
        root.style.setProperty('--md-primary-subtle', `rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0.12)`);
        root.style.setProperty('--md-sys-color-primary-hover', `rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0.08)`);
        root.style.setProperty('--md-sys-color-primary-active', `rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0.14)`);
        root.style.setProperty('--md-sys-color-primary-subtle', `rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0.12)`);
    }

    readableAccentTone(hue, saturation, preferredLightness, isLight) {
        const surface = isLight ? { r: 255, g: 255, b: 255 } : { r: 55, g: 57, b: 59 };
        let best = null;
        let distance = Infinity;
        for (let lightness = 0; lightness <= 100; lightness++) {
            const candidate = this.hslToRgb(hue, saturation, lightness);
            if (this.contrastRatio(candidate, surface) < 4.5) continue;
            const candidateDistance = Math.abs(lightness - preferredLightness);
            if (candidateDistance < distance) {
                best = candidate;
                distance = candidateDistance;
            }
        }
        return best || this.hslToRgb(hue, saturation, preferredLightness);
    }

    rgbToHex({ r, g, b }) {
        return `#${[r, g, b].map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    }

    bestOnColor(background) {
        const light = { r: 255, g: 255, b: 255 };
        const dark = { r: 0, g: 0, b: 0 };
        return this.contrastRatio(background, light) >= this.contrastRatio(background, dark) ? '#FFFFFF' : '#000000';
    }

    contrastRatio(first, second) {
        const luminance = ({ r, g, b }) => {
            const linear = [r, g, b].map(channel => {
                const value = channel / 255;
                return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
            });
            return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
        };
        const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
        return (values[0] + 0.05) / (values[1] + 0.05);
    }

    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }

    rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;

        if (max === min) {
            h = s = 0;
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
    }

    hslToRgb(h, s, l) {
        h /= 360; s /= 100; l /= 100;
        let r, g, b;

        if (s === 0) {
            r = g = b = l;
        } else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };

            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }

        return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
    }
}
