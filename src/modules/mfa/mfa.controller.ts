import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { MfaService } from './mfa.service';
import {
  StartTotpDto,
  VerifyTotpDto,
  DisableTotpDto,
  GenerateBackupDto,
  ConsumeBackupDto,
  DisableWithRecoveryDto,
} from './dto/mfa.dto';

@Controller('mfa')
@UseGuards(JwtAuthGuard) // Require authentication for all endpoints
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  @Get('status')
  @HttpCode(HttpStatus.OK)
  async getStatus(@CurrentUser() user: { id: string }) {
    const enabled = await this.mfa.hasMfaEnabled(user.id);
    return { enabled };
  }

  @Post('totp/start')
  @HttpCode(HttpStatus.OK)
  async startTotpSetup(
    @CurrentUser() user: { id: string },
    @Body() dto: StartTotpDto,
  ) {
    return this.mfa.startTotpEnroll(user.id, 'BookingApp', dto.label);
  }

  @Post('totp/enable')
  @HttpCode(HttpStatus.OK)
  async enableTotp(
    @CurrentUser() user: { id: string },
    @Body() dto: VerifyTotpDto,
  ) {
    return this.mfa.verifyTotpAndEnable(user.id, dto.code);
  }

  @Post('totp/verify')
  @HttpCode(HttpStatus.OK)
  async verifyTotp(
    @CurrentUser() user: { id: string },
    @Body() dto: VerifyTotpDto,
  ) {
    return this.mfa.verifyTotp(user.id, dto.code);
  }

  @Post('totp/disable')
  @HttpCode(HttpStatus.OK)
  async disableTotp(
    @CurrentUser() user: { id: string },
    @Body() dto: DisableTotpDto,
  ) {
    return this.mfa.disableTotp(user.id, dto.code, dto.backupCode);
  }

  @Post('backup/generate')
  @HttpCode(HttpStatus.OK)
  async generateBackupCodes(
    @CurrentUser() user: { id: string },
    @Body() dto: GenerateBackupDto,
  ) {
    return this.mfa.generateBackupCodes(user.id, dto.count);
  }

  @Post('backup/consume')
  @HttpCode(HttpStatus.OK)
  async consumeBackupCode(
    @CurrentUser() user: { id: string },
    @Body() dto: ConsumeBackupDto,
  ) {
    return this.mfa.consumeBackupCode(user.id, dto.code);
  }

  @Post('recovery/generate')
  @HttpCode(HttpStatus.OK)
  async generateRecoveryKey(@CurrentUser() user: { id: string }) {
    return this.mfa.generateRecoveryKey(user.id);
  }

  @Post('recovery/disable')
  @HttpCode(HttpStatus.OK)
  async disableWithRecovery(
    @CurrentUser() user: { id: string },
    @Body() dto: DisableWithRecoveryDto,
  ) {
    return this.mfa.disableMfaWithRecovery(user.id, dto.recoveryKey);
  }
}
