import { NextRequest, NextResponse } from 'next/server';
import { POST as humanizePost } from '../../humanize/route';
import { logRequestError, parseJsonBody, validationError, v1HumanizeSchema } from '@/lib/validation';

function buildForwardedHeaders(request: NextRequest): Headers {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const name of ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'x-vercel-forwarded-for']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

export async function POST(request: NextRequest) {
  const parsedRequest = await parseJsonBody(request, v1HumanizeSchema);
  if (!parsedRequest.ok) {
    logRequestError(parsedRequest.requestId, parsedRequest.code, parsedRequest.message);
    return NextResponse.json(validationError(parsedRequest.code, parsedRequest.message, parsedRequest.requestId), { status: parsedRequest.status });
  }
  const requestId = parsedRequest.requestId;
  const payload = parsedRequest.data;
  try {
  const configuredToken = process.env.STEALTHHUMANIZER_API_TOKEN;
  const supplied = request.headers.get('x-api-key') || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!configuredToken || supplied !== configuredToken) {
    logRequestError(requestId, 'unauthorized', 'Invalid API token.');
    return NextResponse.json(validationError('unauthorized', 'Invalid API token.', requestId), { status: 401 });
  }
  const payloadApiKey = payload.apiKey;
  const payloadModel = payload.model;
  const providerApiKey = payloadApiKey || process.env.STEALTHHUMANIZER_PROVIDER_API_KEY || process.env.GEMINI_API_KEY;
  const provider = payloadModel || process.env.STEALTHHUMANIZER_PROVIDER || 'gemini';
  if (!providerApiKey) {
    return NextResponse.json(validationError('invalid_input', 'No provider API key supplied. Pass apiKey or configure STEALTHHUMANIZER_PROVIDER_API_KEY.', requestId), { status: 400 });
  }

  const forwarded = new NextRequest(request.url.replace('/api/v1/humanize', '/api/humanize'), {
    method: 'POST',
    headers: buildForwardedHeaders(request),
    body: JSON.stringify({
      style: 'humanize',
      tone: 'conversational',
      language: 'auto',
      ...payload,
      model: provider,
      apiKey: providerApiKey,
    }),
  });
  return humanizePost(forwarded);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    logRequestError(requestId, 'internal', message);
    return NextResponse.json(validationError('internal', process.env.NODE_ENV === 'development' ? message : 'Internal error', requestId), { status: 500 });
  }
}
