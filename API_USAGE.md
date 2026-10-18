# API Documentation — StealthHumanizer v2

## Endpoints

### POST `/api/humanize`

Humanize AI-generated text with configurable style, tone, and multi-pass processing.

#### Request

```json
{
  "text": "string (required) — Input text (max 10,000 words)",
  "level": "light | medium | aggressive | ninja (required)",
  "style": "academic | professional | casual | creative | technical (required)",
  "tone": "academic-formal | academic-casual | journalistic | ... (required)",
  "customTone": "string (optional) — Custom tone description",
  "model": "gemini | groq | openai | claude | ... (required)",
  "apiKey": "string (required) — Provider API key",
  "targetScore": "number (optional, default 80) — Target human score 50-100",
  "language": "string (optional, default 'auto') — Language code"
}
```

#### Response

```json
{
  "sentences": [
    {
      "original": "string",
      "humanized": "string",
      "alternatives": [],
      "index": 0,
      "detectionScore": 75
    }
  ],
  "fullText": "string — Complete humanized text",
  "model": "gemini",
  "modelName": "Google Gemini",
  "wordCount": { "input": 150, "output": 162 },
  "timestamp": 1711891200000,
  "passes": 2,
  "finalScore": 87,
  "options": { "level": "ninja", "style": "academic", "tone": "conversational" }
}
```

#### Errors

| Status | Error | Cause |
|--------|-------|-------|
| 400 | Missing required fields | text, model, or apiKey not provided |
| 400 | Exceeds 10,000 word limit | Input too long |
| 401 | API error | Invalid or expired API key |
| 429 | Rate limited | Provider rate limit exceeded |
| 500 | Internal error | Provider outage or unexpected error |

---

### POST `/api/alternative`

Get alternative rewrites for a specific sentence.

#### Request

```json
{
  "original": "string (required) — Original sentence",
  "current": "string (required) — Current humanized version",
  "level": "string (required)",
  "style": "string (required)",
  "tone": "string (required)",
  "model": "string (required)",
  "apiKey": "string (required)"
}
```

#### Response

```json
{
  "alternatives": [
    "First alternative sentence...",
    "Second alternative sentence...",
    "Third alternative sentence..."
  ]
}
```

---

## Provider Configuration

All providers use the same request format. Keys are passed from the client in each request (never stored server-side).

### Provider Endpoints

| Provider | Endpoint | Protocol |
|----------|----------|----------|
| Gemini | `generativelanguage.googleapis.com/v1beta` | Google AI REST |
| OpenAI | `api.openai.com/v1` | OpenAI API |
| Claude | `api.anthropic.com/v1` | Anthropic API |
| Groq | `api.groq.com/openai/v1` | OpenAI-compatible |
| Mistral | `api.mistral.ai/v1` | OpenAI-compatible |
| Cohere | `api.cohere.ai/v2` | Cohere Chat v2 |
| Together | `api.together.xyz/v1` | OpenAI-compatible |
| OpenRouter | `openrouter.ai/api/v1` | OpenAI-compatible |
| Cerebras | `api.cerebras.ai/v1` | OpenAI-compatible |
| DeepInfra | `api.deepinfra.com/v1/openai` | OpenAI-compatible |
| HuggingFace | `router.huggingface.co/v1` | OpenAI-compatible (Inference Providers) |
| Cloudflare | `api.cloudflare.com/client/v4/accounts/{id}/ai/v1` | OpenAI-compatible (Workers AI) |

### Adding a Custom Provider

Any OpenAI-compatible API can be used by modifying the provider list in `lib/providers.ts`:

```typescript
{
  id: 'my-provider',
  name: 'My Custom Provider',
  apiUrl: 'https://my-api.com/v1/chat/completions',
  defaultModel: 'my-model',
  models: ['my-model', 'my-model-v2'],
  // ... rest of config
}
```

Then add a case in the `generateWithProvider` function using the `openAICompatibleGenerate` helper.

---

## Rate Limiting

Rate limiting is handled by each provider. Approximate free tier limits:

| Provider | Free Limit | Notes |
|----------|-----------|-------|
| Gemini | 15 req/min, 1500/day | Most generous |
| Groq | 30 req/min | Ultra-fast |
| OpenRouter | Varies by model | Some models free |
| Together | 60 req/min | Free tier limited |
| Cerebras | 30 req/min | Fast inference |
| Mistral | 1 req/min (free) | Rate limited |
| Cohere | 10 req/min | Trial rate |

---

## Security Notes

- API keys are passed from the client in each request
- Keys are NOT stored on the server
- Keys are NOT logged
- All provider communication is over HTTPS
- No user data is persisted server-side
