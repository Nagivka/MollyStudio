/** Bounds shared by automatic layout and the existing inspector drag handle. */
export function inspectorBounds(viewportWidth, toolbarWidth, pixelTheme = false) {
    const width = Math.max(1, Number(viewportWidth) || 1);
    const toolbar = Math.max(0, Number(toolbarWidth) || 0);
    const minimum = pixelTheme
        ? Math.max(232, Math.min(320, Math.round(width * .35)))
        : Math.max(216, Math.min(260, Math.round(width * .3)));
    const canvas = Math.min(380, Math.round(width * .4));
    const maximum = Math.max(minimum, Math.min(
        520,
        Math.floor(width * .45),
        width - toolbar - canvas - 6
    ));
    return { minimum, maximum };
}
