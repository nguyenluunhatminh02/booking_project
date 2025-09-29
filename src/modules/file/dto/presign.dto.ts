import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class PresignDto {
  @IsString() @IsNotEmpty() contentType!: string;
  @IsOptional() @IsString() fileName?: string;
  @IsOptional() @IsString() folder?: string;
}
