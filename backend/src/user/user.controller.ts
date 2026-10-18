import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseGuards,
  Request,
  Res,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { USER_THROTTLE } from '../common/throttles';
import { Response } from 'express';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { isImageValid } from '../avatar/image-signature.util';


// User routes: public profile/history plus authenticated avatar upload, fetch and
// delete. Avatars are cacheable but revalidated (no-cache + ETag).
interface UploadedAvatarFile {
  mimetype: string;
  buffer: Buffer;
}

@Controller('api/user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get(':username')
  async getPublicProfile(@Param('username') username: string) {
    return this.userService.getPublicProfile(username);
  }

  @Get(':username/games')
  async getUserGames(
    @Param('username') username: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? Math.min(parseInt(limit, 10), 100) : 20;
    return this.userService.getUserGames(username, pageNum, limitNum);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle(USER_THROTTLE.avatarUpload)
  @Post('avatar')
  @UseInterceptors(FileInterceptor('avatar', { limits: { fileSize: 2 * 1024 * 1024 } })) //Max 2Mb
  async uploadAvatar(
    @Request() req: { user: { id: string } },
    @UploadedFile() file: UploadedAvatarFile | undefined,
  ) {
    if (!file) {
      throw new BadRequestException({
        code: 'AVATAR_FILE_REQUIRED',
        message: 'Avatar file is required',
      });
    }
    // The declared mimetype is only the client's claim, so check both the MIME
    // whitelist and the actual magic bytes before storing anything.
    if (!isImageValid(file.buffer, file.mimetype)) {
      throw new BadRequestException({
        code: 'AVATAR_INVALID_TYPE',
        message: 'Invalid file type. Allowed: PNG, JPEG, GIF, WebP',
      });
    }
    return this.userService.uploadAvatar(req.user.id, file.buffer, file.mimetype);
  }

  // The photo, keyed by the immutable user id: a rename can never turn this URL
  // into a 404 the way a display-name-keyed route could.
  @Get('id/:userId/avatar')
  async getAvatarById(@Param('userId') userId: string, @Res() res: Response) {
    this.sendAvatar(res, await this.userService.getAvatarById(userId));
  }

  // Shared responder so the caching contract can't drift from the route.
  private sendAvatar(res: Response, result: { data: Buffer; contentType: string } | null): void {
    if (!result) {
      // "No photo" is a normal state, not something to retry, so mark it
      // uncacheable: with an ETag, Express would answer a later revalidation 304
      // and keep the missing photo in place.
      res.set('Cache-Control', 'no-store');
      res
        .status(404)
        .json({ message: 'No custom avatar set', error: 'Not Found', statusCode: 404 });
      return;
    }
    res.set('Content-Type', result.contentType);
    // Deliberately not max-age: the URL is stable and the bytes change on every
    // re-upload. `no-cache` = store but revalidate before reuse, so with the ETag
    // an unchanged photo costs a 304 and a changed one returns the new bytes.
    res.set('Cache-Control', 'public, no-cache, no-transform');
    res.send(result.data);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle(USER_THROTTLE.avatarDelete)
  @Delete('avatar')
  async deleteAvatar(@Request() req: { user: { id: string } }) {
    return this.userService.deleteAvatar(req.user.id);
  }
}
