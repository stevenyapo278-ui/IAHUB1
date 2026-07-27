const STORAGE_KEY = 'browser_notif_enabled';

export function isBrowserNotifEnabled() {
  return localStorage.getItem(STORAGE_KEY) !== 'false';
}

export function setBrowserNotifEnabled(val) {
  localStorage.setItem(STORAGE_KEY, val ? 'true' : 'false');
}

export async function requestBrowserNotifPermission() {
  if (!('Notification' in window)) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  const result = await Notification.requestPermission();
  return result;
}

export function sendBrowserNotification(title, options = {}) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (!isBrowserNotifEnabled()) return;
  try {
    const n = new Notification(title, {
      icon: '/favicon.png',
      ...options,
    });
    if (options.onClick) {
      n.onclick = () => {
        window.focus();
        options.onClick();
        n.close();
      };
    }
    setTimeout(() => n.close(), 10000);
  } catch {
    // ignore
  }
}
