import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { FilesService } from './files.service';
import { PresignDto } from './dto/presign.dto';
import { ConfirmDto } from './dto/confirm.dto';
import { ListFilesQuery } from './dto/list.dto';
import { ThumbnailService, ThumbSpec } from './thumbnail.service';

@UseGuards(JwtAuthGuard)
@Controller('files')
export class FilesController {
  constructor(
    private readonly svc: FilesService,
    private readonly thumbs: ThumbnailService,
  ) {}

  @Post('presign')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async presign(@Req() req: any, @Body() dto: PresignDto) {
    const userId = req.user.id as string;
    return this.svc.presign(userId, dto.contentType, dto.fileName, dto.folder);
  }

  @Post('confirm')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async confirm(@Req() req: any, @Body() dto: ConfirmDto) {
    const userId = req.user.id as string;
    return this.svc.confirm(userId, dto);
  }

  @Get()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async list(@Req() req: any, @Query() q: ListFilesQuery) {
    const userId = req.user.id as string;
    return this.svc.list(userId, q);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    const userId = req.user.id as string;
    return this.svc.remove(userId, id);
  }

  // ---- Thumbnails ----

  @Post(':id/thumbnails')
  async generateThumbs(
    @Param('id') fileId: string,
    @Body() body: { specs?: ThumbSpec[]; overwrite?: boolean } = {},
  ) {
    return this.thumbs.generate(fileId, body.specs, body.overwrite ?? false);
  }

  @Get(':id/variants')
  async variants(@Param('id') fileId: string) {
    return this.thumbs.listVariants(fileId);
  }

  @Get(':id/presigned-get')
  async presignedGet(
    @Param('id') fileId: string,
    @Query('variant') variant?: string,
    @Query('expires') expires?: string,
  ) {
    const secs = expires ? Number(expires) : 300;
    return this.thumbs.presignedGet(fileId, {
      variant: variant || 'ORIGINAL',
      expires: secs,
    });
  }
}
