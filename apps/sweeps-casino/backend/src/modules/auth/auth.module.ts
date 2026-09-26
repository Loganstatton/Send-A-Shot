import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Module({
  // global: true — JwtService must be resolvable from every module that uses
  // JwtAuthGuard (nearly all of them), not just modules that import AuthModule.
  imports: [JwtModule.register({ global: true })],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
