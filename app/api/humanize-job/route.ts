import { NextRequest, NextResponse } from 'next/server';
import { isRudraHumanizerConfigured } from '@/lib/server/rudra-free';

// Same-origin shuttle for the background-job humanization:
//   POST /api/humanize-job            -> Oracle /job/start   (returns {id} fast)
//   GET  /api/humanize-job?id=<job>   -> Oracle /job/status/{id}
// Browsers on some networks cannot reach the VPS domain directly (DNS /
// embedded-browser restrictions) and Vercel Hobby caps functions at 60s —
// polling keeps every hop a ~100ms same-origin call while the 80-100s
// best-of-4 sampling runs on the Oracle side uninterrupted.

const BASE = (process.env.RUDRA_API_BASE_URL || 'https://129-159-229-170.sslip.io').replace(/\/$/, '');
const KEY = (process.env.RUDRA_HUMANIZER_API_KEY || '').trim();
const UPSTREAM_TIMEOUT = 20_000;

async function shuttle(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT);
  try {
    return await fetch(`${BASE}/api/job/${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${KEY}`,
        'User-Agent': 'stealthhumanizer-shuttle/1.0',
      },
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: NextRequest) {
  if (!isRudraHumanizerConfigured()) {
    return NextResponse.json({ success: false, error: 'Rudra Free model is not configured on the server.' }, { status: 500 });
  }
  try {
    const body = await request.json();
    const text = typeof body?.text === 'string' ? body.text : '';
    if (!text.trim()) {
      return NextResponse.json({ success: false, error: 'text is required' }, { status: 400 });
    }
    const upstream = await shuttle('start', {
      method: 'POST',
      body: JSON.stringify({
        text: text.slice(0, 32000),
        temperature: typeof body.temperature === 'number' ? body.temperature : 0.85,
        samples: 3,
      }),
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok || !data?.id) {
      return NextResponse.json({ success: false, error: `Upstream ${upstream.status}: ${JSON.stringify(data).slice(0, 150)}` }, { status: 502 });
    }
    return NextResponse.json({ success: true, id: data.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  if (!isRudraHumanizerConfigured()) {
    return NextResponse.json({ success: false, error: 'Rudra Free model is not configured on the server.' }, { status: 500 });
  }
  const id = request.nextUrl.searchParams.get('id') || '';
  if (!/^[a-f0-9]{6,32}$/.test(id)) {
    return NextResponse.json({ success: false, error: 'invalid job id' }, { status: 400 });
  }
  try {
    const upstream = await shuttle(`status/${id}`);
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return NextResponse.json({ success: false, error: `Upstream ${upstream.status}` }, { status: 502 });
    }
    return NextResponse.json({ success: true, ...data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
