import { Controller, Patch, Post, Param, Body, UseGuards, Request } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { NOTIFICATION_THROTTLE } from '../common/throttles';
import { NotificationService } from './notification.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller()
// The bell's three write routes. Frames and the unread snapshot reach the client
// over the session socket (Phase 4), so there is no read route left: a client
// that cannot open the socket cannot receive a notification either.
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  // REST endpoints
  // Mark a single notification as read: called when the user clicks on a
  // notification in the dropdown or interacts with a toast.

  @UseGuards(JwtAuthGuard)
  @Throttle(NOTIFICATION_THROTTLE.markRead)
  @Patch('api/notifications/:id/read')
  markRead(@Request() req: { user: { id: string } }, @Param('id') notificationId: string) {
    return this.notifications.markRead(notificationId, req.user.id);
  }

  // Mark many as read in one round trip: a row click that prunes the rows it
  // speaks for (22.3). It shares the read-all bucket, because both are one-shot
  // clears, and it needs no cap of its own: the store holds at most 60 entries
  // (22.8), which is the most ids this client can hand it.
  @UseGuards(JwtAuthGuard)
  @Throttle(NOTIFICATION_THROTTLE.markAllRead)
  @Post('api/notifications/read')
  async markMany(@Request() req: { user: { id: string } }, @Body() body: { ids?: unknown }) {
    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
    await this.notifications.markMany(ids, req.user.id);
    return { ok: true };
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
