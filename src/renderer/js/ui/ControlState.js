/** Keep a native toggle button's visible and accessible state in sync. */
export function setPressedState(control, pressed) {
    if (!control) return;
    control.classList.toggle('active', Boolean(pressed));
    control.setAttribute('aria-pressed', String(Boolean(pressed)));
}
