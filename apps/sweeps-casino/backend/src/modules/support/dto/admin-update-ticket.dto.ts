import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { SupportTicketStatus } from '@prisma/client';

const STATUSES: SupportTicketStatus[] = ['OPEN', 'PENDING_USER', 'PENDING_SUPPORT', 'RESOLVED', 'CLOSED'];

export class AdminUpdateTicketDto {
  @IsOptional()
  @IsIn(STATUSES)
  status?: SupportTicketStatus;

  /** Pass null to unassign. */
  @IsOptional()
  @IsUUID()
  assignedAdminId?: string | null;
}
