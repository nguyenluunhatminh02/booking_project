import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class ListReviewsQueryDto {
  @IsString()
  propertyId!: string;

  @IsOptional()
  @IsUUID('4')
  cursor?: string; // id review cuối trang trước

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number; // default 20
}
