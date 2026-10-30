import { Module } from '@nestjs/common';
import { PresenceService } from './presence.service';
import { NotificationModule } from '../notification/notification.module';
import { PrismaService } from '../prisma.service';

// No controller (D11): presence has no REST surface at all. The session socket
// carries it — the connection is the liveness signal, and the badge's number
// arrives on the connect path (`currentCount()`), not from a first-paint read.
@Module({
  imports: [NotificationModule],
  providers: [PresenceService, PrismaService],
  exports: [PresenceService],
})
export class PresenceModule {}
