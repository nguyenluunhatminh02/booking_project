import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { TokenStateService } from '../token-state.service';

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly tokenState: TokenStateService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET || 'dev-access',
      audience: process.env.JWT_AUDIENCE || 'booking-fe',
      issuer: process.env.JWT_ISSUER || 'booking-api',
    });
  }

  async validate(payload: {
    sub: string;
    av: number;
    jti: string;
    sid?: string;
    sv?: number;
  }) {
    const { sub: id, av, jti, sid, sv } = payload;
    if (!id || !jti || typeof av !== 'number') {
      throw new UnauthorizedException('Malformed token');
    }

    let denied: boolean,
      locked: boolean,
      currentAv: number,
      currentSv: number | undefined;

    try {
      [denied, locked, currentAv, currentSv] = await Promise.all([
        this.tokenState.isJtiDenied(jti),
        this.tokenState.isUserLocked(id),
        this.tokenState.getAccessVersion(id),
        sid && sv
          ? this.tokenState.getSessionVersion(sid)
          : Promise.resolve(undefined),
      ]);
    } catch {
      throw new UnauthorizedException('Auth backend unavailable');
    }

    if (denied) throw new UnauthorizedException('Access token revoked');
    if (locked) throw new UnauthorizedException('Account temporarily locked');
    if (currentAv !== av)
      throw new UnauthorizedException('Access token outdated');
    if (sid && sv && currentSv !== undefined && currentSv !== sv) {
      throw new UnauthorizedException('Session token invalidated');
    }

    return { id, av, jti, sid, sv };
  }
}
