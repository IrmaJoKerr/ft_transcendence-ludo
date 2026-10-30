import { Module } from '@nestjs/common';
import { AchievementsService } from './achievements.service';
import { AchievementsController } from './achievements.controller';
import { PrismaService } from '../prisma.service';
import { NotificationModule } from '../notification/notification.module';
import { BlockStateModule } from '../friends/block-state.module';

@Module({
  imports: [NotificationModule, BlockStateModule],
  controllers: [AchievementsController],
  providers: [AchievementsService, PrismaService],
  exports: [AchievementsService],
})
export class AchievementsModule {}
