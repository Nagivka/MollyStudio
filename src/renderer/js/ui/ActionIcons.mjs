/** Stable meanings shared by Material Symbols and the Minecraft pixel aliases. */
export const ACTION_ICONS = Object.freeze({
    'file-home': 'home', 'file-new': 'add_box', 'file-open': 'folder_open',
    'file-save': 'save', 'file-save-as': 'save_as', 'file-template': 'dashboard_customize',
    'file-designs': 'palette', 'file-texture': 'texture',
    'file-export-png': 'download', 'file-export-layer': 'file_download',
    'file-export-selected': 'collections', 'file-export-repeat': 'replay',
    'settings-open': 'settings', 'edit-undo': 'undo', 'edit-redo': 'redo',
    'select-cut': 'content_cut', 'select-copy': 'content_copy', 'select-paste': 'content_paste',
    'edit-clear-layer': 'ink_eraser', 'image-canvas-size': 'aspect_ratio',
    'transform-fliph': 'swap_horiz', 'transform-flipv': 'swap_vert',
    'transform-rotcw': 'rotate_right', 'transform-rotccw': 'rotate_left',
    'transform-invert': 'invert_colors', 'image-recolor': 'find_replace',
    'image-load-ref': 'add_photo_alternate', 'image-clear-ref': 'hide_image',
    'layer-new': 'add_box', 'layer-duplicate': 'content_copy', 'layer-mergedown': 'call_merge',
    'layer-flatten': 'layers', 'layer-outline': 'crop_square', 'layer-dropshadow': 'shadow',
    'layer-delete': 'delete', 'tools-button-generator': 'smart_button',
    'utility-smallcaps': 'text_fields', 'utility-gradient': 'gradient',
    'select-all': 'select_all', 'select-deselect': 'deselect', 'select-invert': 'flip_to_back',
    'select-content': 'filter_center_focus', 'select-grow': 'expand', 'select-shrink': 'compress',
    'view-rulers': 'straighten', 'view-guides': 'grid_guides', 'view-clear-guides': 'delete_sweep',
    'view-tiling': 'texture', 'view-grid': 'grid_4x4', 'view-zoom-in': 'zoom_in', 'view-zoom-out': 'zoom_out',
    'view-zoom-fit': 'fullscreen', 'view-zoom-reset': 'center_focus_strong', 'help-hotkeys': 'keyboard'
});

export function actionIcon(action) { return ACTION_ICONS[action] || null; }
