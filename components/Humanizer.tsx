'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Sparkles, Copy, Download, FileText, RefreshCw, Zap, Eye,
  FileDown, Target, ChevronDown, ChevronUp, Keyboard, ArrowRight,
  Type, Languages, Upload, RotateCcw, CheckCircle, AlertTriangle,
  X, FileUp, BarChart2, Shield
} from 'lucide-react';
import { StylePreset, HumanizationResult, ModelProvider, SentenceDetectionResult, Intensity } from '@/lib/types';
import { SAMPLE_AI_TEXT, SAMPLE_TECHNICAL_TEXT } from '@/lib/prompts';
import { detectAI } from '@/lib/detector';
import { getReadabilityLabel } from '@/lib/readability';
import { countWords, downloadAsTxt, downloadAsDocx, downloadAsMarkdown, getApiKeys } from '@/lib/storage';
import { buildSentenceResults } from '@/lib/text-utils';
import { WEB_PROVIDERS as PROVIDERS } from '@/lib/providers';
import { assessSemanticFidelity } from '@/lib/semantic-fidelity';
import { localHumanizeText } from '@/lib/local-humanizer';
import { BASE_PATH } from '@/lib/base-path';
import { addCostEntry } from '@/lib/cost-tracker';
import { addObservabilityEvent, estimateRunCost } from '@/lib/observability';
import { saveHumanizationVersion } from '@/lib/version-history';
import dynamic from 'next/dynamic';

const ComparisonChart = dynamic(
  () => import('./ComparisonChart'),
  { ssr: false, loading: () => <div className="h-[220px] bg-dark-800/50 rounded-xl animate-pulse" /> },
);

const STYLES: { id: StylePreset; name: string; icon: string }[] = [
  { id: 'stealth', name: 'Stealth', icon: '🥷' },
  { id: 'humanize', name: 'Humanize', icon: '🧑' },
  { id: 'academic', name: 'Academic', icon: '🎓' },
  { id: 'professional', name: 'Professional', icon: '💼' },
  { id: 'casual', name: 'Casual', icon: '☕' },
  { id: 'creative', name: 'Creative', icon: '🎨' },
  { id: 'technical', name: 'Technical', icon: '⚙️' },
];

const LANGUAGES = [
  { code: 'auto', name: 'Auto Detect' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'zh-CN', name: 'Chinese (Simplified)' },
  { code: 'zh-TW', name: 'Chinese (Traditional)' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'bn', name: 'Bengali' },
  { code: 'ru', name: 'Russian' },
  { code: 'it', name: 'Italian' },
  { code: 'nl', name: 'Dutch' },
  { code: 'tr', name: 'Turkish' },
];

interface GrammarIssue {
  type: string;
  original: string;
  suggestion: string;
  explanation: string;
}

interface HumanizerProps {
  showToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
  onGoToSettings?: () => void;
  isFirstVisit?: boolean;
}

export default function Humanizer({ showToast, onGoToSettings, isFirstVisit }: HumanizerProps) {
  const [inputText, setInputText] = useState('');
  const [result, setResult] = useState<HumanizationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ pass: 0, max: 0, message: '' });
  const [style, setStyle] = useState<StylePreset>('humanize');
  const [language, setLanguage] = useState('auto');
  const [targetScore, setTargetScore] = useState(80);
  const [expandedSentence, setExpandedSentence] = useState<number | null>(null);
  const [alternatives, setAlternatives] = useState<Record<number, string[]>>({});
  const [showComparison, setShowComparison] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showReadability, setShowReadability] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Post-humanize detection result (from the hosted RoBERTa detector, when
  // configured server-side). Null until the auto-detect-after-humanize fires.
  const [postDetect, setPostDetect] = useState<{
    label: 'human' | 'ai';
    aiProbability: number;
    humanProbability: number;
    model: string;
    elapsedMs: number;
    source: string;
  } | null>(null);
  const [postDetectLoading, setPostDetectLoading] = useState(false);
  const [postDetectError, setPostDetectError] = useState<string | null>(null);

  // File upload
  const [fileUploading, setFileUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut tooltip
  const [showShortcutTooltip, setShowShortcutTooltip] = useState(false);

  // Grammar check
  const [grammarIssues, setGrammarIssues] = useState<GrammarIssue[]>([]);
  const [grammarChecking, setGrammarChecking] = useState(false);
  const [correctedText, setCorrectedText] = useState('');

  // Re-humanize
  const [rehumanizing, setRehumanizing] = useState(false);
  const [writingSample, setWritingSample] = useState('');

  // Pipeline options
  const [enablePostprocess, setEnablePostprocess] = useState(true);
  const [enableChain, setEnableChain] = useState(false);
  const [selectedChainModels, setSelectedChainModels] = useState<string[]>([]);
  const [pipelineStep, setPipelineStep] = useState('');
  // Default provider on the public Vercel deployment is "Rudra's Free Usage
  // Model" — pre-configured, no API key needed. Self-hosters can override via
  // NEXT_PUBLIC_DEFAULT_PROVIDER (e.g. "gemini", "ollama").
  const DEFAULT_PROVIDER: ModelProvider =
    ((process.env.NEXT_PUBLIC_DEFAULT_PROVIDER as ModelProvider | undefined) || 'rudra-free');
  const [preferredModel, setPreferredModel] = useState<ModelProvider>(DEFAULT_PROVIDER);
  const [intensity, setIntensity] = useState<Intensity>('medium');

  // Comparison chart visibility (Phase 4)
  const [showComparisonChart, setShowComparisonChart] = useState(false);

  // Word count limit
  const [maxOutputWords, setMaxOutputWords] = useState(0); // 0 = no limit

  // Heatmap mode
  const [showHeatmap, setShowHeatmap] = useState(false);

  // Roadmap features
  const [privacyMode, setPrivacyMode] = useState(false);

  const wordCount = countWords(inputText);
  const hasAnyApiKey = Object.values(getApiKeys()).some(v => v && v.trim().length > 0);

  useEffect(() => {
    const queryText = new URLSearchParams(window.location.search).get('text');
    if (queryText) { setInputText(queryText); window.history.replaceState({}, '', window.location.pathname); return; }
    const reuse = sessionStorage.getItem('stealthhumanizer_reuse_text');
    if (reuse) { setInputText(reuse); sessionStorage.removeItem('stealthhumanizer_reuse_text'); }
  }, []);

  useEffect(() => {
    if (isFirstVisit && !inputText) {
      setInputText(SAMPLE_AI_TEXT);
      const timer = setTimeout(() => setShowShortcutTooltip(true), 2000);
      return () => clearTimeout(timer);
    }
  }, [isFirstVisit]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); handleHumanize(); }
      if (e.ctrlKey && e.shiftKey && e.key === 'C') { e.preventDefault(); result && handleCopy(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [inputText, result]);

  // Local inference providers (Ollama, LM Studio, vLLM) need no API key — they
  // run on the server's loopback — so they can be selected and used even before
  // the user has entered any key. This makes a self-hosted deployment zero-config.
  const getApiCredentials = () => {
    const keys = Object.fromEntries(
      Object.entries(getApiKeys()).map(([provider, key]) => [provider, key?.trim()])
    ) as Record<string, string | undefined>;
    const localProviders: ModelProvider[] = ['ollama', 'lm-studio', 'vllm'];
    const hasKey = (id: string) => !!keys[id]?.trim();
    let providerId: ModelProvider;
    // "Rudra's Free Usage Model" needs no client API key — the server uses
    // a preconfigured env var. Always allow it as a valid pick.
    if (preferredModel === 'rudra-free') {
      providerId = 'rudra-free';
    } else if (hasKey(preferredModel)) {
      providerId = preferredModel;
    } else if (localProviders.includes(preferredModel)) {
      providerId = preferredModel;
    } else {
      providerId = (Object.keys(keys).find(k => hasKey(k)) || DEFAULT_PROVIDER) as ModelProvider;
    }
    const apiKey =
      keys[providerId]?.trim() ||
      (providerId === 'rudra-free'
        ? 'pre-configured'
        : localProviders.includes(providerId)
          ? (PROVIDERS.find(p => p.id === providerId)?.placeholder || 'ollama')
          : undefined);
    return { providerId, apiKey };
  };

  function buildLocalPrivacyResult(startedAt: number): HumanizationResult {
    const fullText = localHumanizeText(inputText, { style });
    const detection = detectAI(fullText);
    const sentences = buildSentenceResults(inputText, fullText).map((row, index) => ({
      original: row.original,
      humanized: row.humanized,
      alternatives: [] as string[],
      index,
      detectionScore: detection.sentences[index]?.score,
    }));
    return {
      sentences,
      fullText,
      model: 'ollama',
      modelName: 'Local Privacy Mode',
      wordCount: { input: countWords(inputText), output: countWords(fullText) },
      timestamp: Date.now(),
      passes: 1,
      finalScore: detection.score,
      options: { style, language, model: 'ollama' },
      semanticFidelity: assessSemanticFidelity(inputText, fullText),
      observability: { latencyMs: Math.round(performance.now() - startedAt), estimatedCostUsd: 0, streamingAvailable: false, privacyMode: true },
    };
  }

  async function handleHumanize() {
    if (!inputText.trim()) { showToast('warning', 'Please enter some text to humanize.'); return; }
    if (wordCount > 10000) { showToast('warning', 'Maximum 10,000 words per input.'); return; }
    const startedAt = performance.now();

    if (privacyMode) {
      setLoading(true);
      setResult(null);
      setPipelineStep('Privacy mode: local rewrite...');
      try {
        const localResult = buildLocalPrivacyResult(startedAt);
        setResult(localResult);
        saveHumanizationVersion(localResult);
        addObservabilityEvent({
          type: 'privacy', provider: 'local-privacy', inputWords: localResult.wordCount.input,
          outputWords: localResult.wordCount.output, latencyMs: localResult.observability?.latencyMs ?? 0,
          costUsd: 0, finalScore: localResult.finalScore, semanticScore: localResult.semanticFidelity?.score, success: true,
        });
        showToast('success', `Privacy mode complete — ${localResult.finalScore}% human, ${localResult.semanticFidelity?.score}% semantic fidelity.`);
      } catch (err: unknown) {
        showToast('error', err instanceof Error ? err.message : 'Privacy mode failed');
      } finally {
        setLoading(false);
        setPipelineStep('');
        setProgress({ pass: 0, max: 0, message: '' });
      }
      return;
    }

    const { providerId, apiKey } = getApiCredentials();
    if (!apiKey && providerId !== 'rudra-free') { showToast('warning', 'Please add an API key in Settings first, pick Rudra’s Free Usage Model, or enable Privacy Mode for an offline local rewrite.'); return; }

    setLoading(true);
    setResult(null);
    setGrammarIssues([]);
    setCorrectedText('');
    setPostDetect(null);
    setPostDetectError(null);
    setPipelineStep('Step 1: LLM Rewrite...');
    setProgress({ pass: 0, max: 2, message: 'Layer 1: LLM Rewrite...' });

    // Rudra's Free Usage Model, DIRECT mode: the browser calls the Oracle VPS
    // itself, skipping Vercel's 60s function clamp. That lets the server run
    // best-of-4 samples (85s budget) ranked by its detector ensemble — the
    // verified-0%-on-ZeroGPT configuration. Vercel function usage → ~0.
    if (providerId === 'rudra-free') {
      try {
        const directBase = process.env.NEXT_PUBLIC_RUDRA_DIRECT_URL || 'https://129-159-229-170.sslip.io';
        const resp = await fetch(`${directBase}/api/humanize/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: inputText, temperature: 0.85, samples: 4 }),
        });
        if (!resp.ok) throw new Error(`Humanizer HTTP ${resp.status}`);
        const rd = await resp.json();
        const fullText: string = rd.humanized || inputText;
        const det = detectAI(fullText);
        const sents = buildSentenceResults(inputText, fullText).map((row: any, i: number) => ({
          original: row.original, humanized: row.humanized, alternatives: [] as string[],
          index: i, detectionScore: det.sentences[i]?.score,
        }));
        const directResult: HumanizationResult = {
          sentences: sents,
          fullText,
          model: 'rudra-free',
          modelName: "Rudra's Free Usage Model",
          wordCount: { input: countWords(inputText), output: countWords(fullText) },
          timestamp: Date.now(),
          passes: 1,
          finalScore: det.score,
          options: { style: style as any, language },
          semanticFidelity: assessSemanticFidelity(inputText, fullText),
          confidenceReport: { humanLikenessScore: det.score, confidence: Math.max(30, Math.min(95, det.score)), calibrationBand: 'medium' },
          fallbackBehavior: { used: false, reason: 'not needed' },
          observability: { latencyMs: rd.elapsed_ms || 0, estimatedCostUsd: 0, streamingAvailable: false, privacyMode: false },
        } as any;
        setResult(directResult);
        saveHumanizationVersion(directResult);
        setPipelineStep('');
        setProgress({ pass: 1, max: 1, message: 'Done!' });
        showToast(det.score >= 70 ? 'success' : 'info', `Score: ${det.score}% human`);
        setLoading(false);
        (async () => {
          try {
            setPostDetectLoading(true);
            const r = await fetch(`${BASE_PATH}/api/detect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: fullText }) });
            const json = await r.json();
            if (json?.success) {
              const dd = json.data;
              const aiP = typeof dd.aiProbability === 'number' ? dd.aiProbability : dd.score;
              setPostDetect({ label: aiP >= 0.5 ? 'ai' : 'human', aiProbability: aiP, humanProbability: 1 - aiP, model: dd.model || 'rudra-ensemble', elapsedMs: dd.elapsed_ms || 0, source: 'rudra' });
            }
          } catch { /* non-blocking */ } finally { setPostDetectLoading(false); }
        })();
      } catch (err: any) {
        showToast('error', err?.message || 'Direct humanization failed');
        setLoading(false);
        setPipelineStep('');
        setProgress({ pass: 0, max: 0, message: '' });
      }
      return;
    }

    try {
      // Get all available API keys
      const allApiKeys = Object.fromEntries(
        Object.entries(getApiKeys()).map(([provider, key]) => [provider, key?.trim()])
      );

      const response = await fetch(`${BASE_PATH}/api/humanize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: inputText, style, intensity,
          model: providerId, apiKey, targetScore, language, writingSample,
          maxOutputWords: maxOutputWords || undefined,
          postprocess: enablePostprocess,
          chainModels: enableChain ? selectedChainModels : [],
          apiKeys: allApiKeys,
        }),
      });
      if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.error || 'Failed'); }
      const data: HumanizationResult & { success?: boolean } = await response.json();
      setResult(data);
      saveHumanizationVersion(data);
      setPipelineStep('');
      setProgress({ pass: 1, max: 1, message: 'Done!' });

      const conf = data?.confidenceReport?.confidence;
      const scoreMsg = data.finalScore >= 70 ? `🎉 ${data.finalScore}% human!` : `Score: ${data.finalScore}% human`;
      const confMsg = typeof conf === 'number' ? ` | Confidence: ${conf}%` : '';
      showToast('success', `Done with ${data.modelName} (${data.passes} pass${data.passes > 1 ? 'es' : ''}) — ${scoreMsg}`);
      if (confMsg) showToast('info', `Detector confidence${confMsg}`);
      const observedLatency = Math.round(performance.now() - startedAt);
      const observedCost = data.observability?.estimatedCostUsd ?? estimateRunCost(data.wordCount.input, data.wordCount.output, providerId);
      addCostEntry({ date: new Date().toISOString().slice(0, 10), provider: providerId, model: data.modelName, tokens: Math.ceil((data.wordCount.input + data.wordCount.output) * 1.35), costUsd: observedCost });
      addObservabilityEvent({
        type: 'humanize', provider: providerId, model: data.modelName,
        inputWords: data.wordCount.input, outputWords: data.wordCount.output, latencyMs: observedLatency,
        costUsd: observedCost, finalScore: data.finalScore, semanticScore: data.semanticFidelity?.score, success: true,
      });

      // Show the result immediately. Further refinement is opt-in via the
      // "Refine further" button — auto-running a multi-round loop on every
      // humanize was slow, expensive, and could fail mid-loop. Never auto-copy
      // to the clipboard; that surprised users.
      if (data.finalScore >= 90) {
        showToast('success', `🎯 ${data.finalScore}% human on the first pass!`);
      } else if (flaggedCountFrom(data)) {
        showToast('info', `${data.finalScore}% human. Click "Refine further" to push it higher.`);
      }
      setLoading(false);
      setPipelineStep('');
      setProgress({ pass: 0, max: 0, message: '' });

      // Fire-and-forget: run the hosted RoBERTa detector on the humanized
      // output so the user sees an independent AI-probability verdict right
      // below the heuristic score. Never blocks or fails the humanize call.
      (async () => {
        try {
          setPostDetectLoading(true);
          const r = await fetch(`${BASE_PATH}/api/detect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: data.fullText }),
          });
          if (!r.ok) throw new Error(`Detector HTTP ${r.status}`);
          const json = await r.json();
          if (!json?.success) throw new Error(json?.error || 'Detector failed');
          const d = json.data;
          if (d?.source === 'rudra') {
            const aiP = typeof d.aiProbability === 'number' ? d.aiProbability : d.score;
            const humanP = typeof d.humanProbability === 'number' ? d.humanProbability : (1 - aiP);
            setPostDetect({
              label: d.verdict === 'generated' || d.label === 'ai' || aiP >= 0.5 ? 'ai' : 'human',
              aiProbability: aiP,
              humanProbability: humanP,
              model: d.model || 'fakespot-ai/roberta-base-ai-text-detection-v1',
              elapsedMs: d.elapsedMs || 0,
              source: 'rudra',
            });
          } else if (d?.source === 'gptzero') {
            const score = d.score ?? 0;
            setPostDetect({
              label: score >= 0.5 ? 'ai' : 'human',
              aiProbability: score,
              humanProbability: 1 - score,
              model: 'GPTZero',
              elapsedMs: 0,
              source: 'gptzero',
            });
          } else if (typeof d?.score === 'number') {
            setPostDetect({
              label: d.score >= 0.5 ? 'ai' : 'human',
              aiProbability: d.score,
              humanProbability: 1 - d.score,
              model: 'local heuristic (server-side fallback)',
              elapsedMs: 0,
              source: 'fallback',
            });
          }
        } catch (err: any) {
          setPostDetectError(err?.message || 'Detection failed');
        } finally {
          setPostDetectLoading(false);
        }
      })();
    } catch (err: any) {
      showToast('error', err.message || 'Something went wrong');
      setLoading(false);
      setProgress({ pass: 0, max: 0, message: '' });
    }
  }

  function flaggedCountFrom(data: HumanizationResult): number {
    try { return detectAI(data.fullText).sentences.filter(s => s.classification !== 'human').length; }
    catch { return 0; }
  }

  function handleCopy() { if (result) { navigator.clipboard.writeText(result.fullText); showToast('success', 'Copied!'); } }
  const handleDownload = (format: 'txt' | 'docx' | 'md') => {
    if (result) {
      if (format === 'txt') downloadAsTxt(result.fullText, 'humanized');
      else if (format === 'docx') downloadAsDocx(result.fullText, 'humanized');
      else downloadAsMarkdown(result.fullText, 'humanized');
      showToast('success', `Downloaded as ${format.toUpperCase()}!`);
    }
  };

  const handleGetAlternatives = async (index: number) => {
    if (!result || expandedSentence === index) { setExpandedSentence(null); return; }
    setExpandedSentence(index);
    if (alternatives[index]) return;
    const sentence = result.sentences[index];
    if (!sentence?.original) return;
    try {
      const { providerId, apiKey } = getApiCredentials();
      if (!apiKey) return;
      const resp = await fetch(`${BASE_PATH}/api/alternative`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ original: sentence.original, current: sentence.humanized, style, model: providerId, apiKey }),
      });
      if (resp.ok) { const data = await resp.json(); setAlternatives(prev => ({ ...prev, [index]: data.alternatives })); }
    } catch {}
  };

  const handleSelectAlternative = (index: number, alt: string) => {
    if (!result) return;
    const newSentences = [...result.sentences];
    newSentences[index] = { ...newSentences[index], humanized: alt };
    setResult({ ...result, sentences: newSentences, fullText: newSentences.map(s => s.humanized).join(' ') });
    showToast('success', 'Alternative applied!');
  };

  // File upload handler
  const handleFileUpload = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      showToast('error', 'File too large. Maximum size is 10MB.');
      return;
    }
    setFileUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const resp = await fetch(`${BASE_PATH}/api/upload`, { method: 'POST', body: formData });
      if (!resp.ok) { const err = await resp.json(); throw new Error(err.error || 'Upload failed'); }
      const raw = await resp.json();
      const data = raw.data ?? raw;
      setInputText(data.text);
      showToast('success', `Loaded ${data.name || file.name} (${countWords(data.text)} words)`);
    } catch (err: any) {
      showToast('error', err.message || 'Failed to upload file');
    } finally {
      setFileUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  };

  // Re-humanize flagged sentences (manual trigger)
  const handleRehumanize = async () => {
    if (!result) return;
    const { providerId, apiKey } = getApiCredentials();
    if (!apiKey && providerId !== 'rudra-free') { showToast('warning', 'No API key configured'); return; }

    setRehumanizing(true);
    let currentFullText = result.fullText;
    let currentScore = result.finalScore;
    let round = 0;
    const maxRounds = 3;

    try {
      while (currentScore < 90 && round < maxRounds) {
        round++;
        setProgress({ pass: round, max: maxRounds, message: `Round ${round} — ${currentScore}%` });
        showToast('info', `Refining round ${round}… (current: ${currentScore}%)`);

        const detection = detectAI(currentFullText);
        const flagged = detection.sentences.filter((s: any) => s.classification !== 'human').map((s: any) => s.text);
        if (flagged.length === 0) break;

        const resp = await fetch(`${BASE_PATH}/api/rehumanize`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            flaggedSentences: flagged, style, 
            model: providerId, apiKey, fullText: currentFullText,
          }),
        });
        if (!resp.ok) break;
        const data = await resp.json();

        const candidateText = data.fullText;
        const newDetection = detectAI(candidateText);
        const newScore = newDetection.score;
        const changed = candidateText.trim() !== currentFullText.trim();
        if (newScore > currentScore || (newScore === currentScore && changed && data.fallbackUsed)) {
          currentFullText = candidateText;
          currentScore = newScore;
        } else {
          showToast('warning', changed
            ? `Stopped: round ${round} did not improve the score (${currentScore}% → ${newScore}%).`
            : `Stopped: round ${round} returned no usable changes.`);
          break;
        }
      }

      const finalDetection = detectAI(currentFullText);
      const sentences = buildSentenceResults(inputText, currentFullText).map((row, i) => ({
        original: row.original,
        humanized: row.humanized,
        alternatives: [] as string[],
        index: i,
        detectionScore: finalDetection.sentences[i]?.score,
      }));

      const refinedResult = {
        ...result,
        sentences,
        fullText: currentFullText,
        passes: result.passes + round,
        finalScore: finalDetection.score,
        semanticFidelity: assessSemanticFidelity(inputText, currentFullText),
        wordCount: { ...result.wordCount, output: countWords(currentFullText) },
      };
      setResult(refinedResult);
      saveHumanizationVersion(refinedResult);

      if (finalDetection.score < 90) {
        setShowComparison(true);
      }
      if (finalDetection.score >= 90) {
        showToast('success', `🎯 ${finalDetection.score}% human after ${round} round${round > 1 ? 's' : ''}!`);
      } else if (round >= maxRounds) {
        showToast('info', `Refined ${round} rounds → ${finalDetection.score}% human (max rounds reached).`);
      } else {
        showToast('success', `Refined ${round} round${round > 1 ? 's' : ''} → ${finalDetection.score}% human.`);
      }
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setRehumanizing(false);
      setProgress({ pass: 0, max: 0, message: '' });
    }
  };

  // Grammar check
  const handleGrammarCheck = async () => {
    if (!result) return;
    const { providerId, apiKey } = getApiCredentials();

    setGrammarChecking(true);
    try {
      const resp = await fetch(`${BASE_PATH}/api/grammar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: result.fullText, model: providerId, apiKey }),
      });
      if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(err.error || 'Grammar check failed'); }
      const data = await resp.json();
      setGrammarIssues(data.issues || []);
      setCorrectedText(data.correctedText || result.fullText);
      if (data.warning) showToast('warning', data.warning);
      if ((data.issues || []).length === 0) {
        showToast('success', 'No grammar issues found! ✅');
      } else {
        showToast('info', `Found ${(data.issues || []).length} issue(s)`);
      }
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setGrammarChecking(false);
    }
  };

  const handleApplyGrammarFix = () => {
    if (!result || !correctedText) return;
    const newSentencesSplit = correctedText.match(/[^.!?]+[.!?]+[\s]*/g)?.map(s => s.trim()).filter(s => s.length > 0) || [correctedText.trim()];
    const maxLen = Math.max(result.sentences.length, newSentencesSplit.length);
    const sentences = [];
    for (let i = 0; i < maxLen; i++) {
      sentences.push({
        original: result.sentences[i]?.original || '',
        humanized: newSentencesSplit[i] || '',
        alternatives: [], index: i,
        detectionScore: result.sentences[i]?.detectionScore,
      });
    }
    setResult({
      ...result,
      sentences,
      fullText: correctedText,
      wordCount: { ...result.wordCount, output: countWords(correctedText) },
    });
    setGrammarIssues([]);
    setCorrectedText('');
    showToast('success', 'Grammar corrections applied!');
  };

  // Phase 3: PDF export
  const handleExportPDF = async () => {
    if (!result) return;
    try {
      const localDetection = detectAI(result.fullText);
      const { generatePDF } = await import('@/lib/pdf');
      await generatePDF({
        title: 'StealthHumanizer — Export',
        originalText: inputText || '(no original text)',
        humanizedText: result.fullText,
        scores: {
          localScore: localDetection.score,
        },
        date: new Date().toLocaleString(),
      });
      showToast('success', 'PDF exported!');
    } catch {
      showToast('error', 'PDF export failed.');
    }
  };

  const escapeHtml = (value: string) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const getHighlightedText = (fullText: string, sentences: SentenceDetectionResult[]) => {
    const sorted = [...sentences]
      .filter(sentence => sentence.text.trim().length > 0 && sentence.score < 60)
      .sort((a, b) => b.text.length - a.text.length);
    let html = escapeHtml(fullText);
    for (const sentence of sorted) {
      const bgStyle = sentence.score < 35
        ? 'background:rgba(239,68,68,0.2);border-radius:3px;padding:0 2px;'
        : 'background:rgba(234,179,8,0.2);border-radius:3px;padding:0 2px;';
      const escapedSentence = escapeHtml(sentence.text);
      html = html.replace(escapedSentence, `<span style="${bgStyle}" title="AI Score: ${sentence.score}%">${escapedSentence}</span>`);
    }
    return html;
  };

  const detection = useMemo(() => {
    return result ? detectAI(result.fullText) : null;
  }, [result?.fullText]);
  const originalDetection = useMemo(() => {
    return inputText ? detectAI(inputText) : null;
  }, [inputText]);
  const readLabel = detection ? getReadabilityLabel(detection.readability.fleschReadingEase) : null;
  const scoreChange = detection && originalDetection ? detection.score - originalDetection.score : 0;
  const flaggedCount = detection?.sentences.filter(s => s.classification !== 'human').length || 0;

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* API Key Gate */}
      {!hasAnyApiKey && (
        <div className="glass-card rounded-xl p-6 border border-accent-500/30 animate-fade-in">
          <div className="flex flex-col items-center text-center gap-3">
            <div className="w-14 h-14 rounded-full bg-accent-500/20 flex items-center justify-center">
              <Keyboard className="w-7 h-7 text-accent-400" />
            </div>
            <h3 className="text-lg font-bold text-white">Set Up API Key to Get Started</h3>
            <p className="text-dark-400 text-sm max-w-md">Choose from 35 free and paid AI providers. Your keys stay in your browser — never sent to our servers.</p>
            <button onClick={onGoToSettings}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-gradient-to-r from-accent-500 to-accent-600 hover:from-accent-600 hover:to-accent-700 text-white font-medium text-sm transition-all shadow-lg shadow-accent-500/25">
              <Keyboard className="w-4 h-4" /> Go to Settings
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold flex items-center gap-2 hero-gradient drop-shadow-md">
            <Sparkles className="w-7 h-7 text-accent-400 animate-pulse" /> AI Text Humanizer
          </h2>
          <p className="text-dark-300 mt-1">Transform AI text into natural, human-like writing</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowShortcuts(!showShortcuts)} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-dark-800 hover:bg-dark-700 text-dark-400 hover:text-white text-sm transition-colors">
            <Keyboard className="w-4 h-4" /> Shortcuts
          </button>
          <button onClick={() => setInputText(SAMPLE_AI_TEXT)} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-dark-800 hover:bg-dark-700 text-dark-400 hover:text-white text-sm transition-colors">
            <Zap className="w-4 h-4" /> Sample
          </button>
          <button onClick={() => setInputText(SAMPLE_TECHNICAL_TEXT)} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-dark-800 hover:bg-dark-700 text-dark-400 hover:text-white text-sm transition-colors">
            <FileText className="w-4 h-4" /> Tech Sample
          </button>
        </div>
      </div>

      {/* First-use keyboard shortcut tooltip */}
      {showShortcutTooltip && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
          <div className="bg-dark-700 border border-accent-500/30 rounded-xl p-4 shadow-2xl max-w-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white mb-2">Quick Start</p>
                <div className="space-y-1 text-xs text-dark-300">
                  <p><kbd className="bg-dark-600 px-1.5 py-0.5 rounded text-accent-300">Ctrl+Enter</kbd> Humanize text</p>
                  <p><kbd className="bg-dark-600 px-1.5 py-0.5 rounded text-accent-300">Ctrl+Shift+C</kbd> Copy result</p>
                  <p><kbd className="bg-dark-600 px-1.5 py-0.5 rounded text-accent-300">Ctrl+1-4</kbd> Switch rewrite level</p>
                </div>
              </div>
              <button onClick={() => setShowShortcutTooltip(false)} className="text-dark-500 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard shortcuts */}
      {showShortcuts && (
        <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-4">
          <h3 className="text-sm font-medium text-white mb-3">⌨️ Keyboard Shortcuts</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            <div className="text-dark-400"><kbd className="bg-dark-700 px-1.5 py-0.5 rounded text-dark-300">Ctrl+Enter</kbd> Humanize</div>
            <div className="text-dark-400"><kbd className="bg-dark-700 px-1.5 py-0.5 rounded text-dark-300">Ctrl+Shift+C</kbd> Copy result</div>
            <div className="text-dark-400"><kbd className="bg-dark-700 px-1.5 py-0.5 rounded text-dark-300">Ctrl+1/2/3/4</kbd> Switch level</div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="space-y-4">
        {/* Style */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-2">Writing Style</label>
            <div className="flex gap-2 flex-wrap">
              {STYLES.map(s => (
                <button key={s.id} onClick={() => setStyle(s.id)}
                  className={`px-2 py-1.5 sm:px-3 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all flex items-center gap-1 ${style === s.id ? 'bg-accent-500 text-white shadow-lg shadow-accent-500/25' : 'bg-dark-800 text-dark-300 hover:text-white hover:bg-dark-700'}`}>
                  <span>{s.icon}</span> {s.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Intensity (stealth strength) */}
        <div>
          <label className="block text-sm font-medium text-dark-300 mb-2">
            Stealth Intensity <span className="text-dark-400 font-normal">— how hard the anti-detector layer pushes</span>
          </label>
          <div className="flex gap-2 flex-wrap">
            {([
              { id: 'light', name: 'Light', icon: '🪶', desc: 'Minimal touch' },
              { id: 'medium', name: 'Medium', icon: '⚖️', desc: 'Balanced' },
              { id: 'aggressive', name: 'Aggressive', icon: '🔥', desc: 'Strong' },
              { id: 'ninja', name: 'Ninja', icon: '🥷', desc: 'Max stealth' },
            ] as { id: Intensity; name: string; icon: string; desc: string }[]).map(opt => (
              <button key={opt.id} onClick={() => setIntensity(opt.id)}
                title={opt.desc}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${
                  intensity === opt.id
                    ? opt.id === 'ninja'
                      ? 'vibrant-gradient text-white shadow-lg shadow-fuchsia-500/30 ninja-glow'
                      : 'vibrant-gradient text-white shadow-lg shadow-accent-500/25'
                    : 'bg-dark-800 text-dark-300 hover:text-white hover:bg-dark-700'
                }`}>
                <span>{opt.icon}</span> {opt.name}
              </button>
            ))}
          </div>
          {intensity === 'ninja' && (
            <p className="text-xs text-fuchsia-300/80 mt-2">
              🥷 Ninja = full stealth cleaning + surgical rewrite of the most AI-like sentences. Tip: pair with the <strong>Local (gemma3)</strong> provider for best evasion — smaller models read as more human.
            </p>
          )}
        </div>

        {/* Advanced Options */}
        <div>
          <button onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-sm text-dark-400 hover:text-white transition-colors">
            {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            Advanced Options
          </button>
          {showAdvanced && (
            <div className="mt-3 space-y-4 animate-fade-in">
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-dark-300 mb-2">
                    <Target className="w-4 h-4 text-accent-400" /> Target Human Score: {targetScore}%
                  </label>
                  <input type="range" min="50" max="100" step="5" value={targetScore} onChange={e => setTargetScore(Number(e.target.value))}
                    className="w-full accent-accent-500" />
                  <div className="flex justify-between text-xs text-dark-500 mt-1"><span>50%</span><span>75%</span><span>100%</span></div>
                </div>
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-dark-300 mb-2">
                    <Type className="w-4 h-4 text-accent-400" /> Max Output Words: {maxOutputWords === 0 ? 'Full length (no cap)' : `Cap at ${maxOutputWords}`}
                  </label>
                  <input type="range" min="0" max="5000" step="100" value={maxOutputWords} onChange={e => setMaxOutputWords(Number(e.target.value))}
                    className="w-full accent-accent-500" />
                  <div className="flex justify-between text-xs text-dark-500 mt-1"><span>No cap — output keeps full input length</span><span>2500</span><span>5000</span></div>
                </div>
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-dark-300 mb-2">
                    <Languages className="w-4 h-4 text-accent-400" /> Language
                  </label>
                  <select value={language} onChange={e => setLanguage(e.target.value)}
                    className="w-full px-3 py-2 bg-dark-800 border border-dark-700/50 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/50">
                    {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-dark-300 mb-2">
                    <Sparkles className="w-4 h-4 text-accent-400" /> Model Selection
                  </label>
                  <select value={preferredModel} onChange={e => setPreferredModel(e.target.value as ModelProvider)}
                    className="w-full px-3 py-2 bg-dark-800 border border-dark-700/50 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/50">
                    {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}{p.free ? ' (Free)' : ''}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-dark-300 mb-2">
                  <Type className="w-4 h-4 text-accent-400" /> Your Writing Sample (optional)
                </label>
                <textarea value={writingSample} onChange={e => setWritingSample(e.target.value)}
                  placeholder="Paste a sample of your own writing here... The AI will match your personal writing style, vocabulary, and sentence patterns. This dramatically improves humanization."
                  className="w-full h-24 p-3 bg-dark-800 border border-dark-700/50 rounded-lg text-white placeholder-dark-500 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent-500/50" />
                <p className="text-xs text-dark-500 mt-1">When provided, the humanized output will match your personal writing style</p>
              </div>

              {/* Pipeline Controls */}
              <div className="border-t border-dark-700/30 pt-4 space-y-4">
                <h4 className="text-sm font-medium text-white flex items-center gap-2">
                  <Zap className="w-4 h-4 text-accent-400" /> Pipeline Engine
                </h4>

                {/* Post-Processing Toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-dark-200">Non-LLM Post-Processing</p>
                    <p className="text-xs text-dark-500">Synonym swaps, collocation replacements, sentence manipulation</p>
                  </div>
                  <button
                    onClick={() => setEnablePostprocess(!enablePostprocess)}
                    className={`relative w-11 h-6 rounded-full transition-colors ${enablePostprocess ? 'bg-accent-500' : 'bg-dark-600'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${enablePostprocess ? 'translate-x-5' : ''}`} />
                  </button>
                </div>

                {/* Multi-Model Chain Toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-dark-200">Multi-Model Chain</p>
                    <p className="text-xs text-dark-500">Pass text through multiple AI models to mix fingerprints</p>
                  </div>
                  <button
                    onClick={() => {
                      const newVal = !enableChain;
                      setEnableChain(newVal);
                      // Default to free models when enabling
                      if (newVal && selectedChainModels.length === 0) {
                        setSelectedChainModels(['gemini', 'groq']);
                      }
                    }}
                    className={`relative w-11 h-6 rounded-full transition-colors ${enableChain ? 'bg-accent-500' : 'bg-dark-600'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${enableChain ? 'translate-x-5' : ''}`} />
                  </button>
                </div>

                {/* Chain Model Selection */}
                {enableChain && (
                  <div className="space-y-2 animate-fade-in">
                    <p className="text-xs text-dark-400">Select models to chain through (requires API keys in Settings):</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {PROVIDERS.filter(p => p.free).map(p => (
                        <label key={p.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors text-xs ${
                          selectedChainModels.includes(p.id)
                            ? 'bg-accent-500/20 border border-accent-500/50 text-accent-300'
                            : 'bg-dark-700/30 border border-dark-700/30 text-dark-400 hover:text-dark-200'
                        }`}>
                          <input
                            type="checkbox"
                            checked={selectedChainModels.includes(p.id)}
                            onChange={e => {
                              if (e.target.checked) {
                                setSelectedChainModels(prev => [...prev, p.id]);
                              } else {
                                setSelectedChainModels(prev => prev.filter(id => id !== p.id));
                              }
                            }}
                            className="accent-accent-500"
                          />
                          <span className="truncate">{p.name}</span>
                          {p.free && <span className="text-green-400 text-[10px]">FREE</span>}
                        </label>
                      ))}
                    </div>
                    {selectedChainModels.length > 0 && (
                      <div className="flex items-center gap-1 text-xs text-dark-400">
                        <span>Pipeline: LLM Rewrite → Post-Process →</span>
                        {selectedChainModels.map((id, i) => {
                          const p = PROVIDERS.find(pr => pr.id === id);
                          return (
                            <span key={id}>
                              {i > 0 ? ' → ' : ''}{p?.name || id}
                            </span>
                          );
                        })}
                        <span>→ Polish</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Pipeline Visual */}
                {(enablePostprocess || enableChain) && (
                  <div className="bg-dark-700/20 rounded-lg p-3">
                    <p className="text-xs text-dark-400 mb-2">Active Pipeline:</p>
                    <div className="flex items-center gap-1 flex-wrap text-xs">
                      <span className="px-2 py-1 rounded bg-accent-500/20 text-accent-300">① LLM Rewrite</span>
                      <span className="text-dark-600">→</span>
                      {enablePostprocess && (
                        <>
                          <span className="px-2 py-1 rounded bg-blue-500/20 text-blue-300">② Post-Process</span>
                          <span className="text-dark-600">→</span>
                        </>
                      )}
                      {enableChain && selectedChainModels.map((id, i) => (
                        <span key={id}>
                          <span className="px-2 py-1 rounded bg-purple-500/20 text-purple-300">③{i > 0 ? '+' + (i+1) : ''} Chain: {PROVIDERS.find(p => p.id === id)?.name}</span>
                          <span className="text-dark-600">→</span>
                        </span>
                      ))}
                      <span className="px-2 py-1 rounded bg-green-500/20 text-green-300">④ Polish</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input/Output */}
      <div className={`grid gap-6 ${showComparison && result ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
        <div>
          {/* Recommended settings callout for first-time users */}
          {isFirstVisit && (
            <div className="mb-3 px-4 py-2.5 rounded-lg bg-accent-500/10 border border-accent-500/20 text-sm text-accent-300 animate-fade-in">
              Recommended: <strong>Humanize</strong> style. Sample text loaded — click Humanize to try it!
            </div>
          )}
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-dark-300">Input Text</label>
            <div className="flex items-center gap-2">
              <span className={`text-xs ${wordCount > 10000 ? 'text-red-400' : 'text-dark-500'}`}>{wordCount} / 10,000 words</span>
              <button onClick={() => fileInputRef.current?.click()} disabled={fileUploading}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-dark-800 hover:bg-dark-700 text-dark-400 hover:text-white transition-colors disabled:opacity-50">
                <Upload className="w-3 h-3" /> {fileUploading ? 'Loading...' : 'Upload File'}
              </button>
              <input ref={fileInputRef} type="file" accept=".txt,.docx,.pdf" className="hidden" onChange={e => e.target.files?.[0] && handleFileUpload(e.target.files[0])} />
            </div>
          </div>
          <p className="text-xs text-dark-500 mb-2">
            💡 Best results: 40–300 words. Expect ~15–40s for ≤150 words; longer texts take proportionally longer (up to ~2 min).
          </p>

          {/* Drop zone */}
          <div className="perspective-container">
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`relative panel-3d hover-lift`}
            >
              {dragOver && (
                <div className="absolute inset-0 z-10 border-2 border-dashed border-accent-400 bg-accent-500/10 rounded-xl flex items-center justify-center">
                  <div className="text-center text-accent-400">
                    <FileUp className="w-8 h-8 mx-auto mb-2" />
                    <p className="text-sm font-medium">Drop file here</p>
                    <p className="text-xs">.txt, .docx, .pdf</p>
                  </div>
                </div>
              )}
              <textarea value={inputText} onChange={e => setInputText(e.target.value)}
                placeholder="Paste your AI-generated text here... or drag & drop a .txt/.docx/.pdf file"
                className="w-full h-64 p-4 glass-card rounded-xl text-white placeholder-dark-500 resize-none focus:outline-none focus:ring-2 focus:ring-accent-500/50 transition-all text-sm leading-relaxed" />
            </div>
          </div>

          <div className="mt-3 grid md:grid-cols-1 gap-2">
            <label className="flex items-center gap-2 rounded-lg bg-dark-800/50 border border-dark-700/50 px-3 py-2 text-xs text-dark-300 w-fit">
              <input type="checkbox" checked={privacyMode} onChange={e => setPrivacyMode(e.target.checked)} className="accent-accent-500" />
              🔒 Privacy Mode (offline local rewrite, no API key)
            </label>
          </div>

          <div className="mt-3">
            <button onClick={handleHumanize} disabled={loading || !inputText.trim()}
              className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-gradient-to-r from-accent-500 to-accent-600 hover:from-accent-400 hover:to-accent-500 text-white font-bold text-lg transition-all shadow-xl shadow-accent-500/20 disabled:opacity-50 disabled:cursor-not-allowed hover-lift hover:shadow-accent-500/40">
              {loading ? (
                <><RefreshCw className="w-5 h-5 animate-spin" /> {pipelineStep || `${progress.message} (Pass ${progress.pass}/${progress.max})`}</>
              ) : (
                <><Sparkles className="w-5 h-5" /> Humanize Text</>
              )}
            </button>
          </div>
          {loading && (
            <div className="mt-3 h-1.5 bg-dark-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-accent-500 to-accent-400 rounded-full progress-bar"
                style={{ width: `${progress.max > 0 ? (progress.pass / progress.max) * 100 : 0}%` }} />
            </div>
          )}
        </div>

        {result && (
          <div>
            {/* Improvement Summary Card */}
            <div className="glass-card rounded-xl p-4 mb-3 animate-fade-in">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-white">Improvement Summary</h3>
                <button onClick={handleCopy} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent-500/20 text-accent-400 hover:bg-accent-500/30 text-xs font-medium transition-colors">
                  <Copy className="w-3 h-3" /> Copy Result
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="text-center">
                  <p className="text-xs text-dark-400 mb-1">Human Score</p>
                  <div className="flex items-center justify-center gap-1">
                    {originalDetection && (
                      <>
                        <span className={`text-sm font-bold ${originalDetection.score >= 70 ? 'text-green-400' : originalDetection.score >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                          {originalDetection.score}%
                        </span>
                        <ArrowRight className="w-3 h-3 text-dark-500" />
                      </>
                    )}
                    <span className={`text-lg font-bold ${detection ? (detection.score >= 70 ? 'text-green-400' : detection.score >= 50 ? 'text-yellow-400' : 'text-red-400') : 'text-dark-200'}`}>
                      {detection?.score || 0}%
                    </span>
                  </div>
                  {scoreChange !== 0 && (
                    <p className={`text-xs mt-0.5 ${scoreChange > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {scoreChange > 0 ? '+' : ''}{scoreChange}pts
                    </p>
                  )}
                </div>
                <div className="text-center">
                  <p className="text-xs text-dark-400 mb-1">Readability</p>
                  {detection && (
                    <div className="flex items-center justify-center gap-1">
                      {originalDetection && (
                        <>
                          <span className="text-sm font-bold text-dark-300">{originalDetection.readability.fleschReadingEase}</span>
                          <ArrowRight className="w-3 h-3 text-dark-500" />
                        </>
                      )}
                      <span className={`text-lg font-bold ${readLabel?.color || 'text-dark-200'}`}>{detection.readability.fleschReadingEase}</span>
                    </div>
                  )}
                  {readLabel && <p className={`text-xs mt-0.5 ${readLabel.color}`}>{readLabel.label}</p>}
                </div>
                <div className="text-center">
                  <p className="text-xs text-dark-400 mb-1">Word Count</p>
                  <div className="flex items-center justify-center gap-1">
                    <span className="text-sm font-bold text-dark-300">{result.wordCount.input}</span>
                    <ArrowRight className="w-3 h-3 text-dark-500" />
                    <span className="text-lg font-bold text-dark-200">{result.wordCount.output}</span>
                  </div>
                  <p className="text-xs mt-0.5 text-dark-500">
                    {result.wordCount.input > 0 ? (((result.wordCount.output - result.wordCount.input) / result.wordCount.input) * 100).toFixed(0) : 0}% change
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-dark-400 mb-1">Passes</p>
                  <p className="text-lg font-bold text-accent-400">{result.passes}</p>
                  <p className="text-xs mt-0.5 text-dark-500">{result.modelName}</p>
                </div>
              </div>
              {detection?.confidenceInterval && (
                <p className="text-xs text-dark-500 mt-2 text-center">
                  Confidence interval: {detection.confidenceInterval.lower}% — {detection.confidenceInterval.upper}%
                </p>
              )}
              {result.semanticFidelity && (
                <div className="mt-4 rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-white">Semantic fidelity: <span className="text-blue-300">{result.semanticFidelity.score}%</span> ({result.semanticFidelity.verdict})</p>
                    <p className="text-xs text-dark-300">Keywords {result.semanticFidelity.keywordRecall}% • Entities {result.semanticFidelity.entityRecall}% • Numbers {result.semanticFidelity.numberRecall}% • Negation {result.semanticFidelity.negationConsistency}%</p>
                  </div>
                  {result.semanticFidelity.warnings.length > 0 && <p className="text-xs text-yellow-300 mt-2">⚠ {result.semanticFidelity.warnings.join(' ')}</p>}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-dark-300">
                Humanized Output
                {detection && (
                  <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${
                    detection.score >= 70 ? 'bg-green-500/20 text-green-400' : detection.score >= 50 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'
                  }`}>
                    ~{detection.score}% Human ({result.passes} pass{result.passes > 1 ? 'es' : ''})
                  </span>
                )}
              </label>
              <div className="flex items-center gap-1 flex-wrap">
                <button onClick={() => setShowComparison(!showComparison)} className="p-2 rounded-lg hover:bg-dark-700/50 text-dark-400 hover:text-white transition-colors" title="Compare view">
                  <Eye className="w-4 h-4" />
                </button>
                <button onClick={() => setShowReadability(!showReadability)} className="p-2 rounded-lg hover:bg-dark-700/50 text-dark-400 hover:text-white transition-colors" title="Readability">
                  <Type className="w-4 h-4" />
                </button>
                <button onClick={() => setShowHeatmap(!showHeatmap)} className={`p-2 rounded-lg hover:bg-dark-700/50 transition-colors ${showHeatmap ? 'text-orange-400' : 'text-dark-400 hover:text-white'}`} title="Detection Heatmap">
                  <BarChart2 className="w-4 h-4" />
                </button>
                <button onClick={handleCopy} className="p-2 rounded-lg hover:bg-dark-700/50 text-dark-400 hover:text-white transition-colors" title="Copy">
                  <Copy className="w-4 h-4" />
                </button>
                <button onClick={() => handleDownload('txt')} className="p-2 rounded-lg hover:bg-dark-700/50 text-dark-400 hover:text-white transition-colors" title="TXT">
                  <FileText className="w-4 h-4" />
                </button>
                <button onClick={() => handleDownload('docx')} className="p-2 rounded-lg hover:bg-dark-700/50 text-dark-400 hover:text-white transition-colors" title="DOCX">
                  <FileDown className="w-4 h-4" />
                </button>
                <button onClick={() => handleDownload('md')} className="p-2 rounded-lg hover:bg-dark-700/50 text-dark-400 hover:text-white transition-colors" title="Markdown">
                  <FileText className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="w-full h-64 p-4 glass-card rounded-xl text-white overflow-y-auto">
              {showComparison ? (
                <div className="space-y-3">
                  {result.sentences.filter(s => s.original).map((s, i) => {
                    const score = s.detectionScore ?? 50;
                    const isFlagged = score < 60;
                    return (
                      <div key={i} className="group">
                        <p className="text-dark-500 text-xs line-through mb-1">{s.original}</p>
                        <div className={`sentence-highlight cursor-pointer p-1.5 rounded border flex items-start justify-between gap-2 ${
                          !isFlagged ? 'border-green-500/30' : score >= 40 ? 'border-yellow-500/30' : 'border-red-500/30'
                        }`} onClick={() => handleGetAlternatives(i)}>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-dark-200">{s.humanized}</p>
                            {s.detectionScore !== undefined && (
                              <span className={`text-xs ${s.detectionScore >= 60 ? 'text-green-400' : s.detectionScore >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>
                                {s.detectionScore}% {isFlagged && '⚠'} •
                              </span>
                            )}
                            <ChevronDown className="w-3 h-3 inline text-dark-500 group-hover:text-accent-400" />
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(s.humanized); showToast('success', 'Sentence copied!'); }}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-dark-600/50 text-dark-400 hover:text-white transition-all shrink-0"
                            title="Copy sentence"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                        {expandedSentence === i && alternatives[i] && (
                          <div className="ml-4 mt-1 space-y-1">
                            {alternatives[i].map((alt, j) => (
                              <button key={j} onClick={() => handleSelectAlternative(i, alt)}
                                className="block w-full text-left text-xs text-dark-300 hover:text-accent-400 px-2 py-1 rounded hover:bg-dark-700/50 transition-colors">
                                → {alt}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: getHighlightedText(result.fullText, detection?.sentences || []) }} />
              )}
            </div>

            {/* Action buttons after humanization */}
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex gap-2 flex-wrap">
                <button onClick={handleRehumanize} disabled={rehumanizing || flaggedCount === 0}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-yellow-500/15 text-yellow-300 hover:bg-yellow-500/25 border border-yellow-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  <RotateCcw className={`w-4 h-4 ${rehumanizing ? 'animate-spin' : ''}`} />
                  {rehumanizing ? 'Refining…' : `Refine further (${flaggedCount} flagged)`}
                </button>
                <button onClick={handleGrammarCheck} disabled={grammarChecking}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-500/15 text-blue-300 hover:bg-blue-500/25 border border-blue-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  <CheckCircle className={`w-4 h-4 ${grammarChecking ? 'animate-spin' : ''}`} />
                  {grammarChecking ? 'Checking…' : 'Grammar check'}
                </button>
                <button onClick={handleExportPDF}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-dark-700/60 text-dark-200 hover:bg-dark-700 border border-dark-600/50 transition-colors">
                  <Download className="w-4 h-4" /> Export PDF
                </button>
                <button onClick={() => setShowComparisonChart(!showComparisonChart)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-dark-700/60 text-dark-200 hover:bg-dark-700 border border-dark-600/50 transition-colors">
                  <BarChart2 className="w-4 h-4" /> Compare chart
                </button>
              </div>

              {/* Verify online — external detectors, no API key required */}
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="text-dark-500">Verify with an external detector:</span>
                <a href="https://gptzero.me" target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium bg-dark-700/60 text-dark-200 hover:text-white hover:bg-dark-700 border border-dark-600/50 transition-colors">
                  <Shield className="w-3.5 h-3.5" /> GPTZero
                </a>
                <a href="https://zerogpt.com" target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium bg-dark-700/60 text-dark-200 hover:text-white hover:bg-dark-700 border border-dark-600/50 transition-colors">
                  <Shield className="w-3.5 h-3.5" /> ZeroGPT
                </a>
                <a href="https://copyleaks.com/ai-content-detector" target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium bg-dark-700/60 text-dark-200 hover:text-white hover:bg-dark-700 border border-dark-600/50 transition-colors">
                  <Shield className="w-3.5 h-3.5" /> Copyleaks
                </a>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Grammar Issues Panel */}
      {grammarIssues.length > 0 && (
        <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-4 animate-fade-in">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-400" /> Grammar Issues ({grammarIssues.length})
            </h3>
            <div className="flex gap-2">
              <button onClick={handleApplyGrammarFix}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors">
                <CheckCircle className="w-3 h-3" /> Apply All Fixes
              </button>
              <button onClick={() => { setGrammarIssues([]); setCorrectedText(''); }}
                className="p-1.5 rounded-lg hover:bg-dark-700/50 text-dark-400 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {grammarIssues.map((issue, i) => (
              <div key={i} className="bg-dark-700/30 rounded-lg p-3 text-sm">
                <div className="flex items-start gap-2">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                    issue.type === 'spelling' ? 'bg-red-500/20 text-red-400' :
                    issue.type === 'grammar' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-blue-500/20 text-blue-400'
                  }`}>{issue.type}</span>
                  <div className="flex-1">
                    <p className="text-dark-300"><span className="line-through text-red-400/60">{issue.original}</span> → <span className="text-green-400">{issue.suggestion}</span></p>
                    <p className="text-dark-500 text-xs mt-1">{issue.explanation}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Readability Panel */}
      {showReadability && detection && (
        <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-4 animate-fade-in">
          <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
            <Type className="w-4 h-4 text-accent-400" /> Readability Analysis
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-dark-700/30 rounded-lg p-3 text-center">
              <p className={`text-xl font-bold ${readLabel?.color || 'text-dark-200'}`}>{detection.readability.fleschReadingEase}</p>
              <p className="text-xs text-dark-400">Flesch Reading Ease</p>
              <p className={`text-xs mt-1 ${readLabel?.color || 'text-dark-500'}`}>{readLabel?.label}</p>
            </div>
            <div className="bg-dark-700/30 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-dark-200">{detection.readability.fleschKincaidGrade}</p>
              <p className="text-xs text-dark-400">Grade Level</p>
              <p className="text-xs text-dark-500 mt-1">{detection.readability.fleschKincaidGrade <= 12 ? 'Accessible' : 'Advanced'}</p>
            </div>
            <div className="bg-dark-700/30 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-dark-200">{detection.readability.avgWordsPerSentence}</p>
              <p className="text-xs text-dark-400">Avg Words/Sentence</p>
            </div>
            <div className="bg-dark-700/30 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-dark-200">{detection.readability.readingTimeMinutes}m</p>
              <p className="text-xs text-dark-400">Reading Time</p>
            </div>
          </div>
          <p className="text-xs text-dark-500 mt-3">Estimated score based on local heuristics. Real detectors (GPTZero, Originality.ai) may differ.</p>
        </div>
      )}

      {/* Detection Heatmap */}
      {showHeatmap && detection && (
        <div className="bg-dark-800/50 border border-orange-500/20 rounded-xl p-4 animate-fade-in">
          <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-orange-400" /> Detection Heatmap — Sentence-Level AI Scores
          </h3>
          <div className="space-y-1.5">
            {detection.sentences.map((s, i) => {
              const pct = Math.max(0, Math.min(100, s.score));
              const hue = pct * 1.2;
              const bgColor = `hsla(${hue}, 70%, 50%, 0.15)`;
              const borderColor = `hsla(${hue}, 70%, 50%, 0.4)`;
              const textColor = pct >= 60 ? 'text-green-400' : pct >= 40 ? 'text-yellow-400' : 'text-red-400';
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className={`text-xs font-mono w-8 text-right shrink-0 ${textColor}`}>{pct}%</span>
                  <div className="flex-1 rounded px-2 py-1.5 overflow-hidden" style={{ backgroundColor: bgColor, borderLeft: `3px solid ${borderColor}` }}>
                    <p className="text-xs text-dark-200 truncate">{s.text}</p>
                  </div>
                  <span className="text-[10px] text-dark-500 shrink-0 w-8 text-right">
                    {s.classification === 'human' ? '✓' : s.classification === 'maybe' ? '~' : '✗'}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2 mt-3 text-[10px] text-dark-500">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500/30 border border-green-500/50" /> Human (60%+)</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-500/30 border border-yellow-500/50" /> Maybe (35-59%)</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500/30 border border-red-500/50" /> AI (&lt;35%)</span>
          </div>
        </div>
      )}


      {/* Phase 4: Comparison chart */}
      {result && showComparisonChart && (
        <div className="bg-dark-800/50 border border-green-500/20 rounded-xl p-4 animate-fade-in">
          <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-green-400" /> Original vs Humanized — Word & Character Comparison
          </h3>
          <ComparisonChart
            data={[
              { name: 'Words', Original: result.wordCount.input, Humanized: result.wordCount.output },
              { name: 'Characters', Original: inputText.length, Humanized: result.fullText.length },
              { name: 'Sentences', Original: inputText.split(/[.!?]+/).filter(s => s.trim()).length, Humanized: result.sentences.length },
            ]}
          />
        </div>
      )}

      {/* Run details — slim footer bar (non-redundant with the Improvement Summary) */}
      {result && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-dark-400 px-1 animate-fade-in">
          <span className="flex items-center gap-1.5">
            <span className="text-dark-500">Model:</span>
            <span className="text-dark-200 font-medium">{result.modelName}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-dark-500">Passes:</span>
            <span className="text-dark-200 font-medium">{result.passes}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-dark-500">Confidence:</span>
            <span className="text-dark-200 font-medium">
              {typeof result.confidenceReport?.confidence === 'number' ? `${result.confidenceReport.confidence}%` : 'N/A'}
            </span>
          </span>
          {typeof result.observability?.estimatedCostUsd === 'number' && result.observability.estimatedCostUsd > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="text-dark-500">Est. cost:</span>
              <span className="text-dark-200 font-medium">${result.observability.estimatedCostUsd.toFixed(4)}</span>
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span className="text-dark-500">Fallback guard:</span>
            <span className={`font-medium ${result.fallbackBehavior?.used ? 'text-yellow-400' : 'text-green-400'}`}>
              {result.fallbackBehavior?.used ? 'engaged' : 'not needed'}
            </span>
          </span>
        </div>
      )}

      {/* Independent AI-detector verdict — fires after every successful humanize
          so the user can see how a real RoBERTa-based detector scores the output.
          This is separate from the heuristic `finalScore` above. */}
      {result && (postDetectLoading || postDetect || postDetectError) && (
        <div className="bg-dark-800/40 border border-dark-700/40 rounded-xl p-4 animate-fade-in">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-white flex items-center gap-2">
              <Shield className="w-4 h-4 text-accent-400" />
              AI Detector Verdict
              <span className="text-xs font-normal text-dark-500">(independent of the heuristic score)</span>
            </h4>
            {postDetect?.source === 'rudra' && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                hosted RoBERTa · free
              </span>
            )}
          </div>
          {postDetectLoading && (
            <p className="text-sm text-dark-400">Running detector on the humanized text…</p>
          )}
          {postDetectError && !postDetectLoading && (
            <p className="text-sm text-yellow-400">Detector unavailable: {postDetectError}</p>
          )}
          {postDetect && !postDetectLoading && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-dark-500 mb-1">Verdict</div>
                <div className={`text-2xl font-bold ${postDetect.label === 'human' ? 'text-green-400' : 'text-red-400'}`}>
                  {postDetect.label === 'human' ? 'Likely Human' : 'Likely AI'}
                </div>
              </div>
              <div>
                <div className="text-xs text-dark-500 mb-1">AI probability</div>
                <div className="text-2xl font-bold text-white">
                  {(postDetect.aiProbability * 100).toFixed(1)}%
                </div>
                <div className="text-xs text-dark-500 mt-1">
                  Human: {(postDetect.humanProbability * 100).toFixed(1)}% · {postDetect.model}
                  {postDetect.elapsedMs > 0 && ` · ${postDetect.elapsedMs}ms`}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!result && !inputText && (
        <div className="bg-dark-800/30 border border-dark-700/30 rounded-xl p-8 text-center">
          <ArrowRight className="w-8 h-8 text-accent-400 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-white mb-2">Ready to Humanize</h3>
          <div className="grid md:grid-cols-3 gap-4 mt-4 text-dark-400 text-sm">
            <div>
              <div className="w-8 h-8 rounded-full bg-accent-500/20 text-accent-400 flex items-center justify-center mx-auto mb-2 text-sm font-bold">1</div>
              <p>Paste text or upload a file</p>
              <p className="text-xs mt-1 text-dark-500">.txt, .docx, .pdf supported</p>
            </div>
            <div>
              <div className="w-8 h-8 rounded-full bg-accent-500/20 text-accent-400 flex items-center justify-center mx-auto mb-2 text-sm font-bold">2</div>
              <p>Choose  style, and tone</p>
              <p className="text-xs mt-1 text-dark-500">🧑 Humanize is recommended</p>
            </div>
            <div>
              <div className="w-8 h-8 rounded-full bg-accent-500/20 text-accent-400 flex items-center justify-center mx-auto mb-2 text-sm font-bold">3</div>
              <p>Get human-sounding text back</p>
              <p className="text-xs mt-1 text-dark-500">Re-humanize flagged sentences</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
