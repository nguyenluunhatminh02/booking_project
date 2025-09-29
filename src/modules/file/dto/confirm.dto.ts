import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class ConfirmDto {
  @IsString() @IsNotEmpty() key!: string;
  @IsOptional() @IsString() contentType?: string;
  @IsOptional() @IsInt() @Min(0) bytes?: number;
  @IsOptional() @IsString() checksum?: string;
  @IsOptional() @IsInt() @Min(0) width?: number;
  @IsOptional() @IsInt() @Min(0) height?: number;
  @IsOptional() tags?: string[];
}
