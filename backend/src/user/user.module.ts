import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { PrismaService } from '../prisma.service';
import { PresenceModule } from '../presence/presence.module';
import { NotificationModule } from '../notification/notification.module';
import { AvatarMetaModule } from '../avatar/avatar-meta.module';
import { BlockStateModule } from '../friends/block-state.module';

@Module({
  imports: [PresenceModule, NotificationModule, AvatarMetaModule, BlockStateModule],
  controllers: [UserController],
  providers: [UserService, PrismaService],
  exports: [UserService],
})
export class UserModule {}
