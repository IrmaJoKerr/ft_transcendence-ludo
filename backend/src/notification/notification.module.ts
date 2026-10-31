import { Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

@Module({
  controllers: [NotificationController],
  providers: [NotificationService],
  // Exported so other modules (FriendsModule, MatchModule, AchievementsModule)
  // can inject NotificationService and call notify() without duplicating it, and
  // so the realtime gateway can set its deliverer and read the unread snapshot.
  exports: [NotificationService],
})
export class NotificationModule {}
