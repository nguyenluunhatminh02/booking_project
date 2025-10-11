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
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt.guard'; // đảm bảo guard này set req.user.id
import { MessagingService } from './messaging.service';
import { SendMessageDto } from './dto/send-message.dto';
import { MuteDto } from './dto/mute.dto';
import { ListMessagesQuery } from './dto/list-messages.dto';
import { SearchInboxDto } from './dto/search-inbox.dto';

@UseGuards(JwtAuthGuard)
@Controller('inbox')
export class MessagingController {
  constructor(private readonly svc: MessagingService) {}

  // ---- Start conversations ----
  @Post('start/direct/:targetUserId')
  startDirect(@Req() req: any, @Param('targetUserId') targetUserId: string) {
    return this.svc.startDirect(req.user.id, targetUserId);
  }

  @Post('start/property/:propertyId')
  startProperty(@Req() req: any, @Param('propertyId') propertyId: string) {
    return this.svc.startProperty(req.user.id, propertyId);
  }

  // ---- List & detail ----
  @Get('conversations')
  listConversations(
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.svc.listConversations(
      req.user.id,
      limit ? Number(limit) : 20,
      cursor,
    );
  }

  @Get('conversations/:id')
  getConversation(@Req() req: any, @Param('id') id: string) {
    return this.svc.getConversation(req.user.id, id);
  }

  // ---- Messages ----
  @Get('conversations/:id/messages')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  listMessages(
    @Req() req: any,
    @Param('id') id: string,
    @Query() q: ListMessagesQuery,
  ) {
    return this.svc.listMessages(req.user.id, id, q.limit ?? 30, q.beforeId);
  }

  @Post('conversations/:id/messages')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @Throttle({ default: { limit: 30, ttl: 60 } }) // 30 msg/phút/user (bật ThrottlerModule ở AppModule)
  sendMessage(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.svc.sendMessage(req.user.id, id, dto);
  }

  @Post('conversations/:id/read')
  markRead(@Req() req: any, @Param('id') id: string) {
    return this.svc.markRead(req.user.id, id);
  }

  @Delete('messages/:messageId')
  deleteMessageSoft(@Req() req: any, @Param('messageId') messageId: string) {
    return this.svc.deleteMessageSoft(req.user.id, messageId);
  }

  // ---- Pin / Archive / Mute ----
  @Post('conversations/:id/pin')
  pin(@Req() req: any, @Param('id') id: string) {
    return this.svc.pin(req.user.id, id);
  }
  @Delete('conversations/:id/pin')
  unpin(@Req() req: any, @Param('id') id: string) {
    return this.svc.unpin(req.user.id, id);
  }

  @Post('conversations/:id/archive')
  archive(@Req() req: any, @Param('id') id: string) {
    return this.svc.archive(req.user.id, id);
  }
  @Delete('conversations/:id/archive')
  unarchive(@Req() req: any, @Param('id') id: string) {
    return this.svc.unarchive(req.user.id, id);
  }

  @Post('conversations/:id/mute')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  mute(@Req() req: any, @Param('id') id: string, @Body() dto: MuteDto) {
    return this.svc.mute(req.user.id, id, dto);
  }

  // ---- Block list ----
  @Post('blocks/:targetUserId')
  block(@Req() req: any, @Param('targetUserId') targetUserId: string) {
    return this.svc.block(req.user.id, targetUserId);
  }
  @Delete('blocks/:targetUserId')
  unblock(@Req() req: any, @Param('targetUserId') targetUserId: string) {
    return this.svc.unblock(req.user.id, targetUserId);
  }
  @Get('blocks')
  listBlocked(@Req() req: any) {
    return this.svc.listBlocked(req.user.id);
  }

  // ---- Typing indicator ----
  @Post('conversations/:id/typing')
  @Throttle({ default: { limit: 60, ttl: 60 } }) // 60 hit/phút/user
  typing(
    @Req() req: any,
    @Param('id') id: string,
    @Body('isTyping') isTyping: any,
  ) {
    return this.svc.typing(req.user.id, id, Boolean(isTyping));
  }

  // ---- Search ----
  @Get('search')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  search(@Req() req: any, @Query() q: SearchInboxDto) {
    return this.svc.search(req.user.id, q.q, q.limit ?? 20);
  }
}
