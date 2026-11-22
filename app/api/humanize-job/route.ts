import { NextRequest, NextResponse } from 'next/server';
import { isRudraHumanizerConfigured, rudraFetch } from '@/lib/server/rudra-free';
import { humanizeJobSchema, logRequestError, parseJsonBody, validationError } from '@/lib/validation';

// Same-origin shuttle for the background-job humanization:
//   POST /api/humanize-job            -> Oracle /job/start   (returns {id} fast)
//   GET  /api/humanize-job?id=<job>   -> Oracle /job/status/{id}
// Browsers on some networks cannot reach the VPS domain directly (DNS /
// embedded-browser restrictions) and Vercel Hobby caps functions at 60s —
// polling keeps every hop a ~100ms same-origin call while the 60-100s
// best-of-2 sampling runs on the Oracle side uninterrupted.
// The VPS is reached through a Cloudflare quick tunnel whose URL can rotate —
// rudraFetch resolves the current URL and self-heals via the broker on failure.

const KEY = (process.env.RUDRA_HUMANIZER_API_KEY || '').trim();
const UPSTREAM_TIMEOUT = 20_000;

async function shuttle(path: string, init?: RequestInit): Promise<Response> {
  return rudraFetch(`/api/job/${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${KEY}`,
      'User-Agent': 'stealthhumanizer-shuttle/1.0',
    },
  }, UPSTREAM_TIMEOUT);
}

export async function POST(request: NextRequest) {
  const parsedRequest = await parseJsonBody(request, humanizeJobSchema);
  if (!parsedRequest.ok) {
    logRequestError(parsedRequest.requestId, parsedRequest.code, parsedRequest.message);
    return NextResponse.json(validationError(parsedRequest.code, parsedRequest.message, parsedRequest.requestId), { status: parsedRequest.status });
  }
  const requestId = parsedRequest.requestId;
  if (!isRudraHumanizerConfigured()) {
    logRequestError(requestId, 'internal', 'Rudra Free model is not configured on the server.');
    return NextResponse.json(validationError('internal', 'Rudra Free model is not configured on the server.', requestId), { status: 500 });
  }
  try {
    const body = parsedRequest.data;
    const text = body.text;
    const upstream = await shuttle('start', {
      method: 'POST',
      body: JSON.stringify({
        text,
        temperature: body.temperature ?? 0.85,
        samples: body.samples ?? 2,
        engine: body.engine || '',
        style: body.style || (body.engine && body.engine !== 'human-corpus' ? body.engine : 'professional'),
      }),
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok || !data?.id) {
      return NextResponse.json(validationError('internal', `Upstream ${upstream.status}: ${JSON.stringify(data).slice(0, 150)}`, requestId), { status: 502 });
    }
    return NextResponse.json({ success: true, id: data.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    logRequestError(requestId, 'internal', message);
    return NextResponse.json(validationError('internal', message, requestId), { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  if (!isRudraHumanizerConfigured()) {
    logRequestError(requestId, 'internal', 'Rudra Free model is not configured on the server.');
    return NextResponse.json(validationError('internal', 'Rudra Free model is not configured on the server.', requestId), { status: 500 });
  }
  const id = request.nextUrl.searchParams.get('id') || '';
  if (!/^[a-f0-9]{6,32}$/.test(id)) {
    return NextResponse.json(validationError('invalid_input', 'invalid job id', requestId), { status: 400 });
  }
  try {
    const upstream = await shuttle(`status/${id}`);
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return NextResponse.json(validationError('internal', `Upstream ${upstream.status}`, requestId), { status: 502 });
    }
    return NextResponse.json({ success: true, ...data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    logRequestError(requestId, 'internal', message);
    return NextResponse.json(validationError('internal', message, requestId), { status: 500 });
  }
}
