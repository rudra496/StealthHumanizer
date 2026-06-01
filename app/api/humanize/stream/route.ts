import { NextRequest } from 'next/server';
import { POST as humanizePost } from '../route';

const encoder = new TextEncoder();

function event(name: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(event('progress', { step: 'accepted', message: 'Request accepted' }));
      try {
        const forwarded = new NextRequest(request.url.replace('/stream', ''), {
          method: 'POST',
          headers: request.headers,
          body,
        });
        controller.enqueue(event('progress', { step: 'rewrite', message: 'Humanization pipeline running' }));
        const response = await humanizePost(forwarded);
        const payload = await response.json();
        if (!response.ok || !payload.success) {
          controller.enqueue(event('error', { error: payload.error || 'Humanization failed' }));
        } else {
          controller.enqueue(event('result', payload));
        }
      } catch (error) {
        controller.enqueue(event('error', { error: error instanceof Error ? error.message : 'Stream failed' }));
      } finally {
        controller.enqueue(event('done', { ok: true }));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
