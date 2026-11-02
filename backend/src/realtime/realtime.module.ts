import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { BlockStateModule } from '../friends/block-state.module';
import { MatchModule } from '../match/match.module';
import { NotificationModule } from '../notification/notification.module';
import { PresenceModule } from '../presence/presence.module';
import { RealtimeBroadcaster } from './realtime-broadcaster.service';
import { RealtimeGateway } from './realtime.gateway';
import { SessionAuthService } from './session-auth';

// The session socket (socket consolidation): the gateway, the handshake gate, the
// presence wiring, the rooms diff, the notification sink and the Redis subscriber.
// AuthModule exports the configured JwtModule, so the handshake verifies tokens
// with the API's own rule rather than a copy; PresenceModule exports the service
// the gateway registers connections with (Phase 1); MatchModule exports the query
// service whose snapshot the broadcaster diffs (Phase 2); NotificationModule
// exports the hub the gateway sets its deliverer on (Phase 4); ChatModule owns the
// public channel's transcript and fan-out (queue item 3), and BlockStateModule is
// the Prisma-only leaf the chat filter is seeded from.
@Module({
  imports: [
    AuthModule,
    PresenceModule,
    MatchModule,
    NotificationModule,
    ChatModule,
    BlockStateModule,
  ],
  providers: [SessionAuthService, RealtimeGateway, RealtimeBroadcaster],
})
export class RealtimeModule {}


