/** Fit adjacent corner radii together without changing their relative proportions. */
export function prefixCornerRadii(width, height, corners) {
    const radii = corners.map(radius => Math.max(0, radius));
    const [tl, tr, br, bl] = radii;
    const scale = Math.min(1, width / (tl + tr || 1), width / (bl + br || 1), height / (tl + bl || 1), height / (tr + br || 1));
    return radii.map(radius => radius * scale);
}

/** Test pixel centres against circular arcs. No canvas antialiasing enters the PNG. */
export function prefixRoundedRect(width, height, corners, inset = 0) {
    const innerWidth = width - inset * 2, innerHeight = height - inset * 2;
    if (innerWidth <= 0 || innerHeight <= 0) return () => false;
    const outer = prefixCornerRadii(width, height, corners);
    const [tl, tr, br, bl] = prefixCornerRadii(innerWidth, innerHeight, outer.map(radius => Math.max(0, radius - inset)));
    const within = (x, y, radius) => x * x + y * y <= radius * radius + 1e-8;
    return (x, y) => {
        x = x - inset + .5; y = y - inset + .5;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
        if (x < tl && y < tl) return within(x - tl, y - tl, tl);
        if (x > innerWidth - tr && y < tr) return within(x - innerWidth + tr, y - tr, tr);
        if (x > innerWidth - br && y > innerHeight - br) return within(x - innerWidth + br, y - innerHeight + br, br);
        if (x < bl && y > innerHeight - bl) return within(x - bl, y - innerHeight + bl, bl);
        return true;
    };
}
