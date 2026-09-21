import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { PreferencesShape } from './notifications.constants';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query('unread') unread?: string) {
    const data = await this.notificationsService.list(user.userId);
    return {
      data,
      meta:
        unread !== undefined
          ? {
              note: '`unread` is accepted for forward compatibility but not yet enforced — see NotificationsService.list().',
            }
          : undefined,
    };
  }

  @Post(':id/read')
  async markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.notificationsService.markRead(user.userId, id) };
  }

  @Get('preferences')
  async getPreferences(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.notificationsService.getPreferences(user.userId) };
  }

  @Patch('preferences')
  async updatePreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return {
      data: await this.notificationsService.updatePreferences(user.userId, dto as PreferencesShape),
    };
  }
}
