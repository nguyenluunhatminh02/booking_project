import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpsertPrefDto {
  @IsString()
  key!: string; // noti key (vd: review_reminder)

  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @IsOptional()
  @IsBoolean()
  push?: boolean;

  @IsOptional()
  @IsBoolean()
  inapp?: boolean;
}
