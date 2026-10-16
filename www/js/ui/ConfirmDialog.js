export function confirmDialog({
    title,
    message,
    confirmLabel = 'Подтвердить',
    cancelLabel = 'Отмена',
    danger = false
}) {
    return new Promise(resolve => {
        const returnFocusTo = document.activeElement;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay show';
        overlay.setAttribute('role', 'presentation');

        const dialog = document.createElement('section');
        dialog.className = 'modal m3-confirm-dialog';
        dialog.setAttribute('role', 'alertdialog');
        dialog.setAttribute('aria-modal', 'true');

        const heading = document.createElement('h2');
        heading.className = 'm3-confirm-title';
        heading.id = `m3-confirm-${Date.now()}`;
        heading.textContent = title;
        dialog.setAttribute('aria-labelledby', heading.id);

        const body = document.createElement('div');
        body.className = 'modal-body';
        const description = document.createElement('p');
        description.className = 'm3-confirm-message';
        description.id = `${heading.id}-description`;
        description.textContent = message;
        dialog.setAttribute('aria-describedby', description.id);
        body.append(description);

        const footer = document.createElement('div');
        footer.className = 'modal-footer';
        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'md-btn outlined';
        cancelButton.textContent = cancelLabel;
        const confirmButton = document.createElement('button');
        confirmButton.type = 'button';
        confirmButton.className = danger ? 'md-btn danger' : 'md-btn primary';
        confirmButton.textContent = confirmLabel;
        footer.append(cancelButton, confirmButton);

        const header = document.createElement('header');
        header.className = 'modal-header';
        header.append(heading);
        dialog.append(header, body, footer);
        overlay.append(dialog);

        let settled = false;
        const finish = value => {
            if (settled) return;
            settled = true;
            overlay.remove();
            document.removeEventListener('keydown', onKeyDown);
            returnFocusTo?.focus?.();
            resolve(value);
        };
        const onKeyDown = event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                finish(false);
            } else if (event.key === 'Tab') {
                const first = cancelButton;
                const last = confirmButton;
                if (!dialog.contains(document.activeElement)) {
                    event.preventDefault();
                    (event.shiftKey ? last : first).focus();
                } else if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        };

        cancelButton.addEventListener('click', () => finish(false));
        confirmButton.addEventListener('click', () => finish(true));
        overlay.addEventListener('click', event => {
            if (event.target === overlay) finish(false);
        });
        document.addEventListener('keydown', onKeyDown);
        document.body.append(overlay);
        cancelButton.focus();
    });
}
