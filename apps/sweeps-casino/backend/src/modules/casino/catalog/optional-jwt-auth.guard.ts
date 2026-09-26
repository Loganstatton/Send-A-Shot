import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../config/configuration';
import { AccessTokenPayload } from '../../../common/guards/jwt-auth.guard';

/**
 * Like JwtAuthGuard but never rejects the request. Used for endpoints
 * (GET /casino/sections) that personalize their response when a valid
 * access token is present but must still work for anonymous visitors —
 * an invalid/expired/missing token is simply treated as "anonymous"
 * rather than a 401.
 */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return true;

    const token = authHeader.slice('Bearer '.length);
    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.configService.get('jwt.accessSecret', { infer: true }),
      });
      request.user = { userId: payload.sub, email: payload.email, username: payload.username };
    } catch {
      // Invalid/expired token on a public endpoint: fall back to anonymous.
    }
    return true;
  }
}
