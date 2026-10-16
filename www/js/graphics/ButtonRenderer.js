/** Pixel renderer shared by the standalone and embedded button generators. */
export default class ButtonRenderer {
    hexToRgb(hex) {
        hex = hex.replace('#', '').trim();
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const num = parseInt(hex, 16);
        return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
    }

    rgbToHex(r, g, b) {
        return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('').toUpperCase();
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
        return [h, s, l];
    }

    hslToRgb(h, s, l) {
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
        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }

    calculateMinecraftShades(baseHex, tinted) {
        if (baseHex.toUpperCase() === '#C5C5C5') {
            return {
                surface: '#C5C5C5',
                highlight: '#ECECEC',
                shadow: '#7C7C7C',
                border: tinted ? '#262626' : '#000000'
            };
        }
        const [r, g, b] = this.hexToRgb(baseHex);
        const [h, s, l] = this.rgbToHsl(r, g, b);

        const hl_l = Math.min(1.0, l + (1.0 - l) * 0.45);
        const hl_s = Math.max(0.0, s * 0.85);
        const [hl_r, hl_g, hl_b] = this.hslToRgb(h, hl_s, hl_l);

        const sh_l = Math.max(0.0, l * 0.63);
        const sh_s = Math.min(1.0, s * 1.05);
        const [sh_r, sh_g, sh_b] = this.hslToRgb(h, sh_s, sh_l);

        let bd_hex = '#000000';
        if (tinted) {
            const bd_l = Math.max(0.0, l * 0.18);
            const [bd_r, bd_g, bd_b] = this.hslToRgb(h, s, bd_l);
            bd_hex = this.rgbToHex(bd_r, bd_g, bd_b);
        }
        return {
            surface: baseHex.toUpperCase(),
            highlight: this.rgbToHex(hl_r, hl_g, hl_b),
            shadow: this.rgbToHex(sh_r, sh_g, sh_b),
            border: bd_hex
        };
    }

    getWidth(cols) {
        if (this.currentSlotMode === 'full') {
            return cols * this.currentSlotSize;
        } else {
            return this.currentSlotSize === 18 ? (16 + (cols - 1) * 18) : Math.max(4, cols * this.currentSlotSize - 2);
        }
    }

    getHeight(rows) {
        if (this.currentSlotMode === 'full') {
            return rows * this.currentSlotSize;
        } else {
            return this.currentSlotSize === 18 ? (16 + (rows - 1) * 18) : Math.max(5, rows * this.currentSlotSize - 2);
        }
    }

    /* ==========================================================================
       PIXEL-PERFECT PROCEDURAL BUTTON RENDERER: NORMAL ONLY
       ========================================================================== */

    sampleMultiGradient(stops, t) {
        if (!stops || stops.length === 0) return [197, 197, 197];
        if (stops.length === 1) return this.hexToRgb(stops[0]);
        const clampedT = Math.max(0, Math.min(1, t));
        const maxIdx = stops.length - 1;
        const scaled = clampedT * maxIdx;
        const idx = Math.min(Math.floor(scaled), maxIdx - 1);
        const frac = scaled - idx;
        const [r1, g1, b1] = this.hexToRgb(stops[idx]);
        const [r2, g2, b2] = this.hexToRgb(stops[idx + 1]);
        return [
            Math.round(r1 + (r2 - r1) * frac),
            Math.round(g1 + (g2 - g1) * frac),
            Math.round(b1 + (b2 - b1) * frac)
        ];
    }

    renderButton(w, h, colPalette, style, opacity, transpBorder, chin, shadow) {
        w = Math.max(1, Math.min(4096, Math.round(Number(w) || 18)));
        h = Math.max(1, Math.min(4096, Math.round(Number(h) || 18)));
        style = ['default', 'ten', 'flat'].includes(style) ? style : 'default';
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const cctx = c.getContext('2d');
        const imgData = cctx.createImageData(w, h);
        const data = imgData.data;

        const alphaSurf = Math.max(0, Math.min(255, Math.round((opacity / 100) * 255)));
        const alphaBorder = transpBorder ? alphaSurf : 255;

        const [br, bg, bb] = this.hexToRgb(colPalette.border);
        const [hr, hg, hb] = this.hexToRgb(colPalette.highlight);
        const [sr, sg, sb] = this.hexToRgb(colPalette.shadow);
        const [sfr, sfg, sfb] = this.hexToRgb(colPalette.surface);

        const cBorder = [br, bg, bb, alphaBorder];
        const cHighlight = [hr, hg, hb, alphaBorder];
        const cShadow = [sr, sg, sb, alphaBorder];
        const cSurface = [sfr, sfg, sfb, alphaSurf];

        const isGradient = (this.colorMode === 'gradient');
        let lut = null;
        if (isGradient) {
            const steps = 256;
            lut = new Array(steps);

            for (let i = 0; i < steps; i++) {
                const t = i / (steps - 1);
                const [gr, gg, gb] = this.sampleMultiGradient(this.gradientColors, t);

                const curSurf = [gr, gg, gb, alphaSurf];

                let curHighlight, curShadow, curBorder;
                if (this.autoShadeEnabled) {
                    const [h_val, s_val, l_val] = this.rgbToHsl(gr, gg, gb);

                    const hl_l = Math.min(1.0, l_val + (1.0 - l_val) * 0.45);
                    const hl_s = Math.max(0.0, s_val * 0.85);
                    const [hl_r, hl_g, hl_b] = this.hslToRgb(h_val, hl_s, hl_l);
                    curHighlight = [hl_r, hl_g, hl_b, alphaBorder];

                    const sh_l = Math.max(0.0, l_val * 0.63);
                    const sh_s = Math.min(1.0, s_val * 1.05);
                    const [sh_r, sh_g, sh_b] = this.hslToRgb(h_val, sh_s, sh_l);
                    curShadow = [sh_r, sh_g, sh_b, alphaBorder];

                    const bd_l = this.tintedBorderEnabled ? Math.max(0.06, l_val * 0.25) : Math.max(0.02, l_val * 0.15);
                    const [bd_r, bd_g, bd_b] = this.hslToRgb(h_val, s_val, bd_l);
                    curBorder = [bd_r, bd_g, bd_b, alphaBorder];
                } else {
                    curHighlight = cHighlight;
                    curShadow = cShadow;
                    curBorder = cBorder;
                }
                lut[i] = { curSurf, curHighlight, curShadow, curBorder };
            }
        }

        const chinVal = (chin !== undefined) ? chin : this.currentChin;
        const shadowVal = (shadow !== undefined) ? shadow : this.currentShadow;
        const chinH = Math.max(0, Math.min(chinVal, 5, Math.floor((h - 3) / 2)));
        const shW = Math.max(1, Math.min(shadowVal, 5, Math.floor((Math.min(w, h) - 2) / 2)));

        const rad = ((this.gradientAngle ?? 90) * Math.PI) / 180;
        const dx = Math.sin(rad);
        const dy = -Math.cos(rad);
        const cx = (w - 1) / 2;
        const cy = (h - 1) / 2;
        const maxDist = Math.abs(cx * dx) + Math.abs(cy * dy);

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;

                let curSurf, curHighlight, curShadow, curBorder;
                if (isGradient) {
                    const dist = (x - cx) * dx + (y - cy) * dy;
                    const t = maxDist < 0.001 ? 0.5 : Math.max(0, Math.min(1, (dist + maxDist) / (2 * maxDist)));
                    const lutIdx = Math.min(255, Math.max(0, Math.round(t * 255)));
                    const entry = lut[lutIdx];
                    curSurf = entry.curSurf;
                    curHighlight = entry.curHighlight;
                    curShadow = entry.curShadow;
                    curBorder = entry.curBorder;
                } else {
                    curSurf = cSurface;
                    curHighlight = cHighlight;
                    curShadow = cShadow;
                    curBorder = cBorder;
                }

                let col;
                if (style === 'ten') {
                    if (y === 0 || y === h - 1 || x === 0 || x === w - 1) {
                        col = curBorder;
                    } else if (y >= h - 1 - chinH) {
                        col = curShadow;
                    } else if (y < 1 + shW || (y >= h - 1 - chinH - shW && y < h - 1 - chinH) || x < 1 + shW || x >= w - 1 - shW) {
                        col = curHighlight;
                    } else {
                        col = curSurf;
                    }
                } else if (y === 0 || y === h - 1 || x === 0 || x === w - 1) {
                    col = curBorder;
                } else if (style === 'default') {
                    const bShadow = shW + (chinH - 1);
                    const isTopRightCorner = (x >= w - 1 - shW && y < 1 + shW);
                    const isBottomLeftCorner = (x < 1 + shW && y >= h - 1 - bShadow);

                    if (isTopRightCorner || isBottomLeftCorner) {
                        col = curSurf;
                    } else if (y < 1 + shW || x < 1 + shW) {
                        col = curHighlight;
                    } else if (y >= h - 1 - bShadow || x >= w - 1 - shW) {
                        col = curShadow;
                    } else {
                        col = curSurf;
                    }
                } else if (style === 'flat') {
                    const bThick = shW + (chinH - 1);
                    if (y < 1 + shW || y >= h - 1 - bThick || x < 1 + shW || x >= w - 1 - shW) {
                        col = curHighlight;
                    } else {
                        col = curSurf;
                    }
                }

                data[idx] = col[0];
                data[idx + 1] = col[1];
                data[idx + 2] = col[2];
                data[idx + 3] = col[3];
            }
        }
        cctx.putImageData(imgData, 0, 0);
        return c;
    }

    /* ==========================================================================
       VIEW RENDERING (GUI EXCLUSIVE)
       ========================================================================== */
}
