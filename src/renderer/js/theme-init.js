/**
 * theme-init.js - Immediate Theme & Accent FOUC Prevention
 * Runs synchronously in <head> before stylesheets or body render
 * to eliminate theme and accent flashing on window/tab opening,
 * and maintains real-time synchronization across all windows.
 */
(function() {
    var supportedThemes = ['dark', 'oled', 'midnight', 'forest', 'amethyst', 'light', 'light-nord', 'light-warm', 'light-rose', 'light-mint', 'minecraft', 'light-minecraft'];

    function normalizeTheme(theme) {
        return supportedThemes.indexOf(theme) === -1 ? 'dark' : theme;
    }

    function rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        var max = Math.max(r, g, b), min = Math.min(r, g, b);
        var h, s, l = (max + min) / 2;
        if (max === min) {
            h = s = 0;
        } else {
            var d = max - min;
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

    function hslToRgb(h, s, l) {
        h /= 360; s /= 100; l /= 100;
        var r, g, b;
        if (s === 0) {
            r = g = b = l;
        } else {
            var hue2rgb = function(p, q, t) {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };
            var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            var p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }
        return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
    }

    function relativeLuminance(hex) {
        var channels = [
            parseInt(hex.slice(1, 3), 16),
            parseInt(hex.slice(3, 5), 16),
            parseInt(hex.slice(5, 7), 16)
        ].map(function(channel) {
            var value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    }

    function contrastRatio(a, b) {
        var first = relativeLuminance(a);
        var second = relativeLuminance(b);
        return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    }

    function bestOnColor(background) {
        var light = '#FFFFFF';
        var dark = '#000000';
        return contrastRatio(background, light) >= contrastRatio(background, dark) ? light : dark;
    }

    function rgbToHex(rgb) {
        return '#' + [rgb.r, rgb.g, rgb.b].map(function(channel) {
            return channel.toString(16).padStart(2, '0');
        }).join('');
    }

    function readableAccentTone(hue, saturation, preferredLightness, isLight) {
        var surface = isLight ? '#FFFFFF' : '#37393B';
        var best = null;
        var distance = Infinity;
        for (var lightness = 0; lightness <= 100; lightness++) {
            var candidate = hslToRgb(hue, saturation, lightness);
            if (contrastRatio(rgbToHex(candidate), surface) < 4.5) continue;
            var candidateDistance = Math.abs(lightness - preferredLightness);
            if (candidateDistance < distance) {
                best = candidate;
                distance = candidateDistance;
            }
        }
        return best || hslToRgb(hue, saturation, preferredLightness);
    }

    function clearAccentProps(root) {
        root.style.removeProperty('--md-primary');
        root.style.removeProperty('--md-on-primary');
        root.style.removeProperty('--md-primary-container');
        root.style.removeProperty('--md-on-primary-container');
        root.style.removeProperty('--md-primary-rgb');
        root.style.removeProperty('--md-primary-fixed');
        root.style.removeProperty('--md-primary-fixed-dim');
        root.style.removeProperty('--md-on-primary-fixed');
        root.style.removeProperty('--md-on-primary-fixed-variant');
        root.style.removeProperty('--md-inverse-primary');
        root.style.removeProperty('--md-primary-hover');
        root.style.removeProperty('--md-primary-active');
        root.style.removeProperty('--md-primary-subtle');
        root.style.removeProperty('--md-secondary');
        root.style.removeProperty('--md-on-secondary');
        root.style.removeProperty('--md-secondary-container');
        root.style.removeProperty('--md-on-secondary-container');
        root.style.removeProperty('--md-tertiary');
        root.style.removeProperty('--md-on-tertiary');
        root.style.removeProperty('--md-tertiary-container');
        root.style.removeProperty('--md-on-tertiary-container');
        root.style.removeProperty('--md-sys-color-primary');
        root.style.removeProperty('--md-sys-color-primary-rgb');
        root.style.removeProperty('--md-sys-color-on-primary');
        root.style.removeProperty('--md-sys-color-primary-container');
        root.style.removeProperty('--md-sys-color-on-primary-container');
        root.style.removeProperty('--md-sys-color-primary-container-rgb');
        root.style.removeProperty('--md-sys-color-primary-fixed');
        root.style.removeProperty('--md-sys-color-primary-fixed-dim');
        root.style.removeProperty('--md-sys-color-on-primary-fixed');
        root.style.removeProperty('--md-sys-color-on-primary-fixed-variant');
        root.style.removeProperty('--md-sys-color-inverse-primary');
        root.style.removeProperty('--md-sys-color-primary-hover');
        root.style.removeProperty('--md-sys-color-primary-active');
        root.style.removeProperty('--md-sys-color-primary-subtle');
        root.style.removeProperty('--md-sys-color-secondary');
        root.style.removeProperty('--md-sys-color-on-secondary');
        root.style.removeProperty('--md-sys-color-secondary-container');
        root.style.removeProperty('--md-sys-color-on-secondary-container');
        root.style.removeProperty('--md-sys-color-tertiary');
        root.style.removeProperty('--md-sys-color-on-tertiary');
        root.style.removeProperty('--md-sys-color-tertiary-container');
        root.style.removeProperty('--md-sys-color-on-tertiary-container');
    }

    function clearCornerProps(root) {
        var cornerProps = [
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
        for (var i = 0; i < cornerProps.length; i++) {
            root.style.removeProperty(cornerProps[i]);
        }
    }

    function applySettings(s) {
        var root = document.documentElement;
        clearCornerProps(root);
        if (!s) return;

        // Apply theme immediately
        if (s.theme) {
            root.setAttribute('data-theme', normalizeTheme(s.theme));
        }
        root.classList.toggle('no-animations', s.animationsEnabled === false);

        // Apply font immediately
        root.style.setProperty('--md-sys-font-family', "'Google Sans', sans-serif");
        root.style.setProperty('--md-sys-font-accent', "'Google Sans', sans-serif");

        // Apply accent color tokens if custom, or clear to let the theme dictate colors
        var normalizedAccent = typeof s.accentColor === 'string' ? s.accentColor.trim() : 'auto';
        if (/^#[0-9A-Fa-f]{6}$/.test(normalizedAccent)) {
            var hex = normalizedAccent.toUpperCase();
            var r = parseInt(hex.slice(1,3), 16), g = parseInt(hex.slice(3,5), 16), b = parseInt(hex.slice(5,7), 16);
            var currentTheme = root.getAttribute('data-theme') || '';
            var isLight = currentTheme.startsWith('light');
            var hsl = rgbToHsl(r, g, b);

            var clamp = function(value, min, max) { return Math.min(max, Math.max(min, value)); };
            var containerLightness = isLight
                ? clamp(hsl.l + 38, 86, 96)
                : clamp(hsl.l - 30, 14, 28);
            var saturation = Math.min(hsl.s, 70);
            var primaryRgb = readableAccentTone(hsl.h, saturation, hsl.l, isLight);
            var primaryHex = rgbToHex(primaryRgb).toUpperCase();
            var containerRgb = hslToRgb(hsl.h, saturation, containerLightness);
            var fixedRgb = hslToRgb(hsl.h, saturation, 92);
            var fixedDimRgb = hslToRgb(hsl.h, saturation, 82);
            var secondarySaturation = hsl.s === 0 ? 0 : clamp(Math.round(hsl.s * 0.35), 10, 28);
            var tertiarySaturation = hsl.s === 0 ? 0 : clamp(Math.round(hsl.s * 0.65), 24, 52);
            var secondaryRgb = readableAccentTone(hsl.h, secondarySaturation, isLight ? 40 : 80, isLight);
            var secondaryContainerRgb = hslToRgb(hsl.h, secondarySaturation, isLight ? 92 : 28);
            var tertiaryHue = (hsl.h + 40) % 360;
            var tertiaryRgb = readableAccentTone(tertiaryHue, tertiarySaturation, isLight ? 40 : 80, isLight);
            var tertiaryContainerRgb = hslToRgb(tertiaryHue, tertiarySaturation, isLight ? 92 : 32);
            var onPrimary = bestOnColor(primaryHex);
            var onContainer = bestOnColor(rgbToHex(containerRgb));
            var onFixed = bestOnColor(rgbToHex(fixedRgb));
            var onFixedDim = bestOnColor(rgbToHex(fixedDimRgb));
            var onSecondary = bestOnColor(rgbToHex(secondaryRgb));
            var onSecondaryContainer = bestOnColor(rgbToHex(secondaryContainerRgb));
            var onTertiary = bestOnColor(rgbToHex(tertiaryRgb));
            var onTertiaryContainer = bestOnColor(rgbToHex(tertiaryContainerRgb));
            var container = 'rgb(' + containerRgb.r + ', ' + containerRgb.g + ', ' + containerRgb.b + ')';
            var secondaryContainer = 'rgb(' + secondaryContainerRgb.r + ', ' + secondaryContainerRgb.g + ', ' + secondaryContainerRgb.b + ')';
            var tertiaryContainer = 'rgb(' + tertiaryContainerRgb.r + ', ' + tertiaryContainerRgb.g + ', ' + tertiaryContainerRgb.b + ')';

            root.style.setProperty('--md-primary', primaryHex);
            root.style.setProperty('--md-on-primary', onPrimary);
            root.style.setProperty('--md-primary-container', container);
            root.style.setProperty('--md-on-primary-container', onContainer);
            root.style.setProperty('--md-primary-rgb', primaryRgb.r + ', ' + primaryRgb.g + ', ' + primaryRgb.b);
            root.style.setProperty('--md-primary-fixed', 'rgb(' + fixedRgb.r + ', ' + fixedRgb.g + ', ' + fixedRgb.b + ')');
            root.style.setProperty('--md-primary-fixed-dim', 'rgb(' + fixedDimRgb.r + ', ' + fixedDimRgb.g + ', ' + fixedDimRgb.b + ')');
            root.style.setProperty('--md-on-primary-fixed', onFixed);
            root.style.setProperty('--md-on-primary-fixed-variant', onFixedDim);
            root.style.setProperty('--md-inverse-primary', primaryHex);
            root.style.setProperty('--md-secondary', 'rgb(' + secondaryRgb.r + ', ' + secondaryRgb.g + ', ' + secondaryRgb.b + ')');
            root.style.setProperty('--md-on-secondary', onSecondary);
            root.style.setProperty('--md-secondary-container', secondaryContainer);
            root.style.setProperty('--md-on-secondary-container', onSecondaryContainer);
            root.style.setProperty('--md-tertiary', 'rgb(' + tertiaryRgb.r + ', ' + tertiaryRgb.g + ', ' + tertiaryRgb.b + ')');
            root.style.setProperty('--md-on-tertiary', onTertiary);
            root.style.setProperty('--md-tertiary-container', tertiaryContainer);
            root.style.setProperty('--md-on-tertiary-container', onTertiaryContainer);

            root.style.setProperty('--md-sys-color-primary', primaryHex);
            root.style.setProperty('--md-sys-color-primary-rgb', primaryRgb.r + ', ' + primaryRgb.g + ', ' + primaryRgb.b);
            root.style.setProperty('--md-sys-color-on-primary', onPrimary);
            root.style.setProperty('--md-sys-color-primary-container', container);
            root.style.setProperty('--md-sys-color-on-primary-container', onContainer);
            root.style.setProperty('--md-sys-color-primary-container-rgb', containerRgb.r + ', ' + containerRgb.g + ', ' + containerRgb.b);
            root.style.setProperty('--md-sys-color-primary-fixed', 'rgb(' + fixedRgb.r + ', ' + fixedRgb.g + ', ' + fixedRgb.b + ')');
            root.style.setProperty('--md-sys-color-primary-fixed-dim', 'rgb(' + fixedDimRgb.r + ', ' + fixedDimRgb.g + ', ' + fixedDimRgb.b + ')');
            root.style.setProperty('--md-sys-color-on-primary-fixed', onFixed);
            root.style.setProperty('--md-sys-color-on-primary-fixed-variant', onFixedDim);
            root.style.setProperty('--md-sys-color-inverse-primary', primaryHex);
            root.style.setProperty('--md-sys-color-secondary', 'rgb(' + secondaryRgb.r + ', ' + secondaryRgb.g + ', ' + secondaryRgb.b + ')');
            root.style.setProperty('--md-sys-color-on-secondary', onSecondary);
            root.style.setProperty('--md-sys-color-secondary-container', secondaryContainer);
            root.style.setProperty('--md-sys-color-on-secondary-container', onSecondaryContainer);
            root.style.setProperty('--md-sys-color-tertiary', 'rgb(' + tertiaryRgb.r + ', ' + tertiaryRgb.g + ', ' + tertiaryRgb.b + ')');
            root.style.setProperty('--md-sys-color-on-tertiary', onTertiary);
            root.style.setProperty('--md-sys-color-tertiary-container', tertiaryContainer);
            root.style.setProperty('--md-sys-color-on-tertiary-container', onTertiaryContainer);

            root.style.setProperty('--md-primary-hover', 'rgba(' + primaryRgb.r + ', ' + primaryRgb.g + ', ' + primaryRgb.b + ', 0.08)');
            root.style.setProperty('--md-primary-active', 'rgba(' + primaryRgb.r + ', ' + primaryRgb.g + ', ' + primaryRgb.b + ', 0.14)');
            root.style.setProperty('--md-primary-subtle', 'rgba(' + primaryRgb.r + ', ' + primaryRgb.g + ', ' + primaryRgb.b + ', 0.12)');
            root.style.setProperty('--md-sys-color-primary-hover', 'rgba(' + primaryRgb.r + ', ' + primaryRgb.g + ', ' + primaryRgb.b + ', 0.08)');
            root.style.setProperty('--md-sys-color-primary-active', 'rgba(' + primaryRgb.r + ', ' + primaryRgb.g + ', ' + primaryRgb.b + ', 0.14)');
            root.style.setProperty('--md-sys-color-primary-subtle', 'rgba(' + primaryRgb.r + ', ' + primaryRgb.g + ', ' + primaryRgb.b + ', 0.12)');
        } else {
            clearAccentProps(root);
        }
    }

    try {
        var raw = localStorage.getItem('molly_settings_m3');
        if (raw) {
            applySettings(JSON.parse(raw));
        }
    } catch(e) {}

    // Live sync across windows via storage events
    window.addEventListener('storage', function(e) {
        if (e.key === 'molly_settings_m3' && e.newValue) {
            try {
                applySettings(JSON.parse(e.newValue));
            } catch(err) {}
        }
    });

    // Live sync across application windows
    if (typeof window !== 'undefined') {
        var attachBridge = function() {
            if (window.desktopAPI && window.desktopAPI.onSettingsUpdated) {
                window.desktopAPI.onSettingsUpdated(function(data) {
                    var s = (data && data.settings) ? data.settings : data;
                    if (s) applySettings(s);
                });
            }
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', attachBridge);
        } else {
            attachBridge();
        }
    }
})();
