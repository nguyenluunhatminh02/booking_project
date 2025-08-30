// src/auth/auth.controller.ts
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request, Response } from 'express';
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
// import { RateLimit } from 'src/common/decorators/rate-limit.decorator';
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from './cookie-options';

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
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ctx = this.getCtx(req);
    const out = await this.auth.register(dto.email, dto.password, ctx);

    res.cookie(REFRESH_COOKIE_NAME, out.refreshToken, refreshCookieOptions);
    // không cần gửi refreshToken trong body nữa
    const { refreshToken, ...rest } = out;
    return rest;
  }

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ctx = this.getCtx(req);
    const out = await this.auth.login(
      dto.email,
      dto.password,
      dto.deviceId,
      ctx,
    );

    res.cookie(REFRESH_COOKIE_NAME, out.refreshToken, refreshCookieOptions);
    const { refreshToken, ...rest } = out;
    return rest;
  }

  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rt = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!rt) throw new UnauthorizedException('Missing refresh token');

    const out = await this.auth.refresh(rt, this.getCtx(req));
    res.cookie(REFRESH_COOKIE_NAME, out.refreshToken, refreshCookieOptions);

    const { refreshToken, ...rest } = out;
    return rest;
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rt = req.cookies?.[REFRESH_COOKIE_NAME];
    if (rt) await this.auth.logout(rt);
    // xoá cookie
    res.clearCookie(REFRESH_COOKIE_NAME, {
      ...refreshCookieOptions,
      maxAge: 0,
    });
    return { ok: true };
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
