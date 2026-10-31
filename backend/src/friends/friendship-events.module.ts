import { Module } from '@nestjs/common';
import { AvatarMetaModule } from '../avatar/avatar-meta.module';
import { PresenceModule } from '../presence/presence.module';
import { PrismaService } from '../prisma.service';
import { FriendshipEventsService } from './friendship-events.service';

// Leaf on purpose: friends, user, auth and match all inject this service, and a
// module that imported any of them would close that graph into a cycle
// (MatchModule already imports AuthModule).
@Module({
  imports: [PresenceModule, AvatarMetaModule],
  providers: [FriendshipEventsService, PrismaService],
  exports: [FriendshipEventsService],
})
export class FriendshipEventsModule {}
