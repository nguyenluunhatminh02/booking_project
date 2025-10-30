import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ListFilesQuery {
  @IsOptional() @IsInt() @Min(1) limit?: number;
  @IsOptional() @IsString() cursor?: string; // last seen file id
}
