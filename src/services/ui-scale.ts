import { ipc } from './tauri-bridge';

export function getSavedUiScale(): number {
  try {
    const saved = parseFloat(localStorage.getItem('traaace_ui_scale') || localStorage.getItem('uiScale') || '1.0');
    if (!isNaN(saved) && saved >= 0.75 && saved <= 1.75) {
      return Math.round(saved * 100) / 100;
    }
  } catch (_) {}
  return 1.0;
}

export function applyZoom(newScale: number, save = true): number {
  const clamped = Math.min(1.75, Math.max(0.75, Math.round(newScale * 100) / 100));

  try {
    localStorage.setItem('traaace_ui_scale', clamped.toString());
    localStorage.setItem('uiScale', clamped.toString());
  } catch (_) {}

  // Apply CSS zoom directly on root document element (exact approach from previous app)
  document.documentElement.style.setProperty('--ui-scale', clamped.toString());
  (document.documentElement.style as any).zoom = clamped;

  // Persist to backend settings if in Tauri environment
  if (save) {
    try {
      ipc.saveSettings({ uiScale: clamped })
        .catch((err) => console.warn('Could not persist uiScale to backend:', err));
    } catch (_) {}
  }

  // Update any visible badges and preset buttons on page
  const percent = Math.round(clamped * 100);
  const badge = document.getElementById('scaleReadoutBadge');
  if (badge) {
    badge.textContent = `${percent}%`;
  }

  document.querySelectorAll<HTMLElement>('.btn-scale-preset').forEach((btn) => {
    const btnScale = parseFloat(btn.dataset.scale || '1');
    btn.classList.toggle('active', Math.abs(btnScale - clamped) < 0.03);
  });

  // Notify any active components
  window.dispatchEvent(new CustomEvent('traaace-scale-changed', { detail: clamped }));

  return clamped;
}

export function initUiScale(): void {
  const scale = getSavedUiScale();
  applyZoom(scale, false);
}

export function showToast(message: string, duration = 2200): void {
  let toastContainer = document.getElementById('traaace-toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'traaace-toast-container';
    toastContainer.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    `;
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  toast.style.cssText = `
    background: var(--color-bg-surface-elevated, #282d35);
    color: var(--color-text-main, #f0f3f6);
    border: 1px solid var(--color-border, #2d333b);
    box-shadow: var(--shadow-lg, 0 10px 15px -3px rgba(0,0,0,0.4));
    padding: 8px 16px;
    border-radius: var(--radius-md, 8px);
    font-size: 13px;
    font-weight: 600;
    font-family: var(--font-sans);
    transition: opacity 0.2s ease, transform 0.2s ease;
    opacity: 0;
    transform: translateY(8px);
    pointer-events: auto;
  `;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}
