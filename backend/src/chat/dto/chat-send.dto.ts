import { IsString } from 'class-validator';

// `chat:send`, the one write on the public channel. Only the type is checked here:
// length and spacing are answered with an ack code, because the panel has a
// reserved line to say why a line did not go.
export class ChatSendDto {
  @IsString()
  text!: string;
}
