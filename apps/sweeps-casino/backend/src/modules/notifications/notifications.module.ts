import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  // NotificationsService.dispatch() is the intended cross-module entry
  // point for other domains (promotions, VIP, KYC, redemptions, ...) to
  // send a notification without touching `notifications` directly.
  exports: [NotificationsService],
})
export class NotificationsModule {}
