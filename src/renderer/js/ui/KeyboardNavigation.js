const installations = new WeakMap();
const TAB_SELECTOR = '[role="tab"]:not([disabled])';
const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
].join(',');

export function isShortcutTarget(target, event = null) {
    if (event?.isComposing || event?.getModifierState?.('AltGraph')) return true;
    // Legacy tool listeners must respect modal focus as well as the central
    // shortcut manager, including the frame before focus moves into a dialog.
    const owner = target?.ownerDocument || globalThis.document;
    if (owner?.querySelector?.('dialog[open],.modal-overlay.show')) return true;
    if (target?.closest?.('dialog[open],[popover]:popover-open')) return true;
    if (target?.isContentEditable || target?.closest?.('input, textarea, select, [role="textbox"], [role="combobox"], [contenteditable="true"]')) return true;
    const control = target?.closest?.('button, a[href], [role="button"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="option"], [role="menuitem"], [role="slider"]');
    if (!control) return false;
    return !event || [' ', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key);
}

function getOpenDialog() {
    return [...document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')]
        .reverse()
        .find(dialog => {
            const overlay = dialog.closest('.modal-overlay');
            return (!overlay || overlay.classList.contains('show')) && dialog.getClientRects().length > 0 && getComputedStyle(dialog).visibility !== 'hidden';
        }) || null;
}

export function installKeyboardNavigation(root = document) {
    if (installations.has(root)) return installations.get(root);
    const synchronizeTabs = (scope = root) => {
        scope.querySelectorAll?.('[role="tablist"]').forEach(tabList => {
            const tabs = [...tabList.querySelectorAll(TAB_SELECTOR)];
            if (!tabs.length) return;
            const direction = getComputedStyle(tabList).flexDirection;
            if (tabList.hasAttribute('aria-orientation') && direction) {
                const orientation = direction.startsWith('row') ? 'horizontal' : 'vertical';
                tabList.setAttribute('aria-orientation', orientation);
            }
            let active = tabs.find(tab => tab.getAttribute('aria-selected') === 'true')
                || tabs.find(tab => tab.classList.contains('active'))
                || tabs[0];
            tabs.forEach(tab => {
                const selected = tab === active;
                tab.tabIndex = selected ? 0 : -1;
                if (!tab.hasAttribute('aria-selected')) tab.setAttribute('aria-selected', String(selected));
            });
        });
    };

    const getTabOrientation = tabList => {
        const direction = getComputedStyle(tabList).flexDirection;
        if (direction.startsWith('row')) return 'horizontal';
        if (direction.startsWith('column')) return 'vertical';
        return tabList.getAttribute('aria-orientation') || 'horizontal';
    };

    synchronizeTabs();
    const observer = new MutationObserver(records => {
        for (const record of records) {
            if (record.type === 'childList') {
                record.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) synchronizeTabs(node);
                });
            } else if (record.type === 'attributes' && record.target.matches?.('[role="tab"]')) {
                const tabList = record.target.closest('[role="tablist"]');
                if (tabList) synchronizeTabs(tabList.parentElement || tabList);
            }
        }
    });
    observer.observe(root.documentElement || root, {
        attributes: true,
        attributeFilter: ['aria-selected'],
        childList: true,
        subtree: true
    });
    const handleResize = () => synchronizeTabs();
    root.defaultView?.addEventListener('resize', handleResize);

    let focusedBeforeDialog = null;
    let currentDialog = null;
    const syncDialogFocus = () => {
        const nextDialog = getOpenDialog();
        if (nextDialog === currentDialog) return;
        if (currentDialog && !nextDialog && focusedBeforeDialog?.isConnected) {
            focusedBeforeDialog.focus();
            focusedBeforeDialog = null;
        }
        currentDialog = nextDialog;
        if (nextDialog) {
            if (!focusedBeforeDialog) focusedBeforeDialog = document.activeElement;
            const initial = [...nextDialog.querySelectorAll('[autofocus], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')]
                .find(element => !element.disabled && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
            if (initial && !nextDialog.contains(document.activeElement)) requestAnimationFrame(() => { if (initial.isConnected && getOpenDialog() === nextDialog) initial.focus(); });
        }
    };

    const dialogObserver = new MutationObserver(syncDialogFocus);
    dialogObserver.observe(root.documentElement || root, {
        attributes: true,
        attributeFilter: ['class', 'aria-hidden', 'style', 'open'],
        childList: true,
        subtree: true
    });

    const handleKeyDown = event => {
        const tab = event.target.closest?.(TAB_SELECTOR);
        if (tab) {
            const tabList = tab.closest('[role="tablist"]');
            const tabs = tabList ? [...tabList.querySelectorAll(TAB_SELECTOR)] : [];
            if (tabs.length > 1) {
                const orientation = getTabOrientation(tabList);
                const rtl = getComputedStyle(tabList).direction === 'rtl';
                const forwardKey = orientation === 'vertical' ? 'ArrowDown' : (rtl ? 'ArrowLeft' : 'ArrowRight');
                const backwardKey = orientation === 'vertical' ? 'ArrowUp' : (rtl ? 'ArrowRight' : 'ArrowLeft');
                let targetIndex = tabs.indexOf(tab);
                if (event.key === forwardKey) targetIndex = (targetIndex + 1) % tabs.length;
                else if (event.key === backwardKey) targetIndex = (targetIndex - 1 + tabs.length) % tabs.length;
                else if (event.key === 'Home') targetIndex = 0;
                else if (event.key === 'End') targetIndex = tabs.length - 1;
                else targetIndex = -1;

                if (targetIndex >= 0) {
                    event.preventDefault();
                    const nextTab = tabs[targetIndex];
                    nextTab.click();
                    tabs.forEach(item => { item.tabIndex = item === nextTab ? 0 : -1; });
                    const liveTab = nextTab.id ? document.getElementById(nextTab.id) : nextTab;
                    liveTab?.focus();
                }
            }
        }

        syncDialogFocus();
        if (event.key !== 'Tab') return;
        const dialog = getOpenDialog();
        if (!dialog) return;
        const focusable = [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)]
            .filter(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
        if (!focusable.length) {
            event.preventDefault();
            dialog.setAttribute('tabindex', '-1');
            dialog.focus();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };
    root.addEventListener('keydown', handleKeyDown);

    const handleFocus = event => {
        const dialog = getOpenDialog();
        if (dialog && !dialog.contains(event.target)) {
            const first = dialog.querySelector(FOCUSABLE_SELECTOR);
            first?.focus();
        }
    };
    document.addEventListener('focusin', handleFocus);

    const dispose = () => {
        observer.disconnect();
        dialogObserver.disconnect();
        root.defaultView?.removeEventListener('resize', handleResize);
        root.removeEventListener('keydown', handleKeyDown);
        document.removeEventListener('focusin', handleFocus);
        installations.delete(root);
    };
    installations.set(root, dispose);
    return dispose;
}

