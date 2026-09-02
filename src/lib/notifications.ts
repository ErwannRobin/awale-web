// Local notifications: one gentle "come back" reminder.
//
// Deliberately *local*, not push. Remote push would need FCM, APNs and a
// server to send from, and this game has no backend — see README. A locally
// scheduled notification needs none of that and works with the device offline.
//
// The rules:
//   - off by default, and the permission prompt only ever appears when the
//     player turns the setting on themselves;
//   - exactly one notification is ever pending, re-armed every time the app is
//     opened or closed, so it always means "you have not played in a while"
//     rather than "it is Tuesday".
import { getSettings } from './settings.ts';
import { isNative, platform } from './platform.ts';
import { translate } from '../i18n/index.ts';

/** Single slot: scheduling again replaces the pending reminder. */
export const REMINDER_ID = 1;
export const REMINDER_DELAY_DAYS = 3;
/** Local hour to fire at — early evening, not the middle of the night. */
export const REMINDER_HOUR = 19;

const CHANNEL_ID = 'awale-reminders';

/**
 * When the next reminder should fire, given the last time the app was used.
 *
 * Pure, and exported for the tests: `days` whole days later, at
 * `REMINDER_HOUR` local time. Rounding to an hour rather than "now + 72h"
 * keeps the notification out of somebody's night.
 */
export function nextReminderAt(
  from: Date,
  days = REMINDER_DELAY_DAYS,
  hour = REMINDER_HOUR,
): Date {
  const at = new Date(from.getTime());
  at.setDate(at.getDate() + days);
  at.setHours(hour, 0, 0, 0);
  // Landing before `from` is impossible for days >= 1, but a 0-day call (or a
  // DST shift) must still schedule into the future.
  if (at.getTime() <= from.getTime()) at.setDate(at.getDate() + 1);
  return at;
}

/** Reminders exist only in the native shell; browsers get nothing to toggle. */
export function remindersSupported(): boolean {
  return isNative();
}

/**
 * The plugin, or null off-native. Loaded lazily so a browser build never pulls
 * the notification code in at all.
 */
async function plugin() {
  if (!isNative()) return null;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  return LocalNotifications;
}

async function cancelReminder(): Promise<void> {
  const api = await plugin();
  if (!api) return;
  await api.cancel({ notifications: [{ id: REMINDER_ID }] }).catch(() => {});
}

async function scheduleReminder(at: Date): Promise<void> {
  const api = await plugin();
  if (!api) return;

  const { language } = getSettings();

  if (platform() === 'android') {
    // Importance 3 = "default": it appears in the shade without a sound.
    await api.createChannel({
      id: CHANNEL_ID,
      name: translate(language, 'notify.channelName'),
      description: translate(language, 'notify.channelDescription'),
      importance: 3,
    }).catch(() => { /* older Android has no channels */ });
  }

  await api.schedule({
    notifications: [{
      id: REMINDER_ID,
      title: translate(language, 'notify.reminderTitle'),
      body: translate(language, 'notify.reminderBody'),
      channelId: CHANNEL_ID,
      // A reminder is not an alarm. Leaving this at its `true` default would
      // send Android 12+ players to the "Alarms & reminders" system screen for
      // no benefit; a few minutes of drift on a three-day nudge costs nothing.
      isExactNotification: false,
      schedule: { at, allowWhileIdle: false },
    }],
  });
}

/**
 * Re-arm the reminder for `REMINDER_DELAY_DAYS` from now, or clear it.
 *
 * Called when the app is backgrounded, when it comes back, and after a game.
 * `reason` is only for the caller's readability.
 */
export async function refreshReminder(_reason: string): Promise<void> {
  const api = await plugin();
  if (!api) return;

  await cancelReminder();
  if (!getSettings().reminders) return;

  const { display } = await api.checkPermissions().catch(() => ({ display: 'denied' as const }));
  if (display !== 'granted') return;

  await scheduleReminder(nextReminderAt(new Date())).catch(err => {
    console.warn('Could not schedule the reminder:', err);
  });
}

/**
 * Ask for permission and arm the reminder. Returns false if the player (or the
 * system) said no, so the setting can stay off rather than lie.
 */
export async function enableReminders(): Promise<boolean> {
  const api = await plugin();
  if (!api) return false;

  let status = await api.checkPermissions().catch(() => ({ display: 'denied' as const }));
  if (status.display === 'prompt' || status.display === 'prompt-with-rationale') {
    status = await api.requestPermissions().catch(() => ({ display: 'denied' as const }));
  }
  if (status.display !== 'granted') return false;

  await cancelReminder();
  await scheduleReminder(nextReminderAt(new Date())).catch(() => {});
  return true;
}

/** Clear the pending reminder. */
export async function disableReminders(): Promise<void> {
  await cancelReminder();
}
