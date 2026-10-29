/** Preserve keyboard position when gradient rows are rebuilt after an edit. */
export function captureGradientFocus(container) {
    if (!container) return null;
    const active = document.activeElement;
    if (!active || !container.contains(active)) return null;
    const source = active.dataset.controlId ? document.getElementById(active.dataset.controlId) : active;
    const row = source?.closest('.grad-stop-row');
    const role = source?.dataset.gradientRole;
    if (!row || !role) return null;
    return {
        index: Number(row.dataset.gradientIndex), role,
        start: role === 'hex' ? active.selectionStart : null,
        end: role === 'hex' ? active.selectionEnd : null
    };
}

export function restoreGradientFocus(container, token) {
    if (!token || !container?.isConnected) return;
    const rows = [...container.querySelectorAll('.grad-stop-row')];
    const row = rows[Math.min(token.index, rows.length - 1)];
    const source = row?.querySelector(`[data-gradient-role="${token.role}"]`);
    if (!source) return;
    source.focus();
    if (token.role !== 'hex' || token.start == null) return;
    const control = source;
    Promise.resolve(control.updateComplete).then(() => {
        if (control.isConnected && document.activeElement === control) {
            control.setSelectionRange?.(token.start, token.end);
        }
    });
}
