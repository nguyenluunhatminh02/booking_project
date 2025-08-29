// src/auth/auth.controller.ts
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request } from 'express';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt.guard';
import { CurrentUserId } from 'src/common/decorators/current-user.decorator';
import { RateLimit } from 'src/common/decorators/rate-limit.decorator';

// =====================
// DTOs
// =====================
class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  deviceId?: string;
}

class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

class LogoutDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

class LogoutAllDto {
  @IsOptional()
  @IsString()
  keepSessionId?: string;
}

class RevokeAccessDto {
  @IsString()
  @IsNotEmpty()
  accessToken!: string;
}

@Controller('auth')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // helper lấy IP/UA (trust proxy đã bật ở main.ts nếu dùng LB)
  private getCtx(req: Request) {
    // Nếu đã app.set('trust proxy', true), req.ip sẽ là client IP thực
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      (req.socket?.remoteAddress ?? req.ip) ||
      'unknown';
    const ua = req.headers['user-agent'];
    return { ip, ua };
  }

  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.auth.register(dto.email, dto.password, ctx);
  }

  @Post('login')
  @RateLimit({
    capacity: 2,
    refillTokens: 2,
    refillIntervalMs: 60_000,
    keyBy: 'email',
  })
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.auth.login(dto.email, dto.password, dto.deviceId, ctx);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    const ctx = this.getCtx(req);
    return this.auth.refresh(dto.refreshToken, ctx);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() dto: LogoutDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logoutAll(@CurrentUserId() userId: string, @Body() dto: LogoutAllDto) {
    // Thông thường userId lấy từ auth guard (req.user.sub). Ở đây giả định bạn đã có guard gắn vào controller.
    // Nếu chưa có, thêm @UseGuards(AuthGuard) và đọc userId từ req.user.
    // For demo, tạm lấy từ header 'x-user-id' (bỏ khi có guard thật).

    if (!userId) {
      // có thể throw UnauthorizedException tại đây nếu cần
      return { ok: false, message: 'Missing userId' };
    }
    return this.auth.logoutAll(userId, dto.keepSessionId);
  }

  @Post('revoke-access')
  @HttpCode(HttpStatus.OK)
  async revokeAccess(@Body() dto: RevokeAccessDto) {
    return this.auth.revokeAccessToken(dto.accessToken);
  }
}
