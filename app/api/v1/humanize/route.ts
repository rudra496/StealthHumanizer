import { NextRequest, NextResponse } from 'next/server';
import { POST as humanizePost } from '../../humanize/route';

export async function POST(request: NextRequest) {
  const configuredToken = process.env.STEALTHHUMANIZER_API_TOKEN;
  if (configuredToken) {
    const supplied = request.headers.get('x-api-key') || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (supplied !== configuredToken) {
      return NextResponse.json({ success: false, error: 'Invalid API token.' }, { status: 401 });
    }
  }

  const payload = await request.json();
  const providerApiKey = payload.apiKey || process.env.STEALTHHUMANIZER_PROVIDER_API_KEY || process.env.GEMINI_API_KEY;
  const provider = payload.model || process.env.STEALTHHUMANIZER_PROVIDER || 'gemini';
  if (!providerApiKey) {
    return NextResponse.json({ success: false, error: 'No provider API key supplied. Pass apiKey or configure STEALTHHUMANIZER_PROVIDER_API_KEY.' }, { status: 400 });
  }

  const forwarded = new NextRequest(request.url.replace('/api/v1/humanize', '/api/humanize'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      level: 'medium',
      style: 'humanize',
      tone: 'conversational',
      language: 'auto',
      ...payload,
      model: provider,
      apiKey: providerApiKey,
    }),
  });
  return humanizePost(forwarded);
}
