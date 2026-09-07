import { Controller, Get, Patch, Post, Param, Sse, UseGuards, Request } from '@nestjs/common';
import { Observable, map, finalize } from 'rxjs';
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

@Controller()
// HTTP + SSE routes for notifications: the live event stream the client
// opens on login, plus read/unread endpoints for the bell. Delegates to
// NotificationService.
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  // SSE stream
  // Opened once on login. The server pushes a JSON event per notification
  // published for this user via Redis Pub/Sub; NestJS's @Sse handles the
  // event-stream headers and flushing.

  @UseGuards(JwtAuthGuard)
  @Sse('api/notifications/stream')
  stream(@Request() req: { user: { id: string } }): Observable<MessageEvent> {
    const userId = req.user.id;
    const obs = this.notifications.subscribe(userId);

    // Map each payload into the MessageEvent shape the SSE adapter expects
    // (id: notification id, data: the notification JSON).
    return obs.pipe(
      map((notification: NotificationPayload): MessageEvent => ({
        data: notification,
        id: notification.id,
      })),
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
  @Patch('api/notifications/:id/read')
  markRead(
    @Request() req: { user: { id: string } },
    @Param('id') notificationId: string,
  ) {
    return this.notifications.markRead(notificationId, req.user.id);
  }

  // Mark all notifications as read : called when the user clicks
  // "Mark all as read" in the bell dropdown.
  @UseGuards(JwtAuthGuard)
  @Post('api/notifications/read-all')
  markAllRead(@Request() req: { user: { id: string } }) {
    return this.notifications.markAllRead(req.user.id);
  }
}
