import { MINECRAFT_ITEMS } from './MinecraftItems.js';
import { MINECRAFT_BLOCKS } from './MinecraftBlocks.js';

// Only inventory materials belong in a server menu; particles, effects and paintings are editor assets.
const materials = new Map();
// These are alternate sprites, not Bukkit material IDs. Keep them available to
// the graphic editor, but never emit CROSSBOW_ARROW or a map texture as material.
const spriteVariants = new Set(['crossbow_arrow', 'crossbow_firework', 'crossbow_standby', 'elytra_broken', 'fishing_rod_cast']);
for (const item of MINECRAFT_ITEMS) {
    if ((item.folder || 'items_minecraft') !== 'items_minecraft') continue;
    if (spriteVariants.has(item.id) || item.id.endsWith('_map') && item.id !== 'filled_map') continue;
    const material = item.id.toUpperCase();
    materials.set(material, { ...item, material, path: `assets/${item.folder || 'items_minecraft'}/${item.file}` });
}
for (const item of MINECRAFT_BLOCKS) {
    const material = item.minecraftId.toUpperCase();
    materials.set(material, { ...item, material, path: `assets/${item.folder}/${item.file}` });
}
export const MENU_MATERIALS = [...materials.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru'));
export const findMenuMaterial = value => materials.get(String(value).replace(/^minecraft:/i,'').toUpperCase());
