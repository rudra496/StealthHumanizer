/**
 * Input validation helpers for API routes.
 */

import { z, type ZodType } from 'zod';

export type ValidationErrorCode =
  | 'invalid_input'
  | 'too_large'
  | 'unauthorized'
  | 'rate_limited'
  | 'internal';

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHARS, '');
}

const textWithControlCharsStripped = (maxLength: number) =>
  z.string()
    .transform(stripControlChars)
    .pipe(z.string().refine((value) => value.trim().length > 0, 'Text must not be empty or whitespace-only'))
    .pipe(z.string().max(maxLength, `Text exceeds ${maxLength.toLocaleString()} character limit`));

const optionalModel = z.string().min(1).max(64).optional();
const optionalTemperature = z.number().min(0).max(2).optional();
const optionalIntensity = z.string().max(32).optional();
const optionalTone = z.string().max(64).optional();
const optionalMode = z.string().max(32).optional();
const optionalSamples = z.number().int().min(1).max(4).optional();

export const humanizeSchema = z.object({
  text: textWithControlCharsStripped(32000),
  model: optionalModel,
  temperature: optionalTemperature,
  intensity: optionalIntensity,
  style: optionalIntensity,
  tone: optionalTone,
  mode: optionalMode,
  samples: optionalSamples,
  engine: z.string().max(32).optional(),
  apiKey: z.string().optional(),
  targetScore: z.number().optional(),
  language: z.string().optional(),
  writingSample: z.string().optional(),
  postprocess: z.boolean().optional(),
  chainModels: z.array(z.string()).optional(),
  apiKeys: z.record(z.string(), z.string()).optional(),
  batchTexts: z.array(z.string()).optional(),
  freezeWords: z.string().optional(),
  synonymIntensity: z.number().optional(),
}).strict();

export const humanizeJobSchema = z.object({
  text: textWithControlCharsStripped(32000),
  temperature: optionalTemperature,
  samples: optionalSamples,
  engine: z.string().max(32).optional(),
}).strict();

export const grammarSchema = z.object({
  text: textWithControlCharsStripped(15000),
  model: optionalModel,
  apiKey: z.string().optional(),
}).strict();

export const detectSchema = z.object({
  text: textWithControlCharsStripped(20000),
}).strict();

export const v1HumanizeSchema = z.object({
  text: textWithControlCharsStripped(32000),
  model: optionalModel,
  temperature: optionalTemperature,
  intensity: optionalIntensity,
  style: optionalIntensity,
  tone: optionalTone,
  mode: optionalMode,
  samples: optionalSamples,
  apiKey: z.string().min(8).max(256),
}).strict();

export function validationError(code: ValidationErrorCode, message: string, requestId: string) {
  return {
    success: false,
    error: message,
    code,
    requestId,
  };
}

export function createRequestId(): string {
  return crypto.randomUUID();
}

export function logRequestError(requestId: string, code: ValidationErrorCode, message: string): void {
  console.error(JSON.stringify({ requestId, code, error: message }));
}

export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<
  | { ok: true; data: T; requestId: string }
  | { ok: false; status: 400 | 413 | 415; code: ValidationErrorCode; message: string; requestId: string }
> {
  const requestId = createRequestId();
  const contentType = request.headers.get('content-type') || '';
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return { ok: false, status: 415, code: 'invalid_input', message: 'Content-Type must be application/json', requestId };
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > 64 * 1024) {
    return { ok: false, status: 413, code: 'too_large', message: 'Request body exceeds 64KB', requestId };
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, status: 400, code: 'invalid_input', message: 'Malformed JSON body', requestId };
  }
  if (new TextEncoder().encode(raw).byteLength > 64 * 1024) {
    return { ok: false, status: 413, code: 'too_large', message: 'Request body exceeds 64KB', requestId };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, code: 'invalid_input', message: 'Malformed JSON body', requestId };
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      status: 400,
      code: 'invalid_input',
      message: issue?.message || 'Invalid request body',
      requestId,
    };
  }
  return { ok: true, data: parsed.data, requestId };
}

export function validateString(value: unknown, fieldName: string, maxLength?: number): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return `${fieldName} must be a non-empty string`;
  }
  if (maxLength && value.length > maxLength) {
    return `${fieldName} exceeds maximum length of ${maxLength} characters`;
  }
  return null;
}

export function validateModel(model: unknown): string | null {
  const validModels = [
    'gemini', 'openai', 'claude', 'groq', 'mistral', 'cohere',
    'together', 'openrouter', 'cerebras', 'deepinfra', 'huggingface',
    'cloudflare', 'zai', 'codebuff', 'command-code',
    'opencode-zen', 'opencode-go', 'crof', 'ocenza',
    'mimo', 'nvidia-nim', 'kilo-gateway', 'nous-research',
    'perplexity', 'fireworks', 'openadapter', 'zai-coding',
    'google-gemini-oauth', 'ollama', 'lm-studio',
    'vllm', 'opencode-zen-anthropic', 'opencode-go-anthropic',
  ];
  if (typeof model !== 'string' || !validModels.includes(model)) {
    return 'Invalid model provider';
  }
  return null;
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
