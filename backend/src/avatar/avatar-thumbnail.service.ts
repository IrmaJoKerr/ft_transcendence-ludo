import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';

// Derivative build for uploaded avatars: a 256 px WebP copy of the photo (the
// largest on-screen avatar is 95 px, so 256 px covers a 2x display). The
// canonical upload is kept untouched in `avatarPhoto`; this is only the copy the
// avatar route prefers to serve.
//
// Everything here is bounded, because the input is user-supplied. Note that
// libvips' `limitInputPixels` applies PER FRAME, not to the whole animation: a
// 120-frame GIF passes a 25 MP limit 120 times over, so the frame count has to
// be capped here (MAX_FRAMES). Animated WebP keeps the frame delays and loops
// forever, so an animated GIF upload stays animated.
const THUMB_SIZE = 256;
const THUMB_QUALITY = 80;
// 4 = the encoder's default balance; higher efforts buy a few bytes for a lot of
// CPU on every upload.
const THUMB_EFFORT = 4;
const MAX_INPUT_PIXELS = 25_000_000; // 25 MP per frame
const MAX_FRAMES = 120;
const MAX_THUMB_BYTES = 400 * 1024;
const TIMEOUT_SECONDS = 5;

export interface AvatarThumbnail {
  // Prisma types a Bytes column as Uint8Array<ArrayBuffer>, so the derivative is
  // built into that shape rather than the wider Uint8Array<ArrayBufferLike>.
  data: Uint8Array<ArrayBuffer>;
  contentType: string;
}

@Injectable()
// Thumbnail builder for avatar uploads. Pure CPU, no state, no database: the
// caller decides what to do with the result. Used by UserService.uploadAvatar().
export class AvatarThumbnailService {
  private readonly logger = new Logger(AvatarThumbnailService.name);

  // Returns null when the image cannot be decoded. A decoder failure must not
  // reject the upload: the original is still stored and served, and the browser
  // may well render a file libvips gave up on.
  async build(source: Buffer): Promise<AvatarThumbnail | null> {
    const frames = await this.frameCount(source);
    try {
      const pages = frames > 1 ? Math.min(frames, MAX_FRAMES) : 1;
      let data = await this.render(source, pages);

      // A long animation can still overshoot the budget even at 256 px. One still
      // frame always fits and still shows the picture, so the thumbnail degrades
      // to a still rather than to nothing.
      if (data.length > MAX_THUMB_BYTES && pages > 1) {
        data = await this.render(source, 1);
      }

      return { data: Uint8Array.from(data), contentType: 'image/webp' };
    } catch (error) {
      this.logger.warn(`avatar thumbnail skipped: ${(error as Error).message}`);
      return null;
    }
  }

  // Header read only: `pages` is what tells a still from an animation and costs
  // no decode. A file whose header cannot be read is treated as a still and left
  // to render() to fail cleanly.
  private async frameCount(source: Buffer): Promise<number> {
    try {
      const meta = await sharp(source, {
        limitInputPixels: MAX_INPUT_PIXELS,
        failOn: 'error',
      }).metadata();
      return meta.pages ?? 1;
    } catch {
      return 1;
    }
  }

  // `pages` is both the frame budget and the animation switch: sharp writes a
  // multi-page WebP when more than one page is read, and `pages: 1` on an
  // animated source yields a still (the static fallback above).
  private render(source: Buffer, pages: number): Promise<Buffer> {
    return sharp(source, {
      pages,
      limitInputPixels: MAX_INPUT_PIXELS,
      // Abort on a decode error instead of emitting a half-decoded frame.
      failOn: 'error',
      sequentialRead: true,
    })
      // EXIF orientation first, or a portrait photo taken on a phone would be
      // cropped as if it were landscape.
      .rotate()
      // Cover = fill the square and crop the overflow, so no avatar is
      // letterboxed. No enlargement: a 64 px source stays 64 px instead of
      // becoming a blurry 256 px copy.
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover', withoutEnlargement: true })
      .webp({
        quality: THUMB_QUALITY,
        effort: THUMB_EFFORT,
        // 0 = loop forever, which is what an animated avatar is expected to do.
        // The encoder default is not derived from the source, so the loop count
        // is pinned here rather than inherited.
        loop: 0,
      })
      .timeout({ seconds: TIMEOUT_SECONDS })
      .toBuffer();
  }
}
