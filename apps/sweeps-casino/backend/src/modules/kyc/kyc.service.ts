import { BadRequestException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { KycDocumentType } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { KYC_PROVIDER, KycProvider } from './providers/kyc.provider';
import { KycDecisionDto } from './dto/kyc-decision.dto';
import { verifyHmacSignature } from './webhook-signature.util';

const DECISION_TO_STATUS = {
  approve: 'VERIFIED',
  reject: 'REJECTED',
  'review-required': 'REVIEW_REQUIRED',
} as const;

@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(KYC_PROVIDER) private readonly kycProvider: KycProvider,
  ) {}

  async getStatus(userId: string) {
    const [user, record] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { kycStatus: true } }),
      this.prisma.kycRecord.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    ]);

    return {
      kycStatus: user?.kycStatus ?? 'UNVERIFIED',
      record,
    };
  }

  async start(userId: string) {
    const record = await this.prisma.kycRecord.create({
      data: { userId, status: 'PENDING', provider: 'mock' },
    });

    const session = await this.kycProvider.startVerification(userId, {});

    const updated = await this.prisma.$transaction(async (tx) => {
      const rec = await tx.kycRecord.update({
        where: { id: record.id },
        data: {
          status: session.status,
          providerSessionRef: session.sessionId,
          level: session.status === 'VERIFIED' ? 'BASIC' : 'NONE',
        },
      });
      await tx.user.update({ where: { id: userId }, data: { kycStatus: session.status } });
      return rec;
    });

    return updated;
  }

  async addDocument(userId: string, type: KycDocumentType, file: Express.Multer.File | undefined) {
    if (!file) {
      throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'A file is required.' });
    }

    let record = await this.prisma.kycRecord.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    if (!record) {
      record = await this.prisma.kycRecord.create({ data: { userId, status: 'PENDING' } });
      await this.prisma.user.update({ where: { id: userId }, data: { kycStatus: 'PENDING' } });
    }

    // TODO(real-vendor-integration): stream `file.buffer` to S3-compatible
    // object storage (see docs/01-architecture.md §2) and store the
    // resulting object key here instead. This mock never persists file
    // bytes anywhere durable — storageKey is a fake reference only.
    const storageKey = `mock/${randomUUID()}`;

    return this.prisma.kycDocument.create({
      data: { kycRecordId: record.id, type, storageKey },
    });
  }

  /** Idempotent on providerSessionRef — a retried webhook delivery for an already-applied status is a no-op. */
  async handleWebhook(_providerId: string, rawBody: Buffer | undefined, signature: string | undefined) {
    const secret = process.env.KYC_WEBHOOK_SECRET;
    if (!verifyHmacSignature(rawBody, signature, secret)) {
      throw new UnauthorizedException({
        code: 'INVALID_WEBHOOK_SIGNATURE',
        message: 'Missing or invalid webhook signature.',
      });
    }

    let payload: { sessionId?: string; status?: string };
    try {
      payload = JSON.parse((rawBody as Buffer).toString('utf8'));
    } catch {
      throw new BadRequestException({ code: 'INVALID_WEBHOOK_PAYLOAD', message: 'Payload is not valid JSON.' });
    }

    const result = await this.kycProvider.handleWebhook(payload, signature ?? '');
    if (!result.sessionId) {
      throw new BadRequestException({ code: 'INVALID_WEBHOOK_PAYLOAD', message: 'Missing sessionId in webhook payload.' });
    }

    const record = await this.prisma.kycRecord.findFirst({ where: { providerSessionRef: result.sessionId } });
    if (!record) {
      throw new NotFoundException({ code: 'KYC_RECORD_NOT_FOUND', message: 'No KYC record for this session.' });
    }

    if (record.status === result.status) {
      return record;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const rec = await tx.kycRecord.update({ where: { id: record.id }, data: { status: result.status } });
      await tx.user.update({ where: { id: record.userId }, data: { kycStatus: result.status } });
      return rec;
    });

    return updated;
  }

  async getQueue() {
    return this.prisma.kycRecord.findMany({
      where: { status: { in: ['PENDING', 'REVIEW_REQUIRED'] } },
      orderBy: { createdAt: 'asc' },
      include: { documents: true },
    });
  }

  async decide(recordId: string, dto: KycDecisionDto, adminId: string) {
    const record = await this.prisma.kycRecord.findUnique({ where: { id: recordId } });
    if (!record) {
      throw new NotFoundException({ code: 'KYC_RECORD_NOT_FOUND', message: 'KYC record not found.' });
    }

    const newStatus = DECISION_TO_STATUS[dto.decision];

    return this.prisma.$transaction(async (tx) => {
      const rec = await tx.kycRecord.update({
        where: { id: recordId },
        data: {
          status: newStatus,
          reviewedBy: adminId,
          rejectionReason: dto.decision === 'reject' ? dto.reason : null,
        },
      });

      await tx.user.update({ where: { id: rec.userId }, data: { kycStatus: newStatus } });

      await tx.auditLog.create({
        data: {
          adminId,
          action: 'kyc.decision',
          targetType: 'kyc_record',
          targetId: recordId,
          oldState: { status: record.status } as object,
          newState: { status: newStatus, decision: dto.decision } as object,
          reason: dto.reason,
        },
      });

      return rec;
    });
  }

  async getSignedUrl(recordId: string, docId: string) {
    const doc = await this.prisma.kycDocument.findFirst({ where: { id: docId, kycRecordId: recordId } });
    if (!doc) {
      throw new NotFoundException({ code: 'KYC_DOCUMENT_NOT_FOUND', message: 'Document not found.' });
    }

    // MOCK ONLY — a real implementation issues a short-lived S3 presigned
    // GET URL scoped to `doc.storageKey` via the object-storage SDK.
    // kyc_documents.storage_key is never served as a public URL directly
    // (see docs/02-database-schema.md §KYC).
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    return { url: `https://mock-storage.local/${doc.storageKey}`, expiresAt };
  }
}
