import { Module } from '@nestjs/common';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';
import { FriendsBlocksService } from './friends.blocks.service';
import { FriendsInvitesService } from './friends.invites.service';
import { FriendsRequestsService } from './friends.requests.service';
import { FriendshipAccess } from './friendship-access';
import { BlockStateModule } from './block-state.module';
import { FriendshipEventsModule } from './friendship-events.module';
import { PrismaService } from '../prisma.service';
import { AvatarMetaModule } from '../avatar/avatar-meta.module';
import { PresenceModule } from '../presence/presence.module';
import { MatchModule } from '../match/match.module';
import { NotificationModule } from '../notification/notification.module';
import { REDIS_CLIENT, RedisClientLifecycle, createRedisClient } from '../common/redis-client';

@Module({
  imports: [
    PresenceModule,
    MatchModule,
    NotificationModule,
    BlockStateModule,
    AvatarMetaModule,
    FriendshipEventsModule,
  ],
  controllers: [FriendsController],
  providers: [
    FriendsService,
    FriendsRequestsService,
    FriendsInvitesService,
    FriendsBlocksService,
    FriendshipAccess,
    { provide: REDIS_CLIENT, useFactory: () => createRedisClient('Friends Redis') },
    RedisClientLifecycle,
    PrismaService,
  ],
  exports: [FriendsService],
})
export class FriendsModule {}
