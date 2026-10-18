import { HttpException, HttpStatus, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Subject, Observable, finalize } from 'rxjs';
import Redis from 'ioredis';
import { PrismaService } from '../prisma.service';

import { randomUUID } from 'crypto';
import { secret } from '../secrets';
import type { Prisma } from '../../generated/prisma/client';
// Types
// notification types.
export type NotificationType =
  | 'friend_request'
  | 'friend_accepted'
  | 'friend_removed'
  | 'friend_declined'
  | 'game_invite'
  | 'achievement'
  | 'match_finished'
  | 'match_cancelled'
  | 'profile_updated'
  | 'display_name_changed'
  | 'friend_online'
  | 'friend_offline'
  | 'avatar_changed';

// Shape of the payload written to DB and pushed over SSE.
export interface NotificationPayload {
  id: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  read: boolean;
  createdAt: string; // ISO string
}
// SSE stream cap: a user may hold several tabs, but an unbounded number of streams
// is a one-socket memory and Redis-subscription drain (security review F-11). Five
// covers multi-tab use; the sixth is refused with a localizable 429.
const MAX_SSE_STREAMS_PER_USER = 5;

@Injectable()
// Notification hub: persists notifications to Postgres and pushes them live to
// connected clients over SSE via Redis Pub/Sub. Called by most services (friends,
// match, achievements, presence, auth, user) and notification.controller.ts.
export class NotificationService implements OnModuleDestroy {
  // Redis publisher : sends notifications to the Pub/Sub channel.
  private pub: Redis;
  // Redis subscriber : listens for notifications on per-user channels.
  private sub: Redis;

  // In-memory map of active SSE connections per user: each userId maps to an
  // array of rxjs Subjects, because one user can have several tabs open and
  // every Subject in the array receives the event.
  private clients = new Map<string, Subject<NotificationPayload>[]>();

  // Subjects connected to the GLOBAL broadcast channel ("notify:all").
  // Every SSE client is added here too, so broadcast() events reach all
  // online users without being persisted per-recipient.
  private broadcastClients = new Set<Subject<NotificationPayload>>();

  constructor(private readonly prisma: PrismaService) {
    const host = process.env.REDIS_HOST ?? 'redis';
    const port = parseInt(process.env.REDIS_PORT ?? '6479', 10);
    const password = secret('REDIS_PASSWORD');
    const opts = { host, port, password, retryStrategy: (t: number) => Math.min(t * 50, 2000) };

    this.pub = new Redis(opts);
    this.sub = new Redis(opts);

    this.pub.on('error', (e) => {
      console.error('Notification pub Redis error:', e.message);
    });
    this.sub.on('error', (e) => {
      console.error('Notification sub Redis error:', e.message);
    });

    // Listen for messages on channels we subscribe to.
    // When a service calls notify(), it publishes to `notify:<userId>`.
    // This handler picks it up and pushes to every SSE Subject for that user.
    this.sub.on('message', (channel: string, message: string) => {
      try {
        const data: NotificationPayload = JSON.parse(message);
        if (channel === 'notify:all') {
          // Global broadcast : every connected SSE client gets it.
          for (const subject of this.broadcastClients) {
            subject.next(data);
          }
          return;
        }
        // channel = "notify:<userId>"
        const userId = channel.replace('notify:', '');
        const subjects = this.clients.get(userId);
        if (!subjects || subjects.length === 0) return;
        for (const subject of subjects) {
          subject.next(data);
        }
      } catch {
        console.error('Failed to parse notification message:', message);
      }
    });

    // Subscribe the global broadcast channel once : every SSE connection also
    // receives events published to `notify:all`.
    this.sub.subscribe('notify:all').catch((err) => {
      console.error('Failed to subscribe to notify:all:', err);
    });
  }

  async onModuleDestroy() {
    await this.pub.quit();
    await this.sub.quit();
  }
  // SSE connection management
  // Client opens the SSE stream. Returns an Observable the controller pipes
  // into the response; subscribes to the Redis channel on first connection.
  subscribe(userId: string): Observable<NotificationPayload> {
    const connected = this.clients.get(userId)?.length ?? 0;
    if (connected >= MAX_SSE_STREAMS_PER_USER) {
      throw new HttpException(
        {
          code: 'NOTIFICATION_STREAM_LIMIT',
          message: 'Too many open notification streams',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const subject = new Subject<NotificationPayload>();
    this.broadcastClients.add(subject);

    const existing = this.clients.get(userId);
    if (existing) {
      // Another tab already open : add this Subject.
      existing.push(subject);
    } else {
      // First tab : subscribe to the Redis channel.
      this.clients.set(userId, [subject]);
      this.sub.subscribe(`notify:${userId}`).catch((err) => {
        console.error(`Failed to subscribe to notify:${userId}:`, err);
      });
    }

    // When the SSE connection closes (client navigates away / closes tab),
    // clean up this Subject and unsubscribe from Redis if no tabs remain.
    subject.subscribe({
      complete: () => {
        this.removeClient(userId, subject);
      },
      error: () => {
        this.removeClient(userId, subject);
      },
    });

    // Wrapped so cleanup actually runs: on HTTP close NestJS unsubscribes
    // (not completes), so finalize() completes the Subject → removeClient()
    // removes it and unsubscribes from Redis when the last tab closes.
    return subject.asObservable().pipe(
      finalize(() => {
        subject.complete();
      }),
    );
  }

  // Remove a single SSE client. Unsubscribes from Redis when the last tab closes.
  private removeClient(userId: string, subject: Subject<NotificationPayload>) {
    this.broadcastClients.delete(subject);
    const subjects = this.clients.get(userId);
    if (!subjects) return;

    const idx = subjects.indexOf(subject);
    if (idx !== -1) subjects.splice(idx, 1);

    if (subjects.length === 0) {
      this.clients.delete(userId);
      this.sub.unsubscribe(`notify:${userId}`).catch(() => {});
    }
  }
  // Emit a notification
  // Persist a notification for a user in Postgres and push it live over
  // Redis Pub/Sub to their connected SSE clients.
  async notify(
    userId: string,
    type: NotificationType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    // Failure contract: this method NEVER throws. A notification is a
    // non-critical side effect, the persisted row is authoritative for the bell,
    // and failures are only logged.
    let row: { id: string; createdAt: Date };

    // 1. Persist to DB so it shows up in the bell dropdown on next page load.
    try {
      row = await this.prisma.db.notification.create({
        data: { userId, type, payload: payload as unknown as Prisma.InputJsonValue },
      });
    } catch (err) {
      console.error(`[notifications] persist failed for ${type} -> user ${userId}:`, err);
      return;
    }

    // 2. Build the SSE payload.
    const event: NotificationPayload = {
      id: row.id,
      type: type,
      payload,
      read: false,
      createdAt: row.createdAt.toISOString(),
    };

    // 3. Publish to Redis: the subscriber handler (in the constructor) pushes it
    //    to every SSE Subject for this user. Best-effort: a failure here only
    //    delays the toast; the persisted row appears in the bell on next load.
    try {
      await this.pub.publish(`notify:${userId}`, JSON.stringify(event));
    } catch (err) {
      console.warn(
        `[notifications] live push failed for ${type} -> user ${userId} (persisted, will show on next load):`,
        err,
      );
    }
  }

  // SHORT-LIVED/TRANSIENT global broadcast (SSE toast only, never persisted) : offline
  // users don't see it and the bell badge is never flooded.
  async broadcast(type: NotificationType, payload: Record<string, unknown>): Promise<void> {
    const event: NotificationPayload = {
      id: randomUUID(),
      type,
      payload,
      read: false,
      createdAt: new Date().toISOString(),
    };
    // Best-effort (transient toast only : nothing persisted). Never throws, so
    // callers (avatar upload/delete, display-name change) can't fail because a
    // live broadcast hiccuped.
    try {
      await this.pub.publish('notify:all', JSON.stringify(event));
    } catch (err) {
      console.warn(`[notifications] global broadcast failed for ${type}:`, err);
    }
  }

  // SHORT-LIVED/TRANSIENT per-user notification (same path as notify(), no Postgres
  // write) so ephemeral events can't flood the bell.
  async notifyTransient(
    userId: string,
    type: NotificationType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const event: NotificationPayload = {
      id: randomUUID(),
      type,
      payload,
      read: false,
      createdAt: new Date().toISOString(),
    };
    // Best-effort (transient toast only : nothing persisted). Never throws, so
    // presence heartbeats/logout can't be disturbed by a delivery failure.
    try {
      await this.pub.publish(`notify:${userId}`, JSON.stringify(event));
    } catch (err) {
      console.warn(`[notifications] transient push failed for ${type} -> user ${userId}:`, err);
    }
  }
  // REST helpers (for the controller)
  // Fetch unread notifications for the bell dropdown on page load.
  async getUnread(userId: string): Promise<NotificationPayload[]> {
    const rows = await this.prisma.db.notification.findMany({
      where: { userId, read: false },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return rows.map((r) => ({
      id: r.id,
      type: r.type as NotificationType,
      payload: r.payload as Record<string, unknown>,
      read: r.read,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // Mark a single notification as read.
  async markRead(notificationId: string, userId: string): Promise<void> {
    await this.prisma.db.notification.updateMany({
      where: { id: notificationId, userId },
      data: { read: true },
    });
  }

  // Mark all notifications as read for a user.
  async markAllRead(userId: string): Promise<void> {
    await this.prisma.db.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  }
}
