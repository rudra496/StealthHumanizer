import { HumanizationResult } from '@/lib/types';

export type HumanizeStreamEvent =
  | { type: 'progress'; data: { step?: string; message?: string; chunk?: number; totalChunks?: number } }
  | { type: 'chunk'; data: { index: number; text: string } }
  | { type: 'result'; data: HumanizationResult & { success?: boolean } }
  | { type: 'error'; data: { error: string; status?: number } }
  | { type: 'done'; data: { ok: boolean } };

function parseSseBlocks(buffer: string): { blocks: string[]; remainder: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  return { blocks: parts.slice(0, -1), remainder: parts.at(-1) ?? '' };
}

function parseEventBlock(block: string): HumanizeStreamEvent | null {
  let type = 'message';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) type = line.slice(6).trim();
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  const data = JSON.parse(dataLines.join('\n'));
  if (type === 'progress' || type === 'chunk' || type === 'result' || type === 'error' || type === 'done') {
    return { type, data } as HumanizeStreamEvent;
  }
  return null;
}

export async function consumeHumanizeStream(
  response: Response,
  onEvent: (event: HumanizeStreamEvent) => void,
): Promise<HumanizationResult & { success?: boolean }> {
  if (!response.body) throw new Error('Streaming response body is not readable in this browser.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: (HumanizationResult & { success?: boolean }) | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const parsed = parseSseBlocks(buffer);
    buffer = parsed.remainder;
    for (const block of parsed.blocks) {
      const event = parseEventBlock(block);
      if (!event) continue;
      onEvent(event);
      if (event.type === 'error') throw new Error(event.data.error);
      if (event.type === 'result') finalResult = event.data;
    }
    if (done) break;
  }

  if (buffer.trim()) {
    const event = parseEventBlock(buffer);
    if (event) {
      onEvent(event);
      if (event.type === 'error') throw new Error(event.data.error);
      if (event.type === 'result') finalResult = event.data;
    }
  }

  if (!finalResult) throw new Error('Streaming response did not include a result event.');
  return finalResult;
}
