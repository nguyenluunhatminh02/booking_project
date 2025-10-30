import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ListMessagesQuery {
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number = 30;

  @IsOptional()
  @IsString()
  beforeId?: string; // keyset: lấy tin nhắn cũ hơn id này
}
