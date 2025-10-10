import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ListNotiQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string; // last seen noti id

  @IsOptional()
  @IsBoolean()
  unreadOnly?: boolean;
}
