import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PaymentStatus, PaymentType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { PAYMENT_PROVIDER, PaymentProvider } from './providers/payment.provider';
import { CheckoutDto } from './dto/checkout.dto';
import { verifyHmacSignature } from './webhook-signature.util';

const MOCK_PROVIDER_ID = 'mock';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
  ) {}

  async listPackages() {
    return this.prisma.gcPackage.findMany({ where: { active: true }, orderBy: { priceUsd: 'asc' } });
  }

  async checkout(userId: string, dto: CheckoutDto, idempotencyKey: string) {
    const pkg = await this.prisma.gcPackage.findUnique({ where: { id: dto.gcPackageId } });
    if (!pkg || !pkg.active) {
      throw new NotFoundException({ code: 'PACKAGE_NOT_FOUND', message: 'GC package not found or inactive.' });
    }

    if (dto.paymentMethodId) {
      const method = await this.prisma.paymentMethod.findFirst({
        where: { id: dto.paymentMethodId, userId, status: 'ACTIVE' },
      });
      if (!method) {
        throw new BadRequestException({
          code: 'INVALID_PAYMENT_METHOD',
          message: 'Payment method not found or inactive.',
        });
      }
    }

    const intent = await this.paymentProvider.createPayment({
      userId,
      amountUsd: pkg.priceUsd.toString(),
      gcPackageId: pkg.id,
      idempotencyKey,
    });

    try {
      return await this.prisma.payment.create({
        data: {
          userId,
          paymentMethodId: dto.paymentMethodId,
          providerId: MOCK_PROVIDER_ID,
          providerPaymentRef: intent.id,
          type: 'PURCHASE',
          gcPackageId: pkg.id,
          amountUsd: pkg.priceUsd,
          status: 'PENDING',
        },
      });
    } catch (err) {
      // (providerId, providerPaymentRef) is unique — a retried checkout
      // with the same Idempotency-Key produces the same deterministic
      // intent id, so this collision means "already created," not an error.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.prisma.payment.findUnique({
          where: {
            providerId_providerPaymentRef: { providerId: MOCK_PROVIDER_ID, providerPaymentRef: intent.id },
          },
        });
        if (existing) return existing;
      }
      throw err;
    }
  }

  async history(userId: string) {
    return this.prisma.payment.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  /**
   * Always reachable regardless of payments.purchases_enabled — see
   * PaymentsWebhookController. Idempotent via the (providerId,
   * providerPaymentRef) unique constraint: a retried delivery for a payment
   * already in the reported status is a no-op.
   */
  async handleWebhook(providerId: string, rawBody: Buffer | undefined, signature: string | undefined) {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (!verifyHmacSignature(rawBody, signature, secret)) {
      throw new UnauthorizedException({
        code: 'INVALID_WEBHOOK_SIGNATURE',
        message: 'Missing or invalid webhook signature.',
      });
    }

    let payload: { providerPaymentRef?: string; status?: string };
    try {
      payload = JSON.parse((rawBody as Buffer).toString('utf8'));
    } catch {
      throw new BadRequestException({ code: 'INVALID_WEBHOOK_PAYLOAD', message: 'Payload is not valid JSON.' });
    }

    const result = await this.paymentProvider.handleWebhook(payload, signature ?? '');
    if (!result.providerPaymentRef) {
      throw new BadRequestException({
        code: 'INVALID_WEBHOOK_PAYLOAD',
        message: 'Missing providerPaymentRef in webhook payload.',
      });
    }

    const payment = await this.prisma.payment.findUnique({
      where: { providerId_providerPaymentRef: { providerId, providerPaymentRef: result.providerPaymentRef } },
      include: { gcPackage: true },
    });
    if (!payment) {
      throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'No payment found for this provider reference.' });
    }

    if (payment.status === result.status) {
      return payment;
    }

    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: result.status,
        settledAt: result.status === 'SUCCEEDED' ? new Date() : payment.settledAt,
      },
    });

    if (result.status === 'SUCCEEDED' && payment.gcPackage) {
      await this.walletService.postEntries(payment.userId, 'GC', [
        {
          type: 'PURCHASE',
          amount: payment.gcPackage.gcAmount.toString(),
          source: 'PAYMENT',
          // WalletService's own (walletId, idempotencyKey) uniqueness is a
          // second line of defense against double-crediting even if this
          // handler somehow re-runs past the status-equality check above.
          idempotencyKey: `payment:${payment.id}`,
          paymentId: payment.id,
          metadata: { providerId, providerPaymentRef: result.providerPaymentRef },
        },
      ]);
    }

    return updated;
  }

  async adminList(filters: { status?: PaymentStatus; type?: PaymentType; userId?: string }) {
    return this.prisma.payment.findMany({
      where: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.userId ? { userId: filters.userId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
