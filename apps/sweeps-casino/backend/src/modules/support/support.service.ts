import { Injectable, NotFoundException } from '@nestjs/common';
import { SupportTicketStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FAQ_ENTRIES, FaqEntry } from './faq.data';

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  getFaq(): FaqEntry[] {
    return FAQ_ENTRIES;
  }

  // ─── User-facing ──────────────────────────────────────────────────────

  async createTicket(userId: string, subject: string, message: string) {
    const ticket = await this.prisma.$transaction(async (tx) => {
      const created = await tx.supportTicket.create({ data: { userId, subject } });
      await tx.supportMessage.create({
        data: { ticketId: created.id, authorUserId: userId, body: message },
      });
      return created;
    });
    return this.getTicketForUser(userId, ticket.id);
  }

  listTicketsForUser(userId: string) {
    return this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getTicketForUser(userId: string, ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!ticket || ticket.userId !== userId) {
      throw new NotFoundException({ code: 'TICKET_NOT_FOUND', message: 'Support ticket not found.' });
    }
    return ticket;
  }

  async addUserMessage(userId: string, ticketId: string, body: string) {
    // getTicketForUser enforces ownership (404s otherwise).
    await this.getTicketForUser(userId, ticketId);
    const [message] = await this.prisma.$transaction([
      this.prisma.supportMessage.create({ data: { ticketId, authorUserId: userId, body } }),
      this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: { status: 'PENDING_SUPPORT' },
      }),
    ]);
    return message;
  }

  // ─── Admin-facing ─────────────────────────────────────────────────────

  listTicketsForAdmin(filter: { status?: SupportTicketStatus }) {
    return this.prisma.supportTicket.findMany({
      where: filter.status ? { status: filter.status } : undefined,
      orderBy: { updatedAt: 'desc' },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
  }

  async getTicketForAdmin(ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!ticket) {
      throw new NotFoundException({ code: 'TICKET_NOT_FOUND', message: 'Support ticket not found.' });
    }
    return ticket;
  }

  async updateTicketForAdmin(
    ticketId: string,
    patch: { status?: SupportTicketStatus; assignedAdminId?: string | null },
  ) {
    await this.getTicketForAdmin(ticketId);

    if (patch.assignedAdminId) {
      const admin = await this.prisma.adminUser.findUnique({ where: { id: patch.assignedAdminId } });
      if (!admin) {
        throw new NotFoundException({ code: 'ADMIN_USER_NOT_FOUND', message: 'Admin user not found.' });
      }
    }

    return this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.assignedAdminId !== undefined ? { assignedAdminId: patch.assignedAdminId } : {}),
      },
    });
  }

  async addAdminMessage(adminId: string, ticketId: string, body: string) {
    await this.getTicketForAdmin(ticketId);
    const [message] = await this.prisma.$transaction([
      this.prisma.supportMessage.create({ data: { ticketId, authorAdminId: adminId, body } }),
      this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: { status: 'PENDING_USER' },
      }),
    ]);
    return message;
  }
}
