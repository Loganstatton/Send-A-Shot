import { NextResponse } from 'next/server';
import { deleteAgreement, updateAgreement } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { AgreementInput } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string; agreementId: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const artistId = Number(params.id);
  const agreementId = Number(params.agreementId);
  if (!Number.isInteger(artistId) || !Number.isInteger(agreementId)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const body = (await req.json()) as AgreementInput;
  const agreement = updateAgreement(artistId, agreementId, body);
  if (!agreement) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(agreement);
}

export async function DELETE(_req: Request, { params }: { params: { id: string; agreementId: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const artistId = Number(params.id);
  const agreementId = Number(params.agreementId);
  if (!Number.isInteger(artistId) || !Number.isInteger(agreementId)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const ok = deleteAgreement(artistId, agreementId);
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
