import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AppConfig } from '../../config/configuration';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

function ageInYears(dob: Date, at = new Date()): number {
  let age = at.getFullYear() - dob.getFullYear();
  const monthDiff = at.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && at.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async register(dto: RegisterDto, meta: { ip?: string; userAgent?: string }) {
    const state = dto.stateOfRecord.toUpperCase();

    const jurisdiction = await this.prisma.jurisdiction.findUnique({ where: { state } });
    const status = jurisdiction?.status ?? 'BLOCKED';
    if (status === 'BLOCKED' || status === 'REGISTRATION_DISABLED') {
      throw new ForbiddenException({
        code: 'JURISDICTION_RESTRICTED',
        message: `Registration is not currently available in ${state}.`,
      });
    }

    const minAge = jurisdiction?.minAge ?? 21;
    const dob = new Date(dto.dateOfBirth);
    if (ageInYears(dob) < minAge) {
      throw new ForbiddenException({
        code: 'AGE_RESTRICTED',
        message: `You must be at least ${minAge} years old to register.`,
      });
    }

    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email.toLowerCase() }, { username: dto.username }] },
    });
    if (existing) {
      throw new ConflictException({
        code: 'ACCOUNT_EXISTS',
        message: 'An account with this email or username already exists.',
      });
    }

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });

    const baseVipLevel = await this.prisma.vipLevel.findFirst({
      orderBy: { rankOrder: 'asc' },
    });

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: dto.email.toLowerCase(),
          username: dto.username,
          passwordHash,
          dateOfBirth: dob,
          stateOfRecord: state,
        },
      });

      await tx.wallet.createMany({
        data: [
          { userId: created.id, currency: 'GC' },
          { userId: created.id, currency: 'SC' },
        ],
      });

      await tx.responsiblePlayControls.create({ data: { userId: created.id } });
      await tx.notificationPreferences.create({
        data: { userId: created.id, preferences: {} },
      });

      if (baseVipLevel) {
        await tx.vipProgress.create({
          data: { userId: created.id, currentLevelId: baseVipLevel.id },
        });
      }

      await tx.analyticsEvent.create({
        data: { userId: created.id, eventName: 'signup_completed', properties: { state } },
      });

      return created;
    });

    return this.issueSession(user.id, user.email, user.username, meta);
  }

  async login(dto: LoginDto, meta: { ip?: string; userAgent?: string }) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    const genericError = () =>
      new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      });

    if (!user) throw genericError();

    const passwordOk = await argon2.verify(user.passwordHash, dto.password).catch(() => false);
    if (!passwordOk) {
      await this.prisma.loginEvent.create({
        data: { userId: user.id, ip: meta.ip, result: 'FAILED_PASSWORD' },
      });
      throw genericError();
    }

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException({
        code: 'ACCOUNT_NOT_ACTIVE',
        message: `Account status: ${user.status}.`,
      });
    }

    await this.prisma.loginEvent.create({
      data: { userId: user.id, ip: meta.ip, result: 'SUCCESS' },
    });

    return this.issueSession(user.id, user.email, user.username, meta);
  }

  async refresh(refreshToken: string) {
    const tokenHash = hashToken(refreshToken);
    const session = await this.prisma.session.findFirst({
      where: { refreshTokenHash: tokenHash },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      if (session && !session.revokedAt) {
        // Reuse of an already-expired-but-unrevoked token: revoke the whole family defensively.
        await this.prisma.session.updateMany({
          where: { userId: session.userId },
          data: { revokedAt: new Date() },
        });
      }
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or expired.',
      });
    }

    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: session.userId } });

    return this.issueSession(user.id, user.email, user.username, {
      ip: session.ip ?? undefined,
      userAgent: session.userAgent ?? undefined,
    });
  }

  async logout(refreshToken: string) {
    const tokenHash = hashToken(refreshToken);
    await this.prisma.session.updateMany({
      where: { refreshTokenHash: tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueSession(
    userId: string,
    email: string,
    username: string,
    meta: { ip?: string; userAgent?: string },
  ) {
    const accessToken = await this.jwtService.signAsync(
      { sub: userId, email, username },
      {
        secret: this.configService.get('jwt.accessSecret', { infer: true }),
        expiresIn: this.configService.get('jwt.accessTtl', { infer: true }),
      },
    );

    const refreshToken = randomBytes(48).toString('hex');
    const refreshTtlDays = this.configService.get('jwt.refreshTtlDays', { infer: true });
    const expiresAt = new Date(Date.now() + refreshTtlDays * 24 * 60 * 60 * 1000);

    await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: hashToken(refreshToken),
        ip: meta.ip,
        userAgent: meta.userAgent,
        expiresAt,
      },
    });

    return { accessToken, refreshToken, refreshTokenExpiresAt: expiresAt };
  }
}
