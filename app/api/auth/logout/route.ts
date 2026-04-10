import { NextResponse } from 'next/server';
import { getLogoutCookieOptions } from '@/lib/auth/session';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(getLogoutCookieOptions());
  return response;
}
