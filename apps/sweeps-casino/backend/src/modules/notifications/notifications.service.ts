import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationChannel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  PreferencesShape,
  categoryForEvent,
} from './notifications.constants';

function deepMergePreferences(base: PreferencesShape, patch: PreferencesShape): PreferencesShape {
  const result: PreferencesShape = { ...base };
  for (const [channel, categories] of Object.entries(patch) as [
    keyof PreferencesShape,
    PreferencesShape[keyof PreferencesShape],
  ][]) {
    if (!categories) continue;
    result[channel] = { ...(result[channel] ?? {}), ...categories };
  }
  return result;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /notifications?unread=true.
   *
   * Phase 1 simplification (documented, not a bug): `notifications` has no
   * read/unread column in the schema — `status` is
   * QUEUED/SENT/FAILED/SUPPRESSED_OPT_OUT, not a read flag, and we are not
   * allowed to edit prisma/schema.prisma to add one. Read-tracking needs a
   * schema field in Phase 2. For now this always returns the user's most
   * recent notifications, newest first, regardless of `?unread=` — the
   * query param is accepted (for forward API compatibility) but has no
   * effect, which the controller notes in `meta`.
   */
  async list(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /**
   * POST /notifications/:id/read — a no-op stub for forward API
   * compatibility (see list() for why). It still verifies the notification
   * exists and belongs to the caller so it isn't a blind 200 for any id,
   * but there is nowhere to persist "read" state yet.
   */
  async markRead(userId: string, id: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification || notification.userId !== userId) {
      throw new NotFoundException({ code: 'NOTIFICATION_NOT_FOUND', message: 'Notification not found.' });
    }
    return {
      success: true,
      note: 'Read-tracking is not persisted in Phase 1 (no schema column for it yet); this call is a stub.',
    };
  }

  async getPreferences(userId: string) {
    const row = await this.prisma.notificationPreferences.findUnique({ where: { userId } });
    return this.withDefaults((row?.preferences as PreferencesShape | undefined) ?? {});
  }

  async updatePreferences(userId: string, patch: PreferencesShape) {
    const existing = await this.prisma.notificationPreferences.findUnique({ where: { userId } });
    const merged = deepMergePreferences((existing?.preferences as PreferencesShape | undefined) ?? {}, patch);

    const row = await this.prisma.notificationPreferences.upsert({
      where: { userId },
      create: { userId, preferences: merged as Prisma.InputJsonValue },
      update: { preferences: merged as Prisma.InputJsonValue },
    });

    return this.withDefaults(row.preferences as PreferencesShape);
  }

  private withDefaults(prefs: PreferencesShape): Record<string, Record<string, boolean>> {
    const result: Record<string, Record<string, boolean>> = {};
    for (const channel of NOTIFICATION_CHANNELS) {
      result[channel] = {};
      for (const category of NOTIFICATION_CATEGORIES) {
        result[channel][category] = prefs[channel]?.[category] ?? true;
      }
    }
    return result;
  }

  /**
   * Cross-module entry point: other domains call this to notify a user
   * instead of touching `notifications` directly.
   *
   * - Checks NotificationPreferences first. If the user opted out of this
   *   channel+category, writes a Notification row with
   *   status='SUPPRESSED_OPT_OUT' and returns without "sending."
   * - For IN_APP, creates a Notification row with status='SENT'.
   * - For EMAIL/SMS/PUSH there is no real provider integration in Phase 1
   *   — this is a MOCK send: it logs to the console and still creates the
   *   Notification row with status='SENT' (a real provider call and
   *   delivery-status webhook is Phase 2+ work).
   */
  async dispatch(
    userId: string,
    channel: NotificationChannel,
    event: string,
    payload?: Prisma.InputJsonValue,
  ) {
    const category = categoryForEvent(event);
    const prefsRow = await this.prisma.notificationPreferences.findUnique({ where: { userId } });
    const prefs = (prefsRow?.preferences as PreferencesShape | undefined) ?? {};
    const optedIn = prefs[channel]?.[category] ?? true;

    if (!optedIn) {
      return this.prisma.notification.create({
        data: { userId, channel, event, payload, status: 'SUPPRESSED_OPT_OUT' },
      });
    }

    if (channel !== 'IN_APP') {
      // Mock provider — no real EMAIL/SMS/PUSH integration exists in Phase 1.
      // eslint-disable-next-line no-console
      console.log('[mock notification]', channel, event, { userId, payload });
    }

    return this.prisma.notification.create({
      data: { userId, channel, event, payload, status: 'SENT', sentAt: new Date() },
    });
  }
}
