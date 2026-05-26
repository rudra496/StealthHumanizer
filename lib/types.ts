// Type definitions for StealthHumanizer v2

// ==================== PROVIDER TYPES ====================

export type ModelProvider =
  | 'gemini' | 'openai' | 'claude'
  | 'groq' | 'mistral' | 'cohere'
  | 'together' | 'openrouter' | 'cerebras'
  | 'deepinfra' | 'huggingface' | 'cloudflare' | 'zai'
  | 'claude-code' | 'codex';

export interface Provider {
  id: ModelProvider;
  name: string;
  description: string;
  free: boolean;
  apiUrl: string;
  getApiKeyUrl: string;
  docsUrl?: string;
  defaultModel: string;
  models: string[];
  placeholder: string;
  /** Runs as a local subprocess (e.g. Claude Code, Codex CLI). No API key needed;
   *  the binary handles auth via its own login state. Not available in browser
   *  or serverless runtimes. */
  cliOnly?: boolean;
}

// ==================== HUMANIZATION TYPES ====================

export type RewriteLevel = 'light' | 'medium' | 'aggressive' | 'ninja';
export type StylePreset = 'humanize' | 'academic' | 'casual' | 'professional' | 'creative' | 'technical';

export type TonePreset = 
  | 'academic-formal' | 'academic-casual'
  | 'journalistic' | 'creative-writing'
  | 'conversational' | 'professional'
  | 'technical' | 'persuasive'
  | 'storytelling' | 'humorous'
  | 'emotional' | 'analytical'
  | 'custom';

export interface ToneConfig {
  id: TonePreset;
  name: string;
  description: string;
  icon: string;
  personalityTraits: string[];
  vocabularyPreferences: string[];
  writingPatterns: string[];
}

export interface ApiKeys {
  [key: string]: string | undefined;
}

export interface HumanizationOptions {
  level: RewriteLevel;
  style: StylePreset;
  tone: TonePreset;
  customTone?: string;
  model: ModelProvider;
  targetScore?: number;
  language: string;
  /** Academic domain for corpus-calibrated style matching */
  domain?: string;
  /** Enable aggressive context-blind synonym swap pass. Default: true.
   *  Set to false to skip this step (useful for technical content where bad
   *  swaps like "first" -> "to start" or "deal" -> "address" damage meaning). */
  aggressiveSynonyms?: boolean;
}

export interface SentenceResult {
  original: string;
  humanized: string;
  alternatives?: string[];
  index: number;
  detectionScore?: number;
}

export interface HumanizationResult {
  sentences: SentenceResult[];
  fullText: string;
  model: ModelProvider;
  modelName: string;
  wordCount: { input: number; output: number };
  timestamp: number;
  passes: number;
  finalScore: number;
  options: HumanizationOptions;
  confidenceReport?: {
    humanLikenessScore: number;
    confidence: number;
    calibrationBand: 'high' | 'medium' | 'low';
  };
  runtimeModelScore?: {
    modelSource: string;
    probabilityHuman: number;
    score: number;
  };
  fallbackBehavior?: {
    used: boolean;
    reason: string;
  };
  provenanceDisclosure?: {
    source: string;
    policyVersion: string;
    modelSelection: string;
  };
}

// ==================== DETECTION TYPES ====================

export interface DetectionResult {
  score: number;
  confidenceInterval: { lower: number; upper: number };
  sentences: SentenceDetectionResult[];
  overallVerdict: 'human' | 'ai' | 'mixed';
  analysis: {
    perplexity: number;
    burstiness: number;
    vocabularyDiversity: number;
    sentenceLengthVariation: number;
    transitionFrequency: number;
    passiveVoiceRatio: number;
    aiPhraseDensity: number;
    sentenceStartDiversity: number;
    pronounUsage: number;
    hedgingFrequency: number;
    quantifierOveruse: number;
  };
  readability: ReadabilityScores;
}

export interface DetailedDetectionReport {
  overallScore: number;
  confidenceInterval: { lower: number; upper: number };
  verdict: 'human' | 'ai' | 'mixed';
  topAiSentences: { text: string; score: number; issues: string[] }[];
  topHumanSentences: { text: string; score: number; issues: string[] }[];
  foundAiPhrases: string[];
  metricsSummary: { name: string; value: number; interpretation: string }[];
  recommendations: string[];
}

export interface SentenceDetectionResult {
  text: string;
  score: number;
  classification: 'human' | 'maybe' | 'ai';
  issues: string[];
}

export interface ReadabilityScores {
  fleschReadingEase: number;
  fleschKincaidGrade: number;
  colemanLiauIndex: number;
  avgWordsPerSentence: number;
  avgSyllablesPerWord: number;
  readingTimeMinutes: number;
  totalSentences: number;
  totalWords: number;
  totalSyllables: number;
}

// ==================== HISTORY TYPES ====================

export interface HistoryEntry {
  id: string;
  originalText: string;
  humanizedText: string;
  options: HumanizationOptions;
  wordCount?: { input: number; output: number };
  timestamp: number;
  model?: ModelProvider;
  modelName?: string;
  finalScore?: number;
  passes?: number;
  detection?: DetectionResult;
}

// ==================== ENHANCEMENT TYPES ====================

export type EnhanceMode = 
  | 'grammar' | 'spell' | 'punctuation' 
  | 'structure' | 'vocabulary' | 'passive-to-active'
  | 'formal' | 'informal' | 'simplify' | 'expand';

export interface EnhanceResult {
  original: string;
  enhanced: string;
  mode: EnhanceMode;
  changes: string[];
}

// ==================== TEMPLATE TYPES ====================

export interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  prompt: string;
  sampleText: string;
}

// ==================== UI TYPES ====================

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

export type Tab = 'humanizer' | 'batch' | 'detector' | 'enhance' | 'history' | 'settings';

export type TextPurpose =
  | 'essay' | 'article' | 'blog' | 'email'
  | 'marketing' | 'report' | 'story' | 'social-media' | 'general';

export interface PurposeConfig {
  id: TextPurpose;
  name: string;
  icon: string;
  description: string;
  promptOverlay: string;
}
