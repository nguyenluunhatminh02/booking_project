import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
// Nếu có guard đăng nhập, bật 2 dòng dưới và sửa path theo dự án bạn
// import { UseGuards } from '@nestjs/common';
// import { JwtAuthGuard } from '../auth/guards/jwt.guard';

import { NotificationsService } from './notifications.service';
import { ListNotiQueryDto } from './dto/list.dto';
import { UpsertPrefDto } from './dto/prefs.dto';

// @UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async list(@Req() req: any, @Query() q: ListNotiQueryDto) {
    const userId = (req.user?.id as string) || 'u1';
    return this.svc.list(userId, q);
  }

  @Get('unread-count')
  async unreadCount(@Req() req: any) {
    const userId = (req.user?.id as string) || 'u1';
    return this.svc.unreadCount(userId);
  }

  @Post(':id/read')
  async markRead(@Req() req: any, @Param('id') id: string) {
    const userId = (req.user?.id as string) || 'u1';
    return this.svc.markRead(userId, id);
  }

  @Post('mark-all-read')
  async markAllRead(@Req() req: any) {
    const userId = (req.user?.id as string) || 'u1';
    return this.svc.markAllRead(userId);
  }

  // ==== Preferences ====
  @Get('prefs')
  async listPrefs(@Req() req: any) {
    const userId = (req.user?.id as string) || 'u1';
    return this.svc.listPrefs(userId);
  }

  @Post('prefs')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async upsertPref(@Req() req: any, @Body() body: UpsertPrefDto) {
    const userId = (req.user?.id as string) || 'u1';
    return this.svc.upsertPref(userId, body);
  }

  // ==== Manage ====
  @Post(':id/cancel')
  async cancel(@Req() req: any, @Param('id') id: string) {
    const userId = (req.user?.id as string) || 'u1';
    return this.svc.cancelPending(userId, id);
  }

  @Post(':id/retry')
  async retry(@Req() req: any, @Param('id') id: string) {
    const userId = (req.user?.id as string) || 'u1';
    return this.svc.retryFailed(userId, id);
  }
}
