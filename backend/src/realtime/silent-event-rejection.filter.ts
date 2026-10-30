import { BadRequestException, Catch } from '@nestjs/common';
import type { ExceptionFilter } from '@nestjs/common';

// A rejected `presence:playing` payload is dropped without a log line. The event
// is a fire-and-forget bit the client re-asserts on every connect, and this socket
// is deliberately unthrottled, so one client sending junk could otherwise write an
// ERROR line per packet. This matches the HTTP side, where Nest does not log a
// 4xx either. Any other exception still reaches the default handler.
@Catch(BadRequestException)
export class SilentEventRejectionFilter implements ExceptionFilter {
  catch(): void {
    // no response, no log: the client is not waiting for one
  }
}
