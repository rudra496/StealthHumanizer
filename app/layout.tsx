import type { Metadata } from 'next';
import './globals.css';

const SITE_URL = 'https://stealthhumanizer.vercel.app';

export const metadata: Metadata = {
  verification: { google: "2h0hS6xG91EuQjYI1FZAHqQHxFmu7l70BmcSz62ZLmc" },
  title: 'StealthHumanizer — Free AI Text Humanizer | Bypass GPTZero & AI Detectors | 35 Providers',
  description:
    'Transform AI-generated text into natural, human-like writing. Free, open-source, no login required. Bypass GPTZero and AI detectors with 35 AI providers, 4 rewrite levels, multi-pass ninja mode, grammar check, and 16+ languages.',
  keywords: [
    'AI humanizer', 'text humanizer', 'humanize AI text', 'AI text converter',
    'bypass AI detection', 'undetectable AI', 'AI detector bypass', 'humanize ChatGPT',
    'rewrite AI text', 'AI to human text', 'free AI humanizer', 'open source humanizer',
    'paraphrase AI text', 'humanize AI writing', 'stealth writer', 'QuillBot alternative',
    'Undetectable.ai alternative', 'StealthWriter alternative', 'GPTZero bypass',
    'humanize AI essay', 'AI writing tool', 'text rewriter',
    'AI content humanizer', 'bypass GPTZero', 'humanize text free', 'AI detector free',
    'ninja mode humanizer', 'multi-language AI humanizer', 'privacy AI tool',
  ],
  authors: [{ name: 'Rudra Sarker', url: 'https://github.com/rudra496' }],
  creator: 'Rudra Sarker',
  publisher: 'StealthHumanizer',
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: SITE_URL },
  openGraph: {
    title: 'StealthHumanizer — Free AI Text Humanizer | Bypass GPTZero & AI Detectors',
    description:
      'Transform AI text into natural writing. Bypass GPTZero & AI detectors. 35 providers, ninja mode, grammar check, 16+ languages. 100% free & open-source. No login.',
    url: SITE_URL,
    siteName: 'StealthHumanizer',
    type: 'website',
    locale: 'en_US',
    images: [
      {
        url: `${SITE_URL}/og-image.png`,
        width: 1200,
        height: 630,
        alt: 'StealthHumanizer — Free AI Text Humanizer | Bypass GPTZero & AI Detectors',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'StealthHumanizer — Free AI Text Humanizer | Bypass GPTZero & AI Detectors',
    description:
      'Transform AI text into natural writing. 35 providers, ninja mode, 100% free. Bypass GPTZero & AI detectors. No login required.',
    images: [`${SITE_URL}/og-image.png`],
    creator: '@rudra496',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  icons: { icon: '/favicon.ico' },
  category: 'technology',
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'StealthHumanizer',
  url: SITE_URL,
  description:
    'Free open-source AI text humanizer. Transform AI-generated text into natural, human-like writing. Bypass GPTZero and AI detectors with 35 AI providers, 4 rewrite levels, and multi-pass ninja mode.',
  applicationCategory: 'UtilitiesApplication',
  operatingSystem: 'Web',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  author: { '@type': 'Person', name: 'Rudra Sarker', url: 'https://github.com/rudra496' },
  publisher: {
    '@type': 'Organization',
    name: 'StealthHumanizer',
    url: SITE_URL,
  },
  featureList: [
    '35 AI provider integrations (Gemini, Google Gemini OAuth, OpenAI, Claude, Groq, Mistral, Codebuff, Command Code, Ollama, LM Studio, vLLM, and more)',
    '4 rewrite levels: Light, Medium, Aggressive, Ninja',
    'Multi-pass ninja mode with auto-refinement to 90%+ human score',
    'Style-aware rewriting: Academic, Professional, Casual, Creative, Technical',
    '9 text purposes: Essay, Article, Blog, Email, Marketing, Report, Story, Social Media',
    '13 tone presets: Conversational, Journalistic, Persuasive, Storytelling, and more',
    'PDF and DOCX file upload support',
    'Built-in grammar checker',
    'AI detection scoring with confidence intervals',
    'Multi-language support (16+ languages including Chinese)',
    'Batch processing for multiple texts',
    'Export to TXT, DOCX, and PDF',
    '100% free and open-source (MIT License)',
    'No login required — API keys stored locally in browser',
  ],
};

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'Is StealthHumanizer free?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes, StealthHumanizer is 100% free and open-source under the MIT License. You only need a free API key from providers like Google Gemini.',
      },
    },
    {
      '@type': 'Question',
      name: 'Does it work with GPTZero?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. StealthHumanizer uses a 4-layer pipeline — LLM rewrite, non-LLM post-processing (synonym swaps, collocation replacements), multi-model chaining, and final polish — to disrupt AI detection signals like low perplexity, low burstiness, and AI-typical phrases. It is effective against GPTZero and major AI detectors.',
      },
    },
    {
      '@type': 'Question',
      name: 'Do I need to create an account?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'No. StealthHumanizer requires no login, no signup, and no account. Just open the site, paste your text, and start humanizing. Your API keys are stored locally in your browser.',
      },
    },
    {
      '@type': 'Question',
      name: 'Which AI providers are supported?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: '35 providers are supported: Google Gemini (free), Google Gemini (OAuth, free), OpenAI, Claude, Groq (free), Mistral, Cohere, Together, OpenRouter, Cerebras, DeepInfra, HuggingFace, Cloudflare, ZAI, Codebuff (free), Command Code, OpenCode Zen (free), OpenCode Zen Anthropic (free), OpenCode Go, OpenCode Go Anthropic, Crof.ai, Ocenza, MiMo (Xiaomi), NVIDIA NIM, Kilo.ai Gateway, Nous Research (free), Perplexity, Fireworks AI, OpenAdapter (free), Z.ai Coding, Ollama (local, free), LM Studio (local, free), and vLLM (local, free).',
      },
    },
    {
      '@type': 'Question',
      name: 'Is my data private?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. API keys are stored only in your browser\'s localStorage. Text goes directly from your browser to the AI provider you choose. No data is stored on any server. StealthHumanizer is 100% private.',
      },
    },
    {
      '@type': 'Question',
      name: 'How many languages are supported?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'StealthHumanizer supports 16+ languages including English, Spanish, French, German, Portuguese, Chinese, Japanese, Korean, Hindi, Arabic, and more. You can select your target language before humanizing.',
      },
    },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="icon" href="/favicon.ico" />
        <meta name="theme-color" content="#0a0a0f" />
        <link rel="sitemap" type="application/xml" href="/sitemap.xml" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
