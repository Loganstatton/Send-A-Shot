import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const PAGE_SIZE = 50;

@Injectable()
export class AdminAuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filter: { actor?: string; target?: string; action?: string; cursor?: string }) {
    const entries = await this.prisma.auditLog.findMany({
      where: {
        ...(filter.actor ? { adminId: filter.actor } : {}),
        ...(filter.target ? { targetId: filter.target } : {}),
        ...(filter.action ? { action: filter.action } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });

    const hasMore = entries.length > PAGE_SIZE;
    const page = hasMore ? entries.slice(0, PAGE_SIZE) : entries;
    return { entries: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  }
}
