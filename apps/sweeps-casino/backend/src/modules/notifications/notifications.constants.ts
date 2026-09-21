import { NotificationChannel } from '@prisma/client';

/**
 * Category names used inside NotificationPreferences.preferences, shaped as
 * `{ [channel]: { [category]: boolean } }`. These are our own invention —
 * the schema only stores the blob as `jsonb`, no category enum exists — so
 * this is the single place that owns the category list.
 */
export const NOTIFICATION_CATEGORIES = ['promotions', 'security', 'vip', 'support', 'general'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_CHANNELS: NotificationChannel[] = ['IN_APP', 'EMAIL', 'SMS', 'PUSH'];

/**
 * Derives a preference category from an event name by convention:
 * `"promotions.daily_bonus_ready"` -> category `"promotions"`. Events that
 * don't match a known category (or aren't dot-namespaced) fall back to
 * `"general"`, which defaults to opted-in.
 */
export function categoryForEvent(event: string): NotificationCategory {
  const prefix = event.split('.')[0];
  return (NOTIFICATION_CATEGORIES as readonly string[]).includes(prefix)
    ? (prefix as NotificationCategory)
    : 'general';
}

export type PreferencesShape = Partial<Record<NotificationChannel, Partial<Record<NotificationCategory, boolean>>>>;
