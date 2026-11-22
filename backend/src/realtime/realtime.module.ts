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

// Session socket wiring: gateway, handshake, presence, room diff, notifications and
// Redis subscriber. Auth supplies the JWT rule, Match the room snapshot, Notification
// the deliverer, Chat the public channel, and BlockState the chat filter seed.
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


