// src/auth/jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

type JwtPayload = {
  sub: string;
  av: number;
  jti: string;
  iat: number;
  exp: number;
};

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET || 'dev-access',
      audience: process.env.JWT_AUDIENCE || 'booking-fe',
      issuer: process.env.JWT_ISSUER || 'booking-api',
    });
  }

  validate(payload: JwtPayload) {
    return {
      id: payload.sub,
      av: payload.av,
      jti: payload.jti,
      exp: payload.exp,
      iat: payload.iat,
    };
  }
}
