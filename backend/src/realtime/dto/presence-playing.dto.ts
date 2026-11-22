import { IsBoolean } from 'class-validator';

// `presence:playing`, the only client-to-server session event. Required, because the
// client re-asserts it on connect; absent is unknown, not false. The pipe is explicit
// because a gateway handler is not a controller.
export class PresencePlayingDto {
  @IsBoolean()
  playing!: boolean;
}
