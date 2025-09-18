import { IsBoolean, IsOptional } from 'class-validator';

export class UpsertFlagDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  payload?: any;
}
