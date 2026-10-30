import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeBroadcaster } from './realtime-broadcaster.service';
import { RealtimeGateway } from './realtime.gateway';
import { SessionAuthService } from './session-auth';

// The session socket (socket consolidation, Phase 0): the gateway, the handshake
// gate and the Redis subscriber. AuthModule exports the configured JwtModule, so
// the handshake verifies tokens with the API's own rule rather than a copy.
@Module({
  imports: [AuthModule],
  providers: [SessionAuthService, RealtimeGateway, RealtimeBroadcaster],
})
export class RealtimeModule {}
