import { Controller, Patch, Post, Param, UseGuards, Request } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { NOTIFICATION_THROTTLE } from '../common/throttles';
import { NotificationService } from './notification.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller()
// The bell's two write routes. Frames and the unread snapshot reach the client
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

  // Mark all notifications as read : called when the user clicks
  // "Mark all as read" in the bell dropdown.
  @UseGuards(JwtAuthGuard)
  @Throttle(NOTIFICATION_THROTTLE.markAllRead)
  @Post('api/notifications/read-all')
  markAllRead(@Request() req: { user: { id: string } }) {
    return this.notifications.markAllRead(req.user.id);
  }
}
