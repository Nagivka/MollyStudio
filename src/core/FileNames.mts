/** A single safe filename stem for project saves and image exports. */
export function safeFileStem(value: unknown, fallback = 'image') {
    const clean = (input: unknown) => Array.from(String(input ?? '').normalize('NFC')
        .replace(/[\u0000-\u001F\u007F\\/:*?"<>|]/g, '_').trim()).slice(0, 96).join('').replace(/[. ]+$/g, '');
    let name = clean(value) || clean(fallback) || 'image';
    if (/^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(name))
        name = '_' + name;
    return name;
}
