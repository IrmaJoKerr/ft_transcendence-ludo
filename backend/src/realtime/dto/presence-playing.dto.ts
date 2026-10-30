import { IsBoolean } from 'class-validator';

// `presence:playing` — the only client -> server event on the session socket
// (D3). Required rather than optional: the client re-asserts the whole bit on
// every connect, so an absent field would mean "unknown" and must not be read as
// `false`. A gateway handler is not a controller, so the pipe is explicit (D10).
export class PresencePlayingDto {
  @IsBoolean()
  playing!: boolean;
}
