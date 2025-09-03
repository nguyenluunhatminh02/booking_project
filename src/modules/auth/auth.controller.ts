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
// import { RateLimit } from 'src/common/decorators/rate-limit.decorator';
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
@UseInterceptors(AuditInterceptor)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly das: DeviceApprovalService,
  ) {}

  // Helper methods
  private setRefreshTokenCookie(res: Response, token: string) {
    res.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions);
  }

  private excludeRefreshToken<T extends { refreshToken: string }>(data: T) {
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
    // không cần gửi refreshToken trong body nữa
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

    res.cookie(REFRESH_COOKIE_NAME, out.refreshToken, refreshCookieOptions);
    const { refreshToken, ...rest } = out;
    return rest;
  }

  @Post('approve-device')
  async approve(@Body() dto: ApproveDeviceDto) {
    return this.das.approve(dto.token);
  }

  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rt = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!rt) throw new UnauthorizedException('Missing refresh token');

    const out = await this.auth.refresh(rt, req.ctx);
    res.cookie(REFRESH_COOKIE_NAME, out.refreshToken, refreshCookieOptions);

    const { refreshToken, ...rest } = out;
    return rest;
  }

  @Post('logout')
  //   @RequireRole('admin')
  @RequirePermissions(P.User.update)
  @Resource(R.Property.params('id'))
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

  //   @Patch('me')
  //   @RequireAnyPermissions(P.User.update, P.User.manage) // hoặc chỉ cần JWT
  //   updateMe(@CurrentUser() me: { id: string }, @Body() dto: UpdateProfileDto) {
  //     return this.users.update(me.id, dto);
  //   }
}
