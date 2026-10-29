export function isControlFocused(control) {
    if (!control || typeof document === 'undefined') return false;
    return document.activeElement === control;
}
