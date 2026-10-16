export function normalizeWorkspaceState(value = {}) {
    const guides = axis => [...new Set((Array.isArray(value.guides?.[axis]) ? value.guides[axis] : [])
        .filter(item => Number.isFinite(item) && Math.abs(item) <= 1e6).slice(0, 512))].sort((a,b)=>a-b);
    const source = value.referenceSrc;
    const referenceSrc = typeof source === 'string' && source.length <= 24 * 1024 * 1024
        && /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(source) ? source : null;
    return { guides: { horizontal: guides('horizontal'), vertical: guides('vertical') },
        guidesVisible: value.guidesVisible !== false, tilingMode: value.tilingMode === true,
        referenceSrc, referenceOpacity: Number.isFinite(value.referenceOpacity) ? Math.max(.05, Math.min(1, value.referenceOpacity)) : .4 };
}

export function readWorkspaceState(app, project) {
    const workspace = app.activeProjectId === project.id ? app.workspace : null;
    return normalizeWorkspaceState(workspace ? { ...workspace,
        referenceSrc: workspace.referenceImg?.getAttribute('src') || null } : project);
}
