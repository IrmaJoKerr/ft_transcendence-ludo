import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { BlockStateService } from './block-state.service';

@Module({
  providers: [BlockStateService, PrismaService],
  // Imported by UserModule, AchievementsModule and FriendsModule. A Prisma-only
  // leaf, so a reader of a profile never pulls MatchModule in behind it.
  exports: [BlockStateService],
})
export class BlockStateModule {}
