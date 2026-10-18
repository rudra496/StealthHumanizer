/** @type {import('next').NextConfig} */
// Optional sub-path deployment (e.g. self-hosted behind a reverse proxy at
// /humanizer/). Unset -> undefined -> app served at root (public Vercel app).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig = {
  reactStrictMode: true,
  ...(basePath ? { basePath } : {}),
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.googleapis.com https://*.openai.com https://api.anthropic.com https://api.groq.com https://openrouter.ai https://api.together.xyz https://api.cerebras.ai https://router.huggingface.co https://api.mistral.ai https://api.cohere.ai https://api.deepinfra.com https://api.cloudflare.com https://api.gptzero.me https://api.z.ai https://opencode.ai https://crof.ai https://global.ocenza.com https://token-plan-sgp.xiaomimimo.com https://integrate.api.nvidia.com https://api.kilo.ai https://inference-api.nousresearch.com https://api.perplexity.ai https://api.fireworks.ai https://api.openadapter.in https://www.codebuff.com https://api.commandcode.ai; img-src 'self' data: blob:; font-src 'self' https://fonts.gstatic.com; frame-ancestors 'none';",
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
}

module.exports = nextConfig
