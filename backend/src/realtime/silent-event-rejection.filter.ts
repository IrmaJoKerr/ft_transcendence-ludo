import { BadRequestException, Catch } from '@nestjs/common';
import type { ExceptionFilter } from '@nestjs/common';

// Drop a rejected `presence:playing` payload without logging. The bit is re-asserted on
// connect and the socket is unthrottled, so logging would allow one error per packet.
// Any other exception still reaches the default handler.
@Catch(BadRequestException)
export class SilentEventRejectionFilter implements ExceptionFilter {
  catch(): void {
    // no response, no log: the client is not waiting for one
  }
}
