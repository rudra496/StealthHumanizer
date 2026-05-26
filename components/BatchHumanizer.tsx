'use client';

import { useState } from 'react';
import { Layers, Plus, Trash2, Zap, Copy, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { getApiKeys } from '@/lib/storage';
import { WEB_PROVIDERS as PROVIDERS } from '@/lib/providers';
import { ModelProvider } from '@/lib/types';

interface BatchItem {
  id: string;
  text: string;
}

interface BatchResult {
  index: number;
  input: string;
  output: string | null;
  finalScore?: number;
  error: string | null;
}

type ItemStatus = 'idle' | 'loading' | 'success' | 'error';

interface BatchHumanizerProps {
  showToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
}

export default function BatchHumanizer({ showToast }: BatchHumanizerProps) {
  const [items, setItems] = useState<BatchItem[]>(() => [
    { id: '1', text: '' },
    { id: '2', text: '' },
  ]);
  const [nextId, setNextId] = useState(3);
  const [results, setResults] = useState<BatchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [itemStatuses, setItemStatuses] = useState<Record<string, ItemStatus>>({});
  const [model, setModel] = useState<ModelProvider>(PROVIDERS[0]?.id ?? 'gemini');
  const [level, setLevel] = useState<'light' | 'medium' | 'aggressive' | 'ninja'>('medium');

  const addItem = () => {
    if (items.length >= 20) { showToast('warning', 'Maximum 20 items allowed.'); return; }
    setItems(prev => [...prev, { id: String(nextId), text: '' }]);
    setNextId(prev => prev + 1);
  };

  const removeItem = (id: string) => {
    if (items.length <= 1) { showToast('warning', 'At least one item is required.'); return; }
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const updateItem = (id: string, text: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, text } : i));
  };

  const getStatusColor = (status: ItemStatus) => {
    switch (status) {
      case 'loading': return 'border-yellow-500/50 bg-yellow-500/5';
      case 'success': return 'border-green-500/30 bg-green-500/5';
      case 'error': return 'border-red-500/50 bg-red-500/5';
      default: return 'border-dark-700/50 bg-dark-800/50';
    }
  };

  const getStatusIcon = (status: ItemStatus) => {
    switch (status) {
      case 'loading': return <Loader2 className="w-3 h-3 text-yellow-400 animate-spin" />;
      case 'success': return <CheckCircle className="w-3 h-3 text-green-400" />;
      case 'error': return <AlertTriangle className="w-3 h-3 text-red-400" />;
      default: return null;
    }
  };

  const handleSubmit = async () => {
    const keys = getApiKeys();
    const apiKey = keys[model];
    if (!apiKey) {
      showToast('error', 'No API key found. Add one in Settings.');
      return;
    }

    const nonEmpty = items.filter(i => i.text.trim().length > 0);
    if (nonEmpty.length === 0) {
      showToast('warning', 'Enter at least one text to humanize.');
      return;
    }

    setLoading(true);
    setResults([]);

    // Set all non-empty items to loading
    const newStatuses: Record<string, ItemStatus> = {};
    items.forEach(item => {
      if (item.text.trim().length > 0) newStatuses[item.id] = 'loading';
    });
    setItemStatuses(newStatuses);

    try {
      const res = await fetch('/api/humanize-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          texts: items.map(i => i.text),
          level,
          model,
          apiKey,
        }),
      });

      const raw = await res.json(); const data = raw.data ?? raw;
      if (!res.ok) {
        showToast('error', data.error ?? 'Batch processing failed.');
        // Reset all statuses to error
        const errStatuses: Record<string, ItemStatus> = {};
        items.forEach(item => { if (item.text.trim()) errStatuses[item.id] = 'error'; });
        setItemStatuses(errStatuses);
        return;
      }

      setResults(data.results ?? []);

      // Update per-item statuses based on results
      const finalStatuses: Record<string, ItemStatus> = {};
      items.forEach((item, idx) => {
        if (!item.text.trim()) return;
        const result = data.results?.[idx];
        if (result) {
          finalStatuses[item.id] = result.error ? 'error' : 'success';
        } else {
          finalStatuses[item.id] = 'error';
        }
      });
      setItemStatuses(finalStatuses);

      showToast('success', `Done! ${data.successCount ?? 0}/${data.count ?? 0} texts processed.`);
    } catch {
      showToast('error', 'Network error — please try again.');
      const errStatuses: Record<string, ItemStatus> = {};
      items.forEach(item => { if (item.text.trim()) errStatuses[item.id] = 'error'; });
      setItemStatuses(errStatuses);
    } finally {
      setLoading(false);
    }
  };

  const retryFailed = async () => {
    const failedIndices = results
      .map((r, i) => r.error !== null ? i : -1)
      .filter(i => i >= 0);

    if (failedIndices.length === 0) {
      showToast('info', 'No failed items to retry.');
      return;
    }

    const keys = getApiKeys();
    const apiKey = keys[model];
    if (!apiKey) {
      showToast('error', 'No API key found. Add one in Settings.');
      return;
    }

    setLoading(true);

    // Set failed items back to loading
    setItemStatuses(prev => {
      const updated = { ...prev };
      failedIndices.forEach(idx => {
        const item = items[idx];
        if (item) updated[item.id] = 'loading';
      });
      return updated;
    });

    try {
      // Only retry failed items to save API credits
      const failedTexts = failedIndices.map(i => items[i].text);
      const res = await fetch('/api/humanize-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          texts: failedTexts,
          level,
          model,
          apiKey,
        }),
      });

      const raw = await res.json(); const data = raw.data ?? raw;
      if (!res.ok) {
        showToast('error', data.error ?? 'Retry failed.');
        return;
      }

      // Merge retry results back into existing results
      const mergedResults = [...results];
      failedIndices.forEach((originalIdx, retryIdx) => {
        if (data.results?.[retryIdx]) {
          mergedResults[originalIdx] = { ...data.results[retryIdx], index: originalIdx };
        }
      });
      setResults(mergedResults);

      const finalStatuses: Record<string, ItemStatus> = {};
      mergedResults.forEach((r, idx) => {
        const item = items[idx];
        if (item && item.text.trim()) {
          finalStatuses[item.id] = r.error ? 'error' : 'success';
        }
      });
      setItemStatuses(finalStatuses);

      const newSuccessCount = mergedResults.filter(r => !r.error).length ?? 0;
      showToast('success', `Retry done! ${newSuccessCount}/${mergedResults.length} texts now successful.`);
    } catch {
      showToast('error', 'Network error during retry.');
    } finally {
      setLoading(false);
    }
  };

  const copyAll = () => {
    const text = results
      .filter(r => r.output)
      .map((r, i) => `--- Result ${i + 1} ---\n${r.output}`)
      .join('\n\n');
    if (!text) { showToast('warning', 'No results to copy.'); return; }
    navigator.clipboard.writeText(text).then(() => showToast('success', 'All results copied!'));
  };

  const failedCount = results.filter(r => r.error).length;
  const successCount = results.filter(r => !r.error).length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Layers className="w-6 h-6 text-accent-400" /> Batch Humanizer
          </h2>
          <p className="text-dark-400 mt-1">Humanize multiple texts at once — up to 20 items</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <select
            value={model}
            onChange={e => setModel(e.target.value as ModelProvider)}
            className="px-3 py-2 rounded-lg bg-dark-800 border border-dark-700/50 text-dark-200 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/50"
          >
            {PROVIDERS.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select
            value={level}
            onChange={e => setLevel(e.target.value as typeof level)}
            className="px-3 py-2 rounded-lg bg-dark-800 border border-dark-700/50 text-dark-200 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500/50"
          >
            <option value="light">🪶 Light</option>
            <option value="medium">✨ Medium</option>
            <option value="aggressive">🔥 Aggressive</option>
            <option value="ninja">🥷 Ninja</option>
          </select>
        </div>
      </div>

      {/* Input list */}
      <div className="space-y-3">
        {items.map((item, idx) => {
          const status = itemStatuses[item.id] || 'idle';
          const result = results[idx];
          return (
            <div key={item.id} className="flex gap-2 items-start">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-dark-500 font-medium flex items-center gap-1">
                    Text {idx + 1}
                    {getStatusIcon(status)}
                  </span>
                  {status === 'loading' && (
                    <span className="text-xs text-yellow-400 animate-pulse">Processing...</span>
                  )}
                  {result && result.error === null && status === 'success' && (
                    <span className="text-xs text-green-400 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> {result.finalScore}% human
                    </span>
                  )}
                  {result && result.error !== null && (
                    <span className="text-xs text-red-400 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Failed
                    </span>
                  )}
                </div>
                <div className={`rounded-xl border transition-colors ${getStatusColor(status)}`}>
                  <textarea
                    value={item.text}
                    onChange={e => updateItem(item.id, e.target.value)}
                    placeholder={`Enter text ${idx + 1} to humanize...`}
                    rows={3}
                    disabled={loading}
                    className="w-full p-3 bg-transparent text-white placeholder-dark-500 resize-y focus:outline-none focus:ring-2 focus:ring-accent-500/50 text-sm disabled:opacity-60"
                  />
                </div>
                {result && result.output && (
                  <div className="mt-2 p-3 bg-dark-700/30 border border-accent-500/20 rounded-xl">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-accent-400 font-medium">Humanized output</span>
                      <button
                        onClick={() => navigator.clipboard.writeText(result.output!).then(() => showToast('success', 'Copied!'))}
                        className="text-xs text-dark-400 hover:text-dark-200 flex items-center gap-1"
                      >
                        <Copy className="w-3 h-3" /> Copy
                      </button>
                    </div>
                    <p className="text-sm text-dark-200">{result.output}</p>
                  </div>
                )}
                {result && result.error !== null && (
                  <div className="mt-2 p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
                    <p className="text-xs text-red-400 font-medium">⚠️ {result.error}</p>
                  </div>
                )}
              </div>
              <button
                onClick={() => removeItem(item.id)}
                disabled={loading}
                className="mt-6 p-2 rounded-lg bg-dark-800 hover:bg-red-500/20 hover:text-red-400 text-dark-400 transition-colors disabled:opacity-50"
                aria-label="Remove item"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <button
          onClick={addItem}
          disabled={items.length >= 20 || loading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-dark-800 hover:bg-dark-700 text-dark-300 text-sm disabled:opacity-50 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Text
        </button>

        <div className="flex gap-2">
          {results.length > 0 && (
            <>
              <button
                onClick={copyAll}
                disabled={successCount === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-dark-800 hover:bg-dark-700 text-dark-300 text-sm disabled:opacity-50 transition-colors"
              >
                <Copy className="w-4 h-4" /> Copy All
              </button>
              {failedCount > 0 && (
                <button
                  onClick={retryFailed}
                  disabled={loading}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 text-sm disabled:opacity-50 transition-colors"
                >
                  <AlertTriangle className="w-4 h-4" /> Retry Failed ({failedCount})
                </button>
              )}
            </>
          )}
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-accent-500 to-accent-600 hover:from-accent-600 hover:to-accent-700 text-white font-semibold shadow-lg shadow-accent-500/25 disabled:opacity-50 transition-all"
          >
            {loading ? (
              <><Loader2 className="w-5 h-5 animate-spin" /> Processing...</>
            ) : (
              <><Layers className="w-5 h-5" /> Humanize Batch</>
            )}
          </button>
        </div>
      </div>

      {results.length > 0 && (
        <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-4 text-sm text-dark-300">
          <span className="font-medium text-green-400">{successCount}</span> of{' '}
          <span className="font-medium text-white">{results.length}</span> texts processed successfully.
          {failedCount > 0 && (
            <span className="ml-2 text-red-400">({failedCount} failed)</span>
          )}
        </div>
      )}
    </div>
  );
}
