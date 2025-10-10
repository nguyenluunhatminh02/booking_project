import { IsInt, IsOptional, Min } from 'class-validator';

export class MuteDto {
  // mute trong X phút; nếu không gửi hoặc =0 → unmute
  @IsOptional()
  @IsInt()
  @Min(0)
  minutes?: number;
}
