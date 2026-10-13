import { NextResponse } from 'next/server';
import { seedDemoData } from '@/lib/server/seed';

export async function POST() {
  try {
    const result = await seedDemoData();
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to seed database';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
