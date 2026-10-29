function collectUntranslated() {
    const found = new Set(), excluded = 'script,style,textarea,.material-symbols-rounded,.m3-recent-name,.layer-name,#prop-layer-name,[data-prefix-existing-block],#utility-preview,canvas';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let text;
    while ((text = walker.nextNode())) {
        const value = text.data.trim();
        if (/[А-Яа-яЁё]/.test(value) && !text.parentElement.closest(excluded) && value !== 'Русский') found.add(value);
    }
    for (const element of document.querySelectorAll('[title],[aria-label],[placeholder]')) {
        if (element.closest(excluded) || element.matches('.layer-item')) continue;
        for (const name of ['title', 'aria-label', 'placeholder']) {
            const value = element.getAttribute(name);
            if (/[А-Яа-яЁё]/.test(value || '') && !value.includes('Сохранить.')) found.add(value);
        }
    }
    return [...found];
}
module.exports = {collectUntranslated};
