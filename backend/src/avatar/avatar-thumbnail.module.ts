import { Module } from '@nestjs/common';
import { AvatarThumbnailService } from './avatar-thumbnail.service';

@Module({
  providers: [AvatarThumbnailService],
  // Exported so UserModule can build the thumbnail during an upload; the service
  // is stateless, so the import shares nothing but the class.
  exports: [AvatarThumbnailService],
})
export class AvatarThumbnailModule {}
