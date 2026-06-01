'use client';

import { useMemo, useState } from 'react';
import { Activity, BarChart3, Clock, DollarSign, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { clearObservabilityEvents, getObservabilityEvents, summarizeObservability } from '@/lib/observability';
import { detectAI } from '@/lib/detector';
import { assessSemanticFidelity } from '@/lib/semantic-fidelity';
import { localHumanizeText } from '@/lib/local-humanizer';

interface ObservabilityDashboardProps {
  showToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
}

const BENCHMARK_SAMPLES = [
  'Furthermore, it is important to note that this solution demonstrates the potential to optimize workflows across distributed teams.',
  'The results indicate that robust governance can facilitate reliable adoption while minimizing operational uncertainty.',
  'In conclusion, this comprehensive approach leverages automation to deliver seamless experiences for users.',
];

export default function ObservabilityDashboard({ showToast }: ObservabilityDashboardProps) {
  const [refreshToken, setRefreshToken] = useState(0);
  const [benchmarking, setBenchmarking] = useState(false);
  const [benchmarkRows, setBenchmarkRows] = useState<Array<{ sample: string; before: number; after: number; semantic: number }>>([]);
  const events = useMemo(() => getObservabilityEvents(), [refreshToken]);
  const summary = useMemo(() => summarizeObservability(events), [events]);

  const runLocalBenchmark = async () => {
    setBenchmarking(true);
    try {
      const rows = BENCHMARK_SAMPLES.map(sample => {
        const humanized = localHumanizeText(sample, { level: 'ninja', style: 'humanize', tone: 'conversational' });
        return {
          sample,
          before: detectAI(sample).score,
          after: detectAI(humanized).score,
          semantic: assessSemanticFidelity(sample, humanized).score,
        };
      });
      setBenchmarkRows(rows);
      showToast('success', 'Local detector benchmark completed.');
    } catch {
      showToast('error', 'Benchmark failed.');
    } finally {
      setBenchmarking(false);
    }
  };

  const clear = () => {
    clearObservabilityEvents();
    setRefreshToken(value => value + 1);
    showToast('info', 'Observability history cleared.');
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2"><Activity className="w-6 h-6 text-accent-400" /> Observability & Benchmarks</h2>
          <p className="text-dark-400 mt-1">Track local run cost, latency, detector score, semantic fidelity, and privacy-mode benchmark quality.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setRefreshToken(value => value + 1)} className="px-3 py-2 rounded-lg bg-dark-800 text-dark-200 hover:bg-dark-700 text-sm flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button onClick={clear} className="px-3 py-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 text-sm flex items-center gap-2">
            <Trash2 className="w-4 h-4" /> Clear
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-5 gap-3">
        {[
          { label: 'Runs', value: summary.runs, icon: BarChart3 },
          { label: 'Success', value: `${summary.successRate}%`, icon: ShieldCheck },
          { label: 'Est. Cost', value: `$${summary.totalCostUsd.toFixed(5)}`, icon: DollarSign },
          { label: 'Avg Latency', value: `${summary.avgLatencyMs}ms`, icon: Clock },
          { label: 'Avg Fidelity', value: `${summary.avgSemanticScore}%`, icon: Activity },
        ].map(card => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="glass-card rounded-xl p-4">
              <Icon className="w-5 h-5 text-accent-400 mb-3" />
              <p className="text-2xl font-bold text-white">{card.value}</p>
              <p className="text-xs text-dark-400">{card.label}</p>
            </div>
          );
        })}
      </div>

      <div className="glass-card rounded-xl p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="font-semibold text-white">Real detector benchmark dashboard</h3>
            <p className="text-sm text-dark-400">Runs the built-in detector against curated samples and the offline privacy rewriter.</p>
          </div>
          <button onClick={runLocalBenchmark} disabled={benchmarking} className="px-4 py-2 rounded-lg bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50 text-sm">
            {benchmarking ? 'Running...' : 'Run benchmark'}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-dark-400 border-b border-dark-700/50">
              <tr><th className="py-2 text-left">Sample</th><th className="py-2 text-right">Before</th><th className="py-2 text-right">After</th><th className="py-2 text-right">Fidelity</th></tr>
            </thead>
            <tbody>
              {benchmarkRows.length === 0 ? (
                <tr><td colSpan={4} className="py-5 text-center text-dark-500">Run a benchmark to populate this table.</td></tr>
              ) : benchmarkRows.map((row, index) => (
                <tr key={index} className="border-b border-dark-800/80">
                  <td className="py-3 text-dark-300 max-w-xl truncate">{row.sample}</td>
                  <td className="py-3 text-right text-dark-300">{row.before}%</td>
                  <td className="py-3 text-right text-green-400">{row.after}%</td>
                  <td className="py-3 text-right text-accent-400">{row.semantic}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="glass-card rounded-xl p-5">
        <h3 className="font-semibold text-white mb-4">Recent runs</h3>
        <div className="space-y-2">
          {events.slice().reverse().slice(0, 12).map(event => (
            <div key={event.id} className="grid md:grid-cols-7 gap-2 items-center bg-dark-800/40 rounded-lg p-3 text-xs">
              <span className="text-dark-400">{new Date(event.timestamp).toLocaleString()}</span>
              <span className="text-white font-medium">{event.provider}</span>
              <span className="text-dark-300">{event.type}</span>
              <span className="text-dark-300">{event.inputWords}→{event.outputWords} words</span>
              <span className="text-dark-300">{event.latencyMs}ms</span>
              <span className="text-green-400">${event.costUsd.toFixed(5)}</span>
              <span className={event.success ? 'text-green-400' : 'text-red-400'}>{event.success ? 'success' : 'failed'}</span>
            </div>
          ))}
          {events.length === 0 && <p className="text-center text-dark-500 py-6">No runs recorded yet. Humanize text or use privacy mode to populate this dashboard.</p>}
        </div>
      </div>
    </div>
  );
}
