import { Controller, Get, Patch, Post, Param, Sse, UseGuards, Request } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { NOTIFICATION_THROTTLE } from '../common/throttles';
import { Observable, map, finalize, interval, merge } from 'rxjs';
import { NotificationService } from './notification.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { NotificationPayload } from './notification.service';


// NestJS's Sse decorator expects each emission to be a MessageEvent :
// the shape { data: ... } that the browser's EventSource API understands.
interface MessageEvent {
  data: string | object;
  id?: string;
  type?: string;
}

// SSE keep-alive: a named `ping` frame every 20s, not the client's presence
// heartbeat. An idle stream gets reset and SSE has no replay, so an
// avatar_changed sent during a reset is lost.
const SSE_HEARTBEAT_MS = 20_000;

@Controller()
// HTTP + SSE routes for notifications: the live event stream the client
// opens on login, plus read/unread endpoints for the bell. Delegates to
// NotificationService.
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  // Opened once on login; one JSON event per notification via Redis Pub/Sub.

  @UseGuards(JwtAuthGuard)
  @Throttle(NOTIFICATION_THROTTLE.stream)
  @Sse('api/notifications/stream')
  stream(@Request() req: { user: { id: string } }): Observable<MessageEvent> {
    const userId = req.user.id;
    const obs = this.notifications.subscribe(userId);

    // Map each payload into the MessageEvent shape the SSE adapter expects
    // (id: notification id, data: the notification JSON).
    const events: Observable<MessageEvent> = obs.pipe(
      map((notification: NotificationPayload): MessageEvent => ({
        data: notification,
        id: notification.id,
      })),
    );

    // Heartbeat: a named `ping` event on a timer. merge() ends the response when
    // either source ends, and the interval is cancelled on teardown, which NestJS
    // triggers when the HTTP connection closes.
    const heartbeat: Observable<MessageEvent> = interval(SSE_HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ type: 'ping', data: 'keep-alive' })),
    );

    return merge(events, heartbeat).pipe(
      // Teardown on HTTP close happens in the service's finalize() wrapper :
      // this empty finalize just marks where the stream teardown begins.
      finalize(() => {
        // Cleanup happens in NotificationService.subscribe()'s finalize.
      }),
    );
  }

  // REST endpoints
  // Fetch unread notifications : called on page load to populate the bell
  // icon badge and dropdown list before any SSE events arrive.
  @UseGuards(JwtAuthGuard)
  @Get('api/notifications')
  getUnread(@Request() req: { user: { id: string } }) {
    return this.notifications.getUnread(req.user.id);
  }

  // Mark a single notification as read : called when the user clicks on a
  // notification in the dropdown or interacts with a toast.
  @UseGuards(JwtAuthGuard)
  @Throttle(NOTIFICATION_THROTTLE.markRead)
  @Patch('api/notifications/:id/read')
  markRead(@Request() req: { user: { id: string } }, @Param('id') notificationId: string) {
    return this.notifications.markRead(notificationId, req.user.id);
  }

  // Mark all notifications as read : called when the user clicks
  // "Mark all as read" in the bell dropdown.
  @UseGuards(JwtAuthGuard)
  @Throttle(NOTIFICATION_THROTTLE.markAllRead)
  @Post('api/notifications/read-all')
  markAllRead(@Request() req: { user: { id: string } }) {
    return this.notifications.markAllRead(req.user.id);
  }
}
