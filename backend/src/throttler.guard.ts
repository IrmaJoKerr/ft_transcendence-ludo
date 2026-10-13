import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Global rate-limit guard. The library's default rejection body is a lone
// English string ("ThrottlerException: Too Many Requests"), which api.ts would
// surface untranslated. We swap in the same { code, message } shape used by
// every other error so the frontend localizes it via errors.RATE_LIMITED.
// ThrottlerException only accepts a string, so we throw a plain HttpException.
@Injectable()
export class CodedThrottlerGuard extends ThrottlerGuard {
  protected async throwThrottlingException(): Promise<void> {
    throw new HttpException(
      { code: 'RATE_LIMITED', message: 'Too many requests: try again later' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
