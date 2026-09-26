import { Injectable } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';

export interface PaymentIntent {
  id: string;
  status: PaymentStatus;
}

export interface PaymentResult {
  id: string;
  status: PaymentStatus;
}

export interface RefundResult {
  id: string;
  status: PaymentStatus;
}

export interface CreatePaymentRequest {
  userId: string;
  amountUsd: string;
  gcPackageId: string;
  /** Used by the mock to derive a deterministic intent id — see MockPaymentProvider. */
  idempotencyKey: string;
}

export interface PaymentWebhookResult {
  providerPaymentRef: string;
  status: PaymentStatus;
}

/**
 * Provider-abstraction interface per docs/01-architecture.md §5. A real
 * processor (Stripe, etc.) implements this same interface and is swapped in
 * purely via the PAYMENT_PROVIDER DI binding below.
 */
export interface PaymentProvider {
  createPayment(req: CreatePaymentRequest): Promise<PaymentIntent>;
  confirmPayment(id: string): Promise<PaymentResult>;
  refundPayment(id: string, amount?: string): Promise<RefundResult>;
  handleWebhook(payload: unknown, signature: string): Promise<PaymentWebhookResult>;
  getPaymentStatus(id: string): Promise<PaymentStatus>;
}

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';

/**
 * MOCK ONLY — replace with a real payment processor adapter before enabling
 * `payments.purchases_enabled` anywhere real money is involved. No money
 * ever actually moves through this class.
 */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  async createPayment(req: CreatePaymentRequest): Promise<PaymentIntent> {
    // Deterministic: the same idempotencyKey always yields the same intent
    // id, so a retried checkout call converges on one provider-side intent
    // instead of creating duplicates — mirrors how real processors
    // (e.g. Stripe PaymentIntents) key off a client-supplied idempotency key.
    return { id: `mock-intent-${req.idempotencyKey}`, status: 'PENDING' };
  }

  async confirmPayment(id: string): Promise<PaymentResult> {
    // MOCK ONLY — a real integration confirms via redirect/webhook, not a
    // direct synchronous call like this.
    return { id, status: 'SUCCEEDED' };
  }

  async refundPayment(id: string, _amount?: string): Promise<RefundResult> {
    return { id, status: 'REFUNDED' };
  }

  async handleWebhook(payload: unknown, _signature: string): Promise<PaymentWebhookResult> {
    const body = payload as { providerPaymentRef?: string; status?: PaymentStatus };
    return { providerPaymentRef: body.providerPaymentRef ?? '', status: body.status ?? 'SUCCEEDED' };
  }

  async getPaymentStatus(_id: string): Promise<PaymentStatus> {
    return 'PENDING';
  }
}
