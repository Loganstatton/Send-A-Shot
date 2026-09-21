import { Injectable } from '@nestjs/common';
import { KycStatus } from '@prisma/client';
import { randomUUID } from 'crypto';

export interface KycSession {
  sessionId: string;
  status: KycStatus;
}

export interface KycWebhookResult {
  sessionId: string;
  status: KycStatus;
}

/**
 * Provider-abstraction interface per docs/01-architecture.md §5. A real
 * vendor (Persona, Onfido, Sumsub, etc.) implements this same interface and
 * is swapped in purely via the KYC_PROVIDER DI binding below.
 */
export interface KycProvider {
  startVerification(userId: string, payload: unknown): Promise<KycSession>;
  getStatus(sessionId: string): Promise<KycStatus>;
  handleWebhook(payload: unknown, signature: string): Promise<KycWebhookResult>;
}

export const KYC_PROVIDER = 'KYC_PROVIDER';

/**
 * MOCK ONLY — replace with a real vendor adapter before enabling any
 * compliance-gated KYC requirement. This mock auto-verifies every session
 * synchronously (no real identity check ever happens) and never calls out
 * to a network. `handleWebhook` is implemented for interface completeness
 * and to exercise the real signature-verification code path in
 * KycService.handleWebhook even though this mock has no async callback of
 * its own to deliver.
 */
@Injectable()
export class MockKycProvider implements KycProvider {
  private readonly sessionStatus = new Map<string, KycStatus>();

  async startVerification(_userId: string, _payload: unknown): Promise<KycSession> {
    const sessionId = `mock-kyc-${randomUUID()}`;
    this.sessionStatus.set(sessionId, 'VERIFIED');
    return { sessionId, status: 'VERIFIED' };
  }

  async getStatus(sessionId: string): Promise<KycStatus> {
    return this.sessionStatus.get(sessionId) ?? 'VERIFIED';
  }

  async handleWebhook(payload: unknown, _signature: string): Promise<KycWebhookResult> {
    const body = payload as { sessionId?: string; status?: KycStatus };
    return { sessionId: body.sessionId ?? '', status: body.status ?? 'VERIFIED' };
  }
}
