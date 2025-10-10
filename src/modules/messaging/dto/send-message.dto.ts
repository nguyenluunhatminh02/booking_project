import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SendAttachmentDto {
  @IsString()
  @IsNotEmpty()
  fileId!: string;

  @IsOptional()
  @IsIn(['IMAGE', 'VIDEO'])
  type?: 'IMAGE' | 'VIDEO';
}

export class SendMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  body?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SendAttachmentDto)
  attachments?: SendAttachmentDto[];
}
