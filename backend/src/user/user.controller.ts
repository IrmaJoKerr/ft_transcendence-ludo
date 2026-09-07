import { Controller, Get, Post, Delete, Param, UseGuards, Request, Res, UploadedFile, UseInterceptors, NotFoundException, BadRequestException, Query } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/user')
// HTTP routes for user profiles: public profile, game history, and the
// authenticated avatar upload/get/delete endpoints. Delegates to UserService.
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

  // Accept an avatar image (multipart 'avatar' field, max 2MB), allowlist
  // the content type, and store it. POST /api/user/avatar.
  @UseGuards(JwtAuthGuard)
  @Post('avatar')
  @UseInterceptors(FileInterceptor('avatar', { limits: { fileSize: 2 * 1024 * 1024 } }))
  async uploadAvatar(
    @Request() req: { user: { id: string } },
    @UploadedFile() file: any,
  ) {
    if (!file) {
      throw new BadRequestException('Avatar file is required');
    }
    const allowedMimes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!allowedMimes.includes(file.mimetype)) {
      throw new BadRequestException('Invalid file type. Allowed: PNG, JPEG, GIF, WebP');
    }
    return this.userService.uploadAvatar(req.user.id, file.buffer, file.mimetype);
  }

  @Get(':username/avatar')
  async getAvatar(@Param('username') username: string, @Res() res: Response) {
    const result = await this.userService.getAvatar(username);
    if (!result) {
      throw new NotFoundException('No custom avatar set');
    }
    res.set('Content-Type', result.contentType);
    // Never cache avatars: the photo lives in Postgres and can change at any
    // moment. `no-store` (instead of the old `public, max-age=86400`) is what
    // makes live avatar updates via the SSE `avatar_changed` broadcast actually
    // visible : a cached copy would swallow every refetch for up to a day.
    res.set('Cache-Control', 'no-store');
    res.send(result.data);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('avatar')
  async deleteAvatar(@Request() req: { user: { id: string } }) {
    return this.userService.deleteAvatar(req.user.id);
  }
}