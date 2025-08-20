import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rows = db.prepare('SELECT * FROM products ORDER BY id').all();
  return NextResponse.json(rows);
}
