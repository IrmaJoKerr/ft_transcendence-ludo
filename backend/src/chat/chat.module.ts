import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ChatService } from './chat.service';

// The public chat channel: one provider, one Redis list and one plain publish.
// RealtimeModule imports it, because the gateway is the only writer and the
// broadcaster is the only reader.
@Module({
  providers: [ChatService, PrismaService],
  exports: [ChatService],
})
export class ChatModule {}
