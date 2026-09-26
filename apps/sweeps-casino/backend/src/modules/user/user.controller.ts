import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateResponsiblePlayDto } from './dto/update-responsible-play.dto';
import { SelfExcludeDto } from './dto/self-exclude.dto';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.userService.getMe(user.userId) };
  }

  @Patch('profile')
  async updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return { data: await this.userService.updateProfile(user.userId, dto) };
  }

  @Post('password')
  async changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return { data: await this.userService.changePassword(user.userId, dto) };
  }

  @Get('responsible-play')
  async getResponsiblePlay(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.userService.getResponsiblePlay(user.userId) };
  }

  @Patch('responsible-play')
  async updateResponsiblePlay(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateResponsiblePlayDto,
  ) {
    return { data: await this.userService.updateResponsiblePlay(user.userId, dto) };
  }

  @Post('responsible-play/self-exclude')
  async selfExclude(@CurrentUser() user: AuthenticatedUser, @Body() dto: SelfExcludeDto) {
    return { data: await this.userService.selfExclude(user.userId, dto) };
  }

  @Post('responsible-play/close-account')
  async closeAccount(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.userService.closeAccount(user.userId) };
  }
}
