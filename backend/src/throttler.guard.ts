import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Global rate-limit guard. The library's rejection body is a lone English string,
// which would surface untranslated. We throw a plain HttpException with the same
// { code, message } shape as every other error, so the client localizes it.
@Injectable()
export class CodedThrottlerGuard extends ThrottlerGuard {
  protected throwThrottlingException(): Promise<void> {
    throw new HttpException(
      { code: 'RATE_LIMITED', message: 'Too many requests: try again later' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
