import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { SupportService } from './support.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { CreateMessageDto } from './dto/create-message.dto';

@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get('faq')
  getFaq() {
    return { data: this.supportService.getFaq() };
  }

  @Post('tickets')
  @UseGuards(JwtAuthGuard)
  async createTicket(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTicketDto) {
    return { data: await this.supportService.createTicket(user.userId, dto.subject, dto.message) };
  }

  @Get('tickets')
  @UseGuards(JwtAuthGuard)
  async listTickets(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.supportService.listTicketsForUser(user.userId) };
  }

  @Get('tickets/:id')
  @UseGuards(JwtAuthGuard)
  async getTicket(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.supportService.getTicketForUser(user.userId, id) };
  }

  @Post('tickets/:id/messages')
  @UseGuards(JwtAuthGuard)
  async addMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateMessageDto,
  ) {
    return { data: await this.supportService.addUserMessage(user.userId, id, dto.body) };
  }
}
