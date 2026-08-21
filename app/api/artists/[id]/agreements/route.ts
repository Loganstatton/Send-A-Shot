import { NextResponse } from 'next/server';
import { createAgreement, getAgreements, getArtist } from '@/lib/db';
import { getInternalUser } from '@/lib/auth';
import { AGREEMENT_TYPES, AgreementInput } from '@/lib/types';

export const dynamic = 'force-dynamic';

function parseId(idParam: string) {
  const id = Number(idParam);
  return Number.isInteger(id) ? id : null;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = parseId(params.id);
  if (id === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  if (!getArtist(id)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(getAgreements(id));
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = parseId(params.id);
  if (id === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  if (!getArtist(id)) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = (await req.json()) as AgreementInput;
  if (!body.type || !AGREEMENT_TYPES.includes(body.type)) {
    return NextResponse.json({ error: 'a valid type is required' }, { status: 400 });
  }
  const agreement = createAgreement(id, body, user);
  return NextResponse.json(agreement, { status: 201 });
}
