export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (typeof Notification === 'undefined') {
    return 'unsupported';
  }
  if (Notification.permission === 'default') {
    return await Notification.requestPermission();
  }
  return Notification.permission;
}

export async function sendNotification(
  title: string,
  options: NotificationOptions = {}
): Promise<boolean> {
  try {
    if (typeof Notification === 'undefined') {
      return false;
    }

    if (Notification.permission !== 'granted') {
      return false;
    }

    new Notification(title, options);
    return true;
  } catch (error) {
    console.warn('[Notifications] Failed to send notification', error);
    return false;
  }
}
