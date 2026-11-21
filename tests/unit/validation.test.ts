import { describe, expect, it } from 'vitest';
import {
  createRequestId,
  detectSchema,
  grammarSchema,
  humanizeJobSchema,
  humanizeSchema,
  stripControlChars,
  validationError,
  v1HumanizeSchema,
} from '../../lib/validation';

describe('Zod request validation', () => {
  it('accepts a valid humanize payload', () => {
    expect(humanizeSchema.safeParse({ text: 'Hello', model: 'gemini', temperature: 1, samples: 2 }).success).toBe(true);
  });
  it('rejects humanize text 32001 chars', () => {
    expect(humanizeSchema.safeParse({ text: 'a'.repeat(32001) }).success).toBe(false);
  });
  it('accepts humanize text 32000 chars', () => {
    expect(humanizeSchema.safeParse({ text: 'a'.repeat(32000) }).success).toBe(true);
  });
  it('rejects empty humanize text', () => {
    expect(humanizeSchema.safeParse({ text: '' }).success).toBe(false);
  });
  it('rejects whitespace-only humanize text', () => {
    expect(humanizeSchema.safeParse({ text: '   \n\t' }).success).toBe(false);
  });
  it('rejects null humanize text', () => {
    expect(humanizeSchema.safeParse({ text: null }).success).toBe(false);
  });
  it('rejects missing humanize text', () => {
    expect(humanizeSchema.safeParse({}).success).toBe(false);
  });
  it('rejects wrong humanize text type', () => {
    expect(humanizeSchema.safeParse({ text: 42 }).success).toBe(false);
  });
  it('rejects humanize unknown keys', () => {
    expect(humanizeSchema.safeParse({ text: 'Hello', unexpected: true }).success).toBe(false);
  });
  it('strips prohibited control characters but preserves newline and tab', () => {
    expect(stripControlChars('A\u0000B\nC\tD\u0007')).toBe('AB\nC\tD');
  });
  it('applies control-character stripping in a schema', () => {
    const result = humanizeSchema.parse({ text: 'A\u0000B\u0007\nC\tD' });
    expect(result.text).toBe('AB\nC\tD');
  });
  it('rejects humanize temperature above 2', () => {
    expect(humanizeSchema.safeParse({ text: 'Hello', temperature: 2.1 }).success).toBe(false);
  });
  it('accepts humanize temperature boundaries', () => {
    expect(humanizeSchema.safeParse({ text: 'Hello', temperature: 0 }).success).toBe(true);
    expect(humanizeSchema.safeParse({ text: 'Hello', temperature: 2 }).success).toBe(true);
  });
  it('rejects humanize samples 0', () => {
    expect(humanizeSchema.safeParse({ text: 'Hello', samples: 0 }).success).toBe(false);
  });
  it('accepts humanize samples 1', () => {
    expect(humanizeSchema.safeParse({ text: 'Hello', samples: 1 }).success).toBe(true);
  });
  it('rejects humanize samples 5', () => {
    expect(humanizeSchema.safeParse({ text: 'Hello', samples: 5 }).success).toBe(false);
  });
  it('rejects samples as a float', () => {
    expect(humanizeSchema.safeParse({ text: 'Hello', samples: 1.5 }).success).toBe(false);
  });
  it('accepts valid humanize-job payload and rejects unknown keys', () => {
    expect(humanizeJobSchema.safeParse({ text: 'Hello', temperature: 0.8, samples: 2 }).success).toBe(true);
    expect(humanizeJobSchema.safeParse({ text: 'Hello', mode: 'fast' }).success).toBe(false);
  });
  it('accepts 32000-char humanize-job text', () => {
    expect(humanizeJobSchema.safeParse({ text: 'x'.repeat(32000) }).success).toBe(true);
  });
  it('accepts grammar text at 15000 chars', () => {
    expect(grammarSchema.safeParse({ text: 'g'.repeat(15000) }).success).toBe(true);
  });
  it('rejects grammar text at 15001 chars and empty text', () => {
    expect(grammarSchema.safeParse({ text: 'g'.repeat(15001) }).success).toBe(false);
    expect(grammarSchema.safeParse({ text: '' }).success).toBe(false);
  });
  it('strips control chars from grammar text', () => {
    expect(grammarSchema.parse({ text: 'A\u0001B\nC\tD' }).text).toBe('AB\nC\tD');
  });
  it('accepts detect text and rejects over 20000 chars', () => {
    expect(detectSchema.safeParse({ text: 'd'.repeat(20000) }).success).toBe(true);
    expect(detectSchema.safeParse({ text: 'd'.repeat(20001) }).success).toBe(false);
  });
  it('requires a valid v1 apiKey length', () => {
    expect(v1HumanizeSchema.safeParse({ text: 'Hello', apiKey: '12345678' }).success).toBe(true);
    expect(v1HumanizeSchema.safeParse({ text: 'Hello', apiKey: 'short' }).success).toBe(false);
  });
  it('returns the uniform error-helper shape', () => {
    expect(validationError('invalid_input', 'Bad input', 'request-1')).toEqual({
      success: false,
      error: 'Bad input',
      code: 'invalid_input',
      requestId: 'request-1',
    });
  });
  it('creates UUID-format request IDs', () => {
    expect(createRequestId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});
