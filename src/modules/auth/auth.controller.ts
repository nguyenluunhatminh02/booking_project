// src/auth/auth.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
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
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from './cookie-options';
import { Public } from 'src/common/decorators/public.decorator';
import {
  RequirePermissions,
  Resource,
} from '../rbac/decorators/permissions.decorator';
import { P, R } from '../rbac/perms';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Audit } from 'src/common/decorators/audit.decorator';
import { DeviceApprovalService } from './device-approval.service';
import { XssSanitize } from 'src/common/transforms/senitize-html.transform';

const FE_OK_REDIRECT = process.env.FE_APPROVE_OK_URL || '';
const FE_ERR_REDIRECT = process.env.FE_APPROVE_ERR_URL || '';
const REDIRECT_WHITELIST = (process.env.APPROVE_REDIRECT_WHITELIST || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

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

class ApproveDeviceDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}

class LoginDto {
  @IsEmail()
  @XssSanitize()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsString()
  deviceFp?: string; // FE gửi fingerprint hash
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
@UseInterceptors(AuditInterceptor)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly das: DeviceApprovalService,
  ) {}

  private setRefreshTokenCookie(res: Response, token: string) {
    res.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions);
  }

  private excludeRefreshToken<T extends { refreshToken: string }>(data: T) {
    // Remove refreshToken from response body
    const { refreshToken: _, ...rest } = data;
    return rest;
  }

  @Post('register')
  @Public()
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.register(dto.email, dto.password, req.ctx);
    this.setRefreshTokenCookie(res, result.refreshToken);
    return this.excludeRefreshToken(result);
  }

  @Post('login')
  @Audit({
    action: 'AUTH_LOGIN',
    entity: 'USER',
  })
  @Public()
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.auth.login(
      dto.email,
      dto.password,
      dto.deviceId,
      req.ctx,
    );
    this.setRefreshTokenCookie(res, out.refreshToken);
    return this.excludeRefreshToken(out);
  }

  @Public()
  @Get('approve-device')
  async approveByQuery(
    @Query('token') token: string,
    @Query('redirect') redirect: string | undefined,
    @Res() res: Response,
  ) {
    if (!token) throw new BadRequestException('Missing token');

    const allow = (url?: string) => {
      if (!url) return false;
      try {
        const u = new URL(url);
        return REDIRECT_WHITELIST.some((p) => url.startsWith(p));
      } catch {
        return false;
      }
    };

    try {
      await this.das.approve(token);

      // Ưu tiên redirect tùy chọn (nếu nằm trong whitelist)
      if (allow(redirect)) return res.redirect(redirect as string);
      // Nếu có FE_* trong .env thì redirect
      if (FE_OK_REDIRECT) return res.redirect(FE_OK_REDIRECT);
      // Fallback: trả HTML tối giản
      return res.status(200).type('html').send(successHtml());
    } catch {
      if (allow(redirect)) return res.redirect(redirect as string);
      if (FE_ERR_REDIRECT) return res.redirect(FE_ERR_REDIRECT);
      return res.status(400).type('html').send(errorHtml());
    }
  }

  /** POST /auth/approve-device { token } (tuỳ chọn: gọi API trực tiếp) */
  @Public()
  @Post('approve-device')
  @HttpCode(200)
  async approveByBody(@Body() dto: ApproveDeviceDto) {
    return this.das.approve(dto.token); // { ok: true, sessionId }
  }

  @Post('refresh')
  @Public()
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rt = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!rt) throw new UnauthorizedException('Missing refresh token');
    const out = await this.auth.refresh(rt, req.ctx);
    if (!out) throw new UnauthorizedException('Invalid refresh token');
    if (out?.refreshToken) {
      this.setRefreshTokenCookie(res, out.refreshToken);
    }
    return this.excludeRefreshToken(out);
  }

  @Post('logout')
  @RequirePermissions(P.User.update)
  @Resource(R.Property.params('id'))
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rt = req.cookies?.[REFRESH_COOKIE_NAME];
    if (rt) await this.auth.logout(rt);
    res.clearCookie(REFRESH_COOKIE_NAME, {
      ...refreshCookieOptions,
      maxAge: 0,
    });
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout-others')
  @HttpCode(200)
  async logoutOthers(@Req() req: any) {
    const userId: string = req.user?.sub;
    const keepSid: string | undefined = req.user?.sid; // sid đã nhúng trong AT của bạn
    const out = await this.auth.logoutAll(userId, keepSid);
    return { ok: true, revoked: out.revoked };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    const userId: string = req.user?.sub;
    const out = await this.auth.logoutAll(userId);
    res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions);
    return { ok: true, revoked: out.revoked };
  }

  @Post('revoke-access')
  @HttpCode(HttpStatus.OK)
  async revokeAccess(@Body() dto: RevokeAccessDto) {
    return this.auth.revokeAccessToken(dto.accessToken);
  }
}

function successHtml() {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Device Approved</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;padding:24px;color:#111}</style>
</head>
<body>
  <h2>✅ Device approved</h2>
  <p>You can close this tab now.</p>
  <script>setTimeout(()=>{ try{window.close()}catch(e){} },3000)</script>
</body>
</html>`;
}

function errorHtml() {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Invalid or expired</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;padding:24px;color:#111}</style>
</head>
<body>
  <h2>❌ Invalid or expired token</h2>
  <p>Please request a new approval link.</p>
</body>
</html>`;
}
