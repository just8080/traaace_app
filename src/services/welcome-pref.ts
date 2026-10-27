/** Whether the welcome screen (workspace chooser) opens on every launch. On by default. */
const KEY = 'traaace_welcome_dismissed';

export function getShowWelcomeOnStartup(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'true';
  } catch {
    return true;
  }
}

export function setShowWelcomeOnStartup(show: boolean): void {
  try {
    if (show) {
      localStorage.removeItem(KEY);
    } else {
      localStorage.setItem(KEY, 'true');
    }
  } catch {
    // storage unavailable: the preference just won't be remembered
  }
}
