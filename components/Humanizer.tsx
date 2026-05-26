'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Sparkles, Copy, Download, FileText, RefreshCw, Zap, Eye,
  FileDown, Target, ChevronDown, ChevronUp, Keyboard, ArrowRight,
  Type, Languages, Upload, RotateCcw, CheckCircle, AlertTriangle,
  X, FileUp, BarChart2, Shield
} from 'lucide-react';
import { RewriteLevel, StylePreset, TonePreset, TextPurpose, HumanizationResult, ModelProvider } from '@/lib/types';
import { TONE_CONFIGS, SAMPLE_AI_TEXT, SAMPLE_TECHNICAL_TEXT, PURPOSE_CONFIGS } from '@/lib/prompts';
import { detectAI, getScoreColor, getScoreBarColor } from '@/lib/detector';
import { getReadabilityLabel } from '@/lib/readability';
import { countWords, downloadAsTxt, downloadAsDocx, downloadAsMarkdown, getApiKeys } from '@/lib/storage';
import { WEB_PROVIDERS as PROVIDERS } from '@/lib/providers';
import dynamic from 'next/dynamic';

const ComparisonChart = dynamic(
  () => import('./ComparisonChart'),
  { ssr: false, loading: () => <div className="h-[220px] bg-dark-800/50 rounded-xl animate-pulse" /> },
);

const REWRITE_LEVELS: { id: RewriteLevel; name: string; desc: string }[] = [
  { id: 'light', name: '🪶 Light', desc: 'Subtle fixes' },
  { id: 'medium', name: '✨ Medium', desc: 'Noticeable rewrite' },
  { id: 'aggressive', name: '🔥 Aggressive', desc: 'Complete rewrite' },
  { id: 'ninja', name: '🥷 Ninja', desc: 'Maximum stealth' },
];

const STYLES: { id: StylePreset; name: string; icon: string }[] = [
  { id: 'humanize', name: 'Humanize', icon: '🧑' },
  { id: 'academic', name: 'Academic', icon: '🎓' },
  { id: 'professional', name: 'Professional', icon: '💼' },
  { id: 'casual', name: 'Casual', icon: '☕' },
  { id: 'creative', name: 'Creative', icon: '🎨' },
  { id: 'technical', name: 'Technical', icon: '⚙️' },
];

const TONES: { id: TonePreset; name: string; emoji: string }[] = [
  { id: 'academic-formal', name: 'Academic Formal', emoji: '🎓' },
  { id: 'academic-casual', name: 'Academic Casual', emoji: '📚' },
  { id: 'journalistic', name: 'Journalistic', emoji: '📰' },
  { id: 'creative-writing', name: 'Creative', emoji: '✍️' },
  { id: 'conversational', name: 'Conversational', emoji: '💬' },
  { id: 'professional', name: 'Professional', emoji: '💼' },
  { id: 'technical', name: 'Technical', emoji: '⚙️' },
  { id: 'persuasive', name: 'Persuasive', emoji: '🎯' },
  { id: 'storytelling', name: 'Storytelling', emoji: '📖' },
  { id: 'humorous', name: 'Humorous', emoji: '😂' },
  { id: 'emotional', name: 'Emotional', emoji: '❤️' },
  { id: 'analytical', name: 'Analytical', emoji: '🔬' },
  { id: 'custom', name: 'Custom', emoji: '🎨' },
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

const PURPOSES: { id: TextPurpose; name: string; icon: string }[] = [
  { id: 'general', name: 'General', icon: 'Type' },
  { id: 'essay', name: 'Essay', icon: 'FileText' },
  { id: 'article', name: 'Article', icon: 'Newspaper' },
  { id: 'blog', name: 'Blog', icon: 'PenLine' },
  { id: 'email', name: 'Email', icon: 'Mail' },
  { id: 'marketing', name: 'Marketing', icon: 'Megaphone' },
  { id: 'report', name: 'Report', icon: 'BarChart3' },
  { id: 'story', name: 'Story', icon: 'BookOpen' },
  { id: 'social-media', name: 'Social', icon: 'Share2' },
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
  const [level, setLevel] = useState<RewriteLevel>('medium');
  const [style, setStyle] = useState<StylePreset>('humanize');
  const [tone, setTone] = useState<TonePreset>('conversational');
  const [customTone, setCustomTone] = useState('');
  const [purpose, setPurpose] = useState<TextPurpose>('general');
  const [language, setLanguage] = useState('auto');
  const [targetScore, setTargetScore] = useState(80);
  const [expandedSentence, setExpandedSentence] = useState<number | null>(null);
  const [alternatives, setAlternatives] = useState<Record<number, string[]>>({});
  const [showComparison, setShowComparison] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(true);
  const [showReadability, setShowReadability] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

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
  const [preferredModel, setPreferredModel] = useState<ModelProvider>('gemini');

  // GPTZero detection scores (Phase 2)
  const [gptzeroOriginal, setGptzeroOriginal] = useState<number | null>(null);
  const [gptzeroHumanized, setGptzeroHumanized] = useState<number | null>(null);
  const [gptzeroLoading, setGptzeroLoading] = useState(false);
  const [gptzeroUnavailable, setGptzeroUnavailable] = useState(false);

  // Comparison chart visibility (Phase 4)
  const [showComparisonChart, setShowComparisonChart] = useState(false);

  // Word count limit
  const [maxOutputWords, setMaxOutputWords] = useState(0); // 0 = no limit

  // Heatmap mode
  const [showHeatmap, setShowHeatmap] = useState(false);

  const wordCount = countWords(inputText);
  const hasAnyApiKey = Object.values(getApiKeys()).some(v => v && v.trim().length > 0);

  useEffect(() => {
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
      if (e.ctrlKey && e.key === '1') { e.preventDefault(); setLevel('light'); }
      if (e.ctrlKey && e.key === '2') { e.preventDefault(); setLevel('medium'); }
      if (e.ctrlKey && e.key === '3') { e.preventDefault(); setLevel('aggressive'); }
      if (e.ctrlKey && e.key === '4') { e.preventDefault(); setLevel('ninja'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [inputText, result, level]);

  const getApiCredentials = () => {
    const keys = Object.fromEntries(
      Object.entries(getApiKeys()).map(([provider, key]) => [provider, key?.trim()])
    ) as Record<string, string | undefined>;
    const providerId = (keys[preferredModel] ? preferredModel : Object.keys(keys).find(k => keys[k]?.trim()) || 'gemini') as ModelProvider;
    const apiKey = keys[providerId];
    return { providerId, apiKey };
  };

  const handleHumanize = useCallback(async () => {
    if (!inputText.trim()) { showToast('warning', 'Please enter some text to humanize.'); return; }
    if (wordCount > 10000) { showToast('warning', 'Maximum 10,000 words per input.'); return; }
    const { providerId, apiKey } = getApiCredentials();
    if (!apiKey) { showToast('warning', 'Please add an API key in Settings first. Gemini is free!'); return; }

    setLoading(true);
    setResult(null);
    setGrammarIssues([]);
    setCorrectedText('');
    setPipelineStep('Step 1: LLM Rewrite...');
    setProgress({ pass: 0, max: level === 'ninja' ? 3 : level === 'aggressive' ? 3 : 2, message: 'Layer 1: LLM Rewrite...' });

    try {
      // Get all available API keys
      const allApiKeys = Object.fromEntries(
        Object.entries(getApiKeys()).map(([provider, key]) => [provider, key?.trim()])
      );

      const response = await fetch('/api/humanize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: inputText, level, style, tone, customTone,
          model: providerId, apiKey, targetScore, language, writingSample, purpose,
          maxOutputWords: maxOutputWords || undefined,
          postprocess: enablePostprocess,
          chainModels: enableChain ? selectedChainModels : [],
          apiKeys: allApiKeys,
        }),
      });
      if (!response.ok) { const err = await response.json(); throw new Error(err.error || 'Failed'); }
      const data = await response.json();
      setResult(data);
      setPipelineStep('');
      setProgress({ pass: 1, max: 1, message: 'Done!' });

      const conf = data?.confidenceReport?.confidence;
      const scoreMsg = data.finalScore >= 70 ? `🎉 ${data.finalScore}% human!` : `Score: ${data.finalScore}% human`;
      const confMsg = typeof conf === 'number' ? ` | Confidence: ${conf}%` : '';
      showToast('success', `Done with ${data.modelName} (${data.passes} pass${data.passes > 1 ? 'es' : ''}) — ${scoreMsg}`);
      if (confMsg) showToast('info', `Detector confidence${confMsg}`);

      // Auto-continue: if score < 100%, start rehumanize loop automatically
      if (data.finalScore < 90) {
        showToast('info', `Score ${data.finalScore}% — auto-refining to 90%+...`);
        // Don't setLoading(false) yet — autoRehumanize will handle it
        await autoRehumanize(data);
      } else {
        showToast('success', `🎯 90%+ human on first pass!`);
        navigator.clipboard.writeText(data.fullText).catch(() => {});
        setLoading(false);
        setProgress({ pass: 0, max: 0, message: '' });
      }
    } catch (err: any) {
      showToast('error', err.message || 'Something went wrong');
      setLoading(false);
      setProgress({ pass: 0, max: 0, message: '' });
    }
  }, [inputText, level, style, tone, customTone, language, targetScore, showToast, wordCount, preferredModel, writingSample, purpose, enablePostprocess, enableChain, selectedChainModels, maxOutputWords]);

  const handleCopy = () => { if (result) { navigator.clipboard.writeText(result.fullText); showToast('success', 'Copied!'); } };
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
      const resp = await fetch('/api/alternative', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ original: sentence.original, current: sentence.humanized, level, style, tone, customTone, model: providerId, apiKey }),
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
      const resp = await fetch('/api/upload', { method: 'POST', body: formData });
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

  // Auto-continue rehumanization until 100% (called after initial humanize)
  const autoRehumanize = async (initialResult: any) => {
    const { providerId, apiKey } = getApiCredentials();
    if (!apiKey) return;

    setRehumanizing(true);
    let currentFullText = initialResult.fullText;
    let currentScore = initialResult.finalScore;
    let round = 0;
    const maxRounds = 8;

    try {
      while (currentScore < 90 && round < maxRounds) {
        round++;
        setPipelineStep(`Refining round ${round}... (${currentScore}% → targeting 90%)`);
        setProgress({ pass: round, max: maxRounds, message: `Round ${round} — ${currentScore}%` });
        showToast('info', `🔄 Round ${round}... current: ${currentScore}%`);

        const detection = detectAI(currentFullText);
        const flagged = detection.sentences.filter((s: any) => s.classification !== 'human').map((s: any) => s.text);
        if (flagged.length === 0) break;

        const resp = await fetch('/api/rehumanize', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            flaggedSentences: flagged, level: 'ninja', style, tone, customTone,
            model: providerId, apiKey, fullText: currentFullText,
          }),
        });
        if (!resp.ok) break;
        const data = await resp.json();
        const candidateText = data.fullText;
        const newDetection = detectAI(candidateText);
        const newScore = newDetection.score;

        if (newScore >= currentScore) {
          currentFullText = candidateText;
          currentScore = newScore;
        } else {
          showToast('warning', `Stopped auto-refine: round ${round} would reduce score (${currentScore}% → ${newScore}%).`);
          break;
        }
      }

      const finalDetection = detectAI(currentFullText);
      const origSentences = initialResult.sentences.map((s: any) => s.original);
      const newSentencesSplit = currentFullText.match(/[^.!?]+[.!?]+[\s]*/g)?.map((s: string) => s.trim()).filter((s: string) => s.length > 0) || [currentFullText.trim()];
      const maxLen = Math.max(origSentences.length, newSentencesSplit.length);
      const sentences = [];
      for (let i = 0; i < maxLen; i++) {
        sentences.push({
          original: origSentences[i] || '', humanized: newSentencesSplit[i] || '',
          alternatives: [], index: i, detectionScore: finalDetection.sentences[i]?.score,
        });
      }

      setResult({
        ...initialResult, sentences, fullText: currentFullText,
        passes: initialResult.passes + round,
        finalScore: finalDetection.score,
        wordCount: { ...initialResult.wordCount, output: countWords(currentFullText) },
      });
      setPipelineStep('');

      navigator.clipboard.writeText(currentFullText).catch(() => {});
      if (finalDetection.score < 90) {
        setShowComparison(true);
      }
      if (finalDetection.score >= 90) {
        showToast('success', `🎯 90%+ human achieved in ${initialResult.passes + round} total passes!`);
      } else {
        showToast('info', `Refined ${round} rounds → ${finalDetection.score}% human. Click rehumanize for more.`);
      }
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setRehumanizing(false);
      setLoading(false);
      setProgress({ pass: 0, max: 0, message: '' });
    }
  };

  // Re-humanize flagged sentences (manual trigger)
  const handleRehumanize = async () => {
    if (!result) return;
    const { providerId, apiKey } = getApiCredentials();
    if (!apiKey) { showToast('warning', 'No API key configured'); return; }

    setRehumanizing(true);
    let currentFullText = result.fullText;
    let currentScore = result.finalScore;
    let round = 0;
    const maxRounds = 8;

    try {
      while (currentScore < 90 && round < maxRounds) {
        round++;
        setProgress({ pass: round, max: maxRounds, message: `Round ${round} — ${currentScore}%` });
        showToast('info', `Re-humanizing round ${round}... (current: ${currentScore}%)`);

        const detection = detectAI(currentFullText);
        const flagged = detection.sentences.filter((s: any) => s.classification !== 'human').map((s: any) => s.text);
        if (flagged.length === 0) break;

        const resp = await fetch('/api/rehumanize', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            flaggedSentences: flagged, level: 'ninja', style, tone, customTone,
            model: providerId, apiKey, fullText: currentFullText,
          }),
        });
        if (!resp.ok) break;
        const data = await resp.json();

        const candidateText = data.fullText;
        const newDetection = detectAI(candidateText);
        const newScore = newDetection.score;
        if (newScore >= currentScore) {
          currentFullText = candidateText;
          currentScore = newScore;
        } else {
          showToast('warning', `Stopped: round ${round} would reduce score (${currentScore}% → ${newScore}%).`);
          break;
        }
      }

      const finalDetection = detectAI(currentFullText);
      const origSentences = result.sentences.map((s: any) => s.original);
      const newSentencesSplit = currentFullText.match(/[^.!?]+[.!?]+[\s]*/g)?.map((s: string) => s.trim()).filter((s: string) => s.length > 0) || [currentFullText.trim()];
      const maxLen = Math.max(origSentences.length, newSentencesSplit.length);
      const sentences = [];
      for (let i = 0; i < maxLen; i++) {
        sentences.push({
          original: origSentences[i] || '',
          humanized: newSentencesSplit[i] || '',
          alternatives: [], index: i,
          detectionScore: finalDetection.sentences[i]?.score,
        });
      }

      setResult({
        ...result,
        sentences,
        fullText: currentFullText,
        passes: result.passes + round,
        finalScore: finalDetection.score,
        wordCount: { ...result.wordCount, output: countWords(currentFullText) },
      });

      navigator.clipboard.writeText(currentFullText).catch(() => {});
      if (finalDetection.score < 90) {
        setShowComparison(true);
      }
      if (finalDetection.score >= 90) {
        showToast('success', `🎯 90%+ human in ${round} round${round > 1 ? 's' : ''}!`);
      } else if (round >= maxRounds) {
        showToast('info', `Re-humanized ${round} rounds → ${finalDetection.score}% human (max rounds reached)`);
      } else {
        showToast('success', `Re-humanized ${round} round${round > 1 ? 's' : ''} → ${finalDetection.score}% human`);
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
    if (!apiKey) { showToast('warning', 'No API key configured'); return; }

    setGrammarChecking(true);
    try {
      const resp = await fetch('/api/grammar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: result.fullText, model: providerId, apiKey }),
      });
      if (!resp.ok) throw new Error('Grammar check failed');
      const data = await resp.json();
      setGrammarIssues(data.issues || []);
      setCorrectedText(data.correctedText || result.fullText);
      if (data.issues.length === 0) {
        showToast('success', 'No grammar issues found! ✅');
      } else {
        showToast('info', `Found ${data.issues.length} issue(s)`);
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

  // Phase 2: GPTZero detection
  const handleGPTZeroDetect = async () => {
    if (!result) return;
    setGptzeroLoading(true);
    setGptzeroUnavailable(false);
    try {
      const [origRes, humRes] = await Promise.all([
        fetch('/api/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: inputText }) }),
        fetch('/api/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: result.fullText }) }),
      ]);

      if (origRes.status === 503 || humRes.status === 503) {
        setGptzeroUnavailable(true);
        showToast('warning', 'GPTZero API key not configured. Set GPTZERO_API_KEY to enable.');
        return;
      }

      const [origData, humData] = await Promise.all([origRes.json(), humRes.json()]);
      // Handle both old and new response formats
      const origPayload = origData.data ?? origData;
      const humPayload = humData.data ?? humData;
      const origScore = typeof origPayload.score === 'number' ? Math.round(origPayload.score * 100) : null;
      const humScore = typeof humPayload.score === 'number' ? Math.round(humPayload.score * 100) : null;
      setGptzeroOriginal(origScore);
      setGptzeroHumanized(humScore);
      showToast('success', 'GPTZero scores loaded!');
    } catch {
      showToast('error', 'GPTZero detection failed.');
    } finally {
      setGptzeroLoading(false);
    }
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
          gptzeroOriginal,
          gptzeroHumanized,
        },
        date: new Date().toLocaleString(),
      });
      showToast('success', 'PDF exported!');
    } catch {
      showToast('error', 'PDF export failed.');
    }
  };

  const getHighlightedText = (fullText: string, sentences: any[]) => {
    const sorted = [...sentences]
      .filter((s: any) => s.text?.trim().length > 0 && s.score < 60)
      .sort((a: any, b: any) => b.text.length - a.text.length);
    let html = fullText;
    for (const sentence of sorted) {
      const bgStyle = sentence.score < 35
        ? 'background:rgba(239,68,68,0.2);border-radius:3px;padding:0 2px;'
        : 'background:rgba(234,179,8,0.2);border-radius:3px;padding:0 2px;';
      html = html.replace(sentence.text, `<span style="${bgStyle}" title="AI Score: ${sentence.score}%">${sentence.text}</span>`);
    }
    return html;
  };

  const detection = result ? detectAI(result.fullText) : null;
  const originalDetection = result ? detectAI(inputText) : null;
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
            <p className="text-dark-400 text-sm max-w-md">Choose from 13 free and paid AI providers. Your keys stay in your browser — never sent to our servers.</p>
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
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-accent-400" /> AI Text Humanizer
          </h2>
          <p className="text-dark-400 mt-1">Transform AI text into natural, human-like writing</p>
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
        {/* Rewrite Level */}
        <div>
          <label className="block text-sm font-medium text-dark-300 mb-2">Rewrite Level</label>
          <div className="flex gap-2 flex-wrap">
            {REWRITE_LEVELS.map(l => (
              <button key={l.id} onClick={() => setLevel(l.id)}
                className={`px-3 py-2 sm:px-4 sm:py-2.5 rounded-lg text-xs sm:text-sm font-medium transition-all flex-1 sm:flex-none min-w-0 ${level === l.id ? 'bg-accent-500 text-white shadow-lg shadow-accent-500/25' : 'bg-dark-800 text-dark-300 hover:text-white hover:bg-dark-700'}`}>
                {l.name} <span className="hidden sm:inline text-xs opacity-70">{l.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Style + Purpose + Tone */}
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
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-2">Purpose</label>
            <div className="flex gap-2 flex-wrap">
              {PURPOSES.map(p => (
                <button key={p.id} onClick={() => setPurpose(p.id)}
                  className={`px-2 py-1.5 sm:px-3 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all flex items-center gap-1 ${purpose === p.id ? 'bg-accent-500 text-white shadow-lg shadow-accent-500/25' : 'bg-dark-800 text-dark-300 hover:text-white hover:bg-dark-700'}`}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-2">Tone</label>
            <select value={tone} onChange={e => setTone(e.target.value as TonePreset)}
              className="w-full px-3 py-2 bg-dark-800 border border-dark-700/50 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/50">
              {TONES.map(t => <option key={t.id} value={t.id}>{t.emoji} {t.name}</option>)}
            </select>
          </div>
        </div>

        {/* Custom Tone */}
        {tone === 'custom' && (
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-2">Custom Tone Description</label>
            <input type="text" value={customTone} onChange={e => setCustomTone(e.target.value)}
              placeholder="e.g., Write like a tired grad student at 3am..."
              className="w-full px-4 py-2 bg-dark-800 border border-dark-700/50 rounded-lg text-white placeholder-dark-500 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/50" />
          </div>
        )}

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
                    <Type className="w-4 h-4 text-accent-400" /> Max Output Words: {maxOutputWords === 0 ? 'Unlimited' : maxOutputWords}
                  </label>
                  <input type="range" min="0" max="5000" step="100" value={maxOutputWords} onChange={e => setMaxOutputWords(Number(e.target.value))}
                    className="w-full accent-accent-500" />
                  <div className="flex justify-between text-xs text-dark-500 mt-1"><span>None</span><span>2500</span><span>5000</span></div>
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
              Recommended: <strong>Medium</strong> level + <strong>Humanize</strong> style + <strong>Conversational</strong> tone. Sample text loaded — click Humanize to try it!
            </div>
          )}
          <div className="flex items-center justify-between mb-2">
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

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`relative`}
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

          <div className="mt-3">
            <button onClick={handleHumanize} disabled={loading || !inputText.trim()}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-accent-500 to-accent-600 hover:from-accent-600 hover:to-accent-700 text-white font-medium transition-all shadow-lg shadow-accent-500/25 disabled:opacity-50 disabled:cursor-not-allowed">
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
            <div className="mt-3 flex gap-2 flex-wrap">
              <button onClick={handleRehumanize} disabled={rehumanizing || flaggedCount === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                <RotateCcw className={`w-4 h-4 ${rehumanizing ? 'animate-spin' : ''}`} />
                {rehumanizing ? 'Re-humanizing...' : `🔄 Re-Humanize to 90%+ (${flaggedCount} flagged)`}
              </button>
              <button onClick={handleGrammarCheck} disabled={grammarChecking}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                <CheckCircle className={`w-4 h-4 ${grammarChecking ? 'animate-spin' : ''}`} />
                {grammarChecking ? 'Checking...' : '📝 Grammar Check'}
              </button>
              <button onClick={handleGPTZeroDetect} disabled={gptzeroLoading}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                <Shield className={`w-4 h-4 ${gptzeroLoading ? 'animate-pulse' : ''}`} />
                {gptzeroLoading ? 'Scoring...' : '🔍 GPTZero Scores'}
              </button>
              <button onClick={handleExportPDF}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors">
                <Download className="w-4 h-4" />
                📄 Export PDF
              </button>
              <button onClick={() => setShowComparisonChart(!showComparisonChart)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors">
                <BarChart2 className="w-4 h-4" />
                📊 Chart
              </button>
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

      {/* Phase 2: GPTZero before/after scores */}
      {result && (gptzeroOriginal !== null || gptzeroHumanized !== null || gptzeroUnavailable) && (
        <div className="bg-dark-800/50 border border-purple-500/30 rounded-xl p-4 animate-fade-in">
          <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4 text-purple-400" /> GPTZero Detection — Before vs After
          </h3>
          {gptzeroUnavailable ? (
            <p className="text-sm text-yellow-400">⚠️ GPTZero API key not configured. Set <code className="bg-dark-700 px-1 rounded text-xs">GPTZERO_API_KEY</code> in your environment to enable real detection scoring.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-dark-700/30 rounded-lg p-4 text-center">
                <p className="text-xs text-dark-400 mb-1">Original (AI probability)</p>
                <p className={`text-3xl font-bold ${gptzeroOriginal !== null && gptzeroOriginal > 50 ? 'text-red-400' : 'text-green-400'}`}>
                  {gptzeroOriginal !== null ? `${gptzeroOriginal}%` : '—'}
                </p>
                <p className="text-xs text-dark-500 mt-1">Before humanization</p>
              </div>
              <div className="bg-dark-700/30 rounded-lg p-4 text-center">
                <p className="text-xs text-dark-400 mb-1">Humanized (AI probability)</p>
                <p className={`text-3xl font-bold ${gptzeroHumanized !== null && gptzeroHumanized > 50 ? 'text-red-400' : 'text-green-400'}`}>
                  {gptzeroHumanized !== null ? `${gptzeroHumanized}%` : '—'}
                </p>
                <p className="text-xs text-dark-500 mt-1">After humanization</p>
              </div>
            </div>
          )}
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

      {/* Stats */}
      {result && (
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3 animate-slide-up">
          <div className="glass-card rounded-xl p-3 text-center">
            <p className="text-xl font-bold text-accent-400">{result.wordCount.input}</p>
            <p className="text-xs text-dark-400">Input Words</p>
          </div>
          <div className="glass-card rounded-xl p-3 text-center">
            <p className="text-xl font-bold text-accent-400">{result.wordCount.output}</p>
            <p className="text-xs text-dark-400">Output Words</p>
          </div>
          <div className="glass-card rounded-xl p-3 text-center">
            <p className="text-sm font-bold text-accent-400">{result.modelName}</p>
            <p className="text-xs text-dark-400">Model</p>
          </div>
          <div className="glass-card rounded-xl p-3 text-center">
            <p className={`text-xl font-bold ${detection ? getScoreColor(detection.score) : 'text-dark-400'}`}>~{detection?.score || 0}%</p>
            <p className="text-xs text-dark-400">Est. Human Score</p>
          </div>
          <div className="glass-card rounded-xl p-3 text-center">
            <p className="text-xl font-bold text-dark-200">{result.passes}</p>
            <p className="text-xs text-dark-400">Passes</p>
          </div>
          <div className="glass-card rounded-xl p-3 text-center">
            <p className="text-xl font-bold text-dark-200">
              {typeof result.confidenceReport?.confidence === 'number' ? `${result.confidenceReport.confidence}%` : 'N/A'}
            </p>
            <p className="text-xs text-dark-400">Confidence</p>
          </div>
          <div className="glass-card rounded-xl p-3 text-center">
            <p className={`text-xs font-bold ${result.fallbackBehavior?.used ? 'text-yellow-400' : 'text-green-400'}`}>
              {result.fallbackBehavior?.used ? 'Enabled' : 'Not Used'}
            </p>
            <p className="text-xs text-dark-400">Fallback Guard</p>
          </div>
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
              <p>Choose level, style, and tone</p>
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
