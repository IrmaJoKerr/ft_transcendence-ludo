import { Module } from '@nestjs/common';
import { AvatarMetaModule } from '../avatar/avatar-meta.module';
import { REDIS_CLIENT, RedisClientLifecycle, createRedisClient } from '../common/redis-client';
import { PresenceModule } from '../presence/presence.module';
import { PrismaService } from '../prisma.service';
import { FriendshipEventsService } from './friendship-events.service';

// Leaf on purpose: friends, user, auth and match all inject this service, and a
// module that imported any of them would close that graph into a cycle
// (MatchModule already imports AuthModule).
@Module({
  imports: [PresenceModule, AvatarMetaModule],
  providers: [
    FriendshipEventsService,
    { provide: REDIS_CLIENT, useFactory: () => createRedisClient('Friendship events Redis') },
    RedisClientLifecycle,
    PrismaService,
  ],
  exports: [FriendshipEventsService],
})
export class FriendshipEventsModule {}
