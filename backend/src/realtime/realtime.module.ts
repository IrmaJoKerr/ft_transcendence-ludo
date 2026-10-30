import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MatchModule } from '../match/match.module';
import { PresenceModule } from '../presence/presence.module';
import { RealtimeBroadcaster } from './realtime-broadcaster.service';
import { RealtimeGateway } from './realtime.gateway';
import { SessionAuthService } from './session-auth';

// The session socket (socket consolidation): the gateway, the handshake gate, the
// presence wiring, the rooms diff and the Redis subscriber. AuthModule exports the
// configured JwtModule, so the handshake verifies tokens with the API's own rule
// rather than a copy; PresenceModule exports the service the gateway registers
// connections with (Phase 1); MatchModule exports the query service whose
// snapshot the broadcaster diffs (Phase 2).
@Module({
  imports: [AuthModule, PresenceModule, MatchModule],
  providers: [SessionAuthService, RealtimeGateway, RealtimeBroadcaster],
})
export class RealtimeModule {}


