'use client';

import { useState } from 'react';
import { Search, CheckCircle, HelpCircle, BarChart3, Zap, BookOpen, Shield } from 'lucide-react';
import { detectAI, getClassificationColor, getScoreColor, getScoreBarColor } from '@/lib/detector';
import { getReadabilityLabel, getGradeLevelDescription } from '@/lib/readability';
import { SAMPLE_AI_TEXT } from '@/lib/prompts';
import { countWords } from '@/lib/storage';
import { BASE_PATH } from '@/lib/base-path';

interface DetectorProps {
  showToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
}

interface RudraResult {
  label: 'human' | 'ai';
  aiProbability: number;
  humanProbability: number;
  model: string;
  elapsedMs: number;
  source: string;
  verdict?: string;
}

export default function Detector({ showToast }: DetectorProps) {
  const [text, setText] = useState('');
  // Heuristic analysis (local, supplementary)
  const [heuristic, setHeuristic] = useState<ReturnType<typeof detectAI> | null>(null);
  // Real ML detector result (Rudra API → hosted RoBERTa)
  const [ml, setMl] = useState<RudraResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDetect = async () => {
    if (!text.trim()) { showToast('warning', 'Enter text to analyze.'); return; }
    setLoading(true);
    setError(null);
    setMl(null);
    setHeuristic(null);

    // Fire the real ML detector first (the user-visible primary verdict).
    try {
      const r = await fetch(`${BASE_PATH}/api/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      if (!json?.success) throw new Error(json?.error || 'Detection failed');
      const d = json.data;
      // Rudra (hosted RoBERTa) — primary path. Source flag is the authoritative
      // signal; the aiProbability/humanProbability fields may or may not be set
      // depending on the route version, so fall back to `score` if needed.
      if (d?.source === 'rudra') {
        const aiP = typeof d.aiProbability === 'number' ? d.aiProbability : d.score;
        const humanP = typeof d.humanProbability === 'number' ? d.humanProbability : (1 - aiP);
        setMl({
          label: d.verdict === 'generated' || d.label === 'ai' || aiP >= 0.5 ? 'ai' : 'human',
          aiProbability: aiP,
          humanProbability: humanP,
          model: d.model || 'fakespot-ai/roberta-base-ai-text-detection-v1',
          elapsedMs: d.elapsedMs || 0,
          source: 'rudra',
          verdict: d.verdict,
        });
      } else if (d?.source === 'gptzero') {
        setMl({
          label: (d.score ?? 0) >= 0.5 ? 'ai' : 'human',
          aiProbability: d.score ?? 0,
          humanProbability: 1 - (d.score ?? 0),
          model: 'GPTZero',
          elapsedMs: 0,
          source: 'gptzero',
          verdict: d.verdict,
        });
      } else if (typeof d?.score === 'number') {
        // Server-side local heuristic fallback — Rudra was unreachable.
        setMl({
          label: d.score >= 0.5 ? 'ai' : 'human',
          aiProbability: d.score,
          humanProbability: 1 - d.score,
          model: 'local heuristic (server-side fallback)',
          elapsedMs: 0,
          source: 'fallback',
          verdict: d.verdict,
        });
        setError('Hosted RoBERTa detector unavailable — showing server-side fallback.');
      }
    } catch (err: any) {
      setError(err?.message || 'Detection request failed');
    }

    // Run the local heuristic in parallel — useful as supplementary metrics
    // (perplexity, burstiness, readability) even after the ML verdict is in.
    setTimeout(() => {
      try {
        const d = detectAI(text);
        setHeuristic(d);
      } catch {}
      setLoading(false);
      showToast('info', ml ? `ML verdict: ${ml.label === 'human' ? 'Likely Human' : 'Likely AI'}` : 'Analysis complete');
    }, 200);
  };

  // ML verdict drives the headline score; heuristic drives the secondary metrics.
  const _headlineScore = ml ? Math.round(ml.humanProbability * 100) : (heuristic ? heuristic.score : 0);
  const scoreColor = ml
    ? (ml.label === 'human' ? 'text-green-400' : 'text-red-400')
    : (heuristic ? getScoreColor(heuristic.score) : 'text-dark-400');
  const verdictLabel = ml
    ? (ml.label === 'human' ? 'Likely Human (ML verdict)' : 'Likely AI (ML verdict)')
    : (heuristic ? (heuristic.overallVerdict === 'human' ? 'Likely Human Patterns' : heuristic.overallVerdict === 'ai' ? 'Likely AI Patterns' : 'Mixed — Uncertain') : '');
  const verdictIcon = ml
    ? (ml.label === 'human' ? CheckCircle : HelpCircle)
    : (heuristic?.overallVerdict === 'human' ? CheckCircle : heuristic?.overallVerdict === 'ai' ? HelpCircle : CheckCircle);
  const readLabel = heuristic ? getReadabilityLabel(heuristic.readability.fleschReadingEase) : null;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Search className="w-6 h-6 text-accent-400" /> AI Detector
          </h2>
          <p className="text-dark-400 mt-1">
            Real ML detection via hosted RoBERTa + supplementary heuristic metrics (perplexity, burstiness, readability)
          </p>
        </div>
        <button onClick={() => { setText(SAMPLE_AI_TEXT); showToast('info', 'Sample loaded!'); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-dark-800 hover:bg-dark-700 text-dark-300 text-sm self-start">
          <Zap className="w-4 h-4" /> Load Sample AI Text
        </button>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-dark-300">Text to Analyze</label>
          {text && <button onClick={() => { setText(''); setHeuristic(null); setMl(null); setError(null); }} className="text-xs text-dark-500 hover:text-dark-300">Clear</button>}
        </div>
        <textarea value={text} onChange={e => setText(e.target.value)}
          placeholder="Paste text here to check if it's AI-generated..."
          className="w-full h-48 p-4 bg-dark-800/50 border border-dark-700/50 rounded-xl text-white placeholder-dark-500 resize-none focus:outline-none focus:ring-2 focus:ring-accent-500/50 text-sm" />
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-dark-500">{countWords(text)} words</span>
          <button onClick={handleDetect} disabled={loading || !text.trim()}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-accent-500 to-accent-600 text-white font-medium shadow-lg shadow-accent-500/25 disabled:opacity-50">
            {loading ? <><Zap className="w-5 h-5 animate-pulse" /> Running ML detector...</> : <><Search className="w-5 h-5" /> Analyze</>}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
          <p className="text-sm text-yellow-300/90">{error}</p>
        </div>
      )}

      {ml && (
        <div className="bg-gradient-to-br from-dark-800/80 to-dark-900/80 border border-accent-500/30 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-white flex items-center gap-2">
              <Shield className="w-5 h-5 text-accent-400" /> ML Detector Verdict
            </h3>
            {ml.source === 'rudra' && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                hosted RoBERTa · free
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
            <div className="text-center">
              <div className={`text-6xl font-bold ${scoreColor} mb-2`}>
                {(ml.humanProbability * 100).toFixed(1)}%
              </div>
              <div className="text-sm text-dark-400">Human probability</div>
            </div>
            <div className="text-center">
              <div className={`text-6xl font-bold ${ml.label === 'ai' ? 'text-red-400' : 'text-dark-300'} mb-2`}>
                {(ml.aiProbability * 100).toFixed(1)}%
              </div>
              <div className="text-sm text-dark-400">AI probability</div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-dark-700/50 flex items-center justify-between text-sm">
            <span className="text-dark-300">
              Verdict: <span className={ml.label === 'human' ? 'text-green-400 font-medium' : 'text-red-400 font-medium'}>
                {ml.label === 'human' ? 'Likely Human' : 'Likely AI'}
              </span>
            </span>
            <span className="text-xs text-dark-500">
              {ml.model}{ml.elapsedMs > 0 && ` · ${ml.elapsedMs}ms`}
            </span>
          </div>
        </div>
      )}

      {heuristic && (
        <>
          {/* Heuristic score (secondary — gives the percentage shown historically) */}
          <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6">
            <div className="text-center mb-4">
              <div className="flex items-center justify-center gap-2 mb-2">
                {(() => { const Icon = verdictIcon; return <Icon className={`w-5 h-5 ${scoreColor}`} />; })()}
                <span className={`text-lg font-medium ${scoreColor}`}>{verdictLabel}</span>
              </div>
              <div className={`text-3xl font-bold ${getScoreColor(heuristic.score)} mb-1`}>{heuristic.score}%</div>
              <div className="text-xs text-dark-500">heuristic pattern score (supplementary)</div>
            </div>
            <div className="h-3 bg-dark-700 rounded-full overflow-hidden">
              <div className={`h-full rounded-full progress-bar ${getScoreBarColor(heuristic.score)}`} style={{ width: `${heuristic.score}%` }} />
            </div>
            <div className="flex justify-between mt-1 text-xs text-dark-500"><span>AI Generated</span><span>Human Written</span></div>
          </div>

          {/* Detection Metrics */}
          <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6">
            <h3 className="text-lg font-medium text-white flex items-center gap-2 mb-4">
              <BarChart3 className="w-5 h-5 text-accent-400" /> Heuristic Analysis
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {[
                { label: 'Burstiness', value: heuristic.analysis.burstiness, desc: 'Sentence variation', good: true },
                { label: 'Vocab Diversity', value: heuristic.analysis.vocabularyDiversity, desc: 'Unique words', good: true },
                { label: 'Perplexity', value: heuristic.analysis.perplexity, desc: 'Predictability', good: true },
                { label: 'Sentence Variation', value: heuristic.analysis.sentenceLengthVariation, desc: 'Length diffs', good: true },
                { label: 'Start Diversity', value: heuristic.analysis.sentenceStartDiversity, desc: 'Unique openers', good: true },
                { label: 'Pronoun Usage', value: heuristic.analysis.pronounUsage, desc: 'I/we/you usage', good: true },
                { label: 'Transition Freq.', value: heuristic.analysis.transitionFrequency, desc: 'AI transitions', good: false },
                { label: 'Passive Voice', value: heuristic.analysis.passiveVoiceRatio, desc: 'Passive usage', good: false },
                { label: 'AI Phrases', value: heuristic.analysis.aiPhraseDensity, desc: 'AI patterns', good: false },
                { label: 'Hedging', value: heuristic.analysis.hedgingFrequency, desc: 'Hedging words', good: false },
                { label: 'Quantifiers', value: heuristic.analysis.quantifierOveruse, desc: 'Overuse', good: false },
              ].map(metric => (
                <div key={metric.label} className="bg-dark-700/30 rounded-lg p-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-dark-400">{metric.label}</span>
                    <span className={`text-sm font-medium ${metric.good ? 'text-green-400' : 'text-red-400'}`}>{metric.value}%</span>
                  </div>
                  <div className="h-1.5 bg-dark-700 rounded-full mt-2 overflow-hidden">
                    <div className={`h-full rounded-full ${metric.good ? 'bg-green-500/60' : 'bg-red-500/60'}`}
                      style={{ width: `${Math.min(100, metric.value)}%` }} />
                  </div>
                  <p className="text-xs text-dark-500 mt-1">{metric.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Readability */}
          <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6">
            <h3 className="text-lg font-medium text-white flex items-center gap-2 mb-4">
              <BookOpen className="w-5 h-5 text-accent-400" /> Readability Metrics
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-dark-700/30 rounded-lg p-4 text-center">
                <p className={`text-2xl font-bold ${readLabel?.color}`}>{heuristic.readability.fleschReadingEase}</p>
                <p className="text-xs text-dark-400 mt-1">Flesch Reading Ease</p>
                <p className={`text-xs mt-1 ${readLabel?.color}`}>{readLabel?.label}</p>
              </div>
              <div className="bg-dark-700/30 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-dark-200">{heuristic.readability.fleschKincaidGrade}</p>
                <p className="text-xs text-dark-400 mt-1">Grade Level</p>
                <p className="text-xs text-dark-500 mt-1">{getGradeLevelDescription(heuristic.readability.fleschKincaidGrade)}</p>
              </div>
              <div className="bg-dark-700/30 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-dark-200">{heuristic.readability.colemanLiauIndex}</p>
                <p className="text-xs text-dark-400 mt-1">Coleman-Liau</p>
              </div>
              <div className="bg-dark-700/30 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-dark-200">{heuristic.readability.readingTimeMinutes}m</p>
                <p className="text-xs text-dark-400 mt-1">Reading Time</p>
                <p className="text-xs text-dark-500 mt-1">{heuristic.readability.totalWords} words</p>
              </div>
            </div>
          </div>

          {/* Sentences */}
          <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6">
            <h3 className="text-lg font-medium text-white mb-4">Sentence-by-Sentence Heuristic ({heuristic.sentences.length} sentences)</h3>
            <div className="space-y-2">
              {heuristic.sentences.map((sentence, i) => (
                <div key={i} className={`sentence-highlight p-3 rounded-lg border ${getClassificationColor(sentence.classification)}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-dark-200 flex-1">{sentence.text}</p>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${
                      sentence.classification === 'human' ? 'bg-green-500/20 text-green-400' : sentence.classification === 'maybe' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'
                    }`}>{sentence.score}%</span>
                  </div>
                  {sentence.issues.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {sentence.issues.map((issue, j) => (
                        <span key={j} className="text-xs text-dark-500 bg-dark-700/50 px-2 py-0.5 rounded">{issue}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
