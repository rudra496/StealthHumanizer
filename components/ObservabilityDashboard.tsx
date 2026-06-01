'use client';

// 📊 NOOB EXPLAINER: The Observability Dashboard
// This is the UI component that displays all the tracking data.
// It shows:
// - Total requests, costs, average scores at the top
// - Cost breakdown by provider
// - Latency statistics
// - Quality trends over time
//
// Users can see at a glance:
// - "I've spent $0.47 total, mostly on GPT-4"
// - "Claude is fastest at 3.2s avg"
// - "My pass rate went from 60% to 85% this week"

import { useState, useEffect } from 'react';
import type { ObservabilityTracker } from '@/lib/observability/tracker';

interface DashboardProps {
  tracker: ObservabilityTracker;
}

export function ObservabilityDashboard({ tracker }: DashboardProps) {
  const [totals, setTotals] = useState<{
    totalRequests: number;
    totalCostUsd: number;
    avgHumanScore: number;
    avgLatencyMs: number;
  } | null>(null);
  const [costSummary, setCostSummary] = useState<any[]>([]);
  const [latencyStats, setLatencyStats] = useState<any[]>([]);
  const [qualityTrends, setQualityTrends] = useState<any[]>([]);

  useEffect(() => {
    // 🔄 NOOB EXPLAINER: Load dashboard data
    // When the dashboard appears, we fetch all the stats from
    // the tracker and display them.
    setTotals(tracker.getTotals());
    setCostSummary(tracker.getCostSummary(30));
    setLatencyStats(tracker.getLatencyStats());
    setQualityTrends(tracker.getQualityTrends(30));
  }, [tracker]);

  if (!totals) {
    return (
      <div className="p-6 text-center text-gray-500">
        Loading dashboard...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 🏆 NOOB EXPLAINER: Summary cards */}
      {/* These big numbers give you a quick overview. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="Total Requests"
          value={totals.totalRequests.toString()}
          sublabel="all time"
        />
        <SummaryCard
          label="Total Cost"
          value={`$${totals.totalCostUsd.toFixed(4)}`}
          sublabel="estimated"
        />
        <SummaryCard
          label="Avg Human Score"
          value={`${totals.avgHumanScore.toFixed(1)}%`}
          sublabel={totals.avgHumanScore >= 55 ? '✅ passing' : '⚠️ below threshold'}
        />
        <SummaryCard
          label="Avg Latency"
          value={`${(totals.avgLatencyMs / 1000).toFixed(1)}s`}
          sublabel="per request"
        />
      </div>

      {/* 💰 NOOB EXPLAINER: Cost by provider */}
      {/* Shows how much you're spending on each AI provider. */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
        <h3 className="text-lg font-semibold mb-3">💰 Cost by Provider</h3>
        {costSummary.length === 0 ? (
          <p className="text-gray-500 text-sm">No cost data yet. Start humanizing to see costs.</p>
        ) : (
          <div className="space-y-2">
            {costSummary.slice(0, 10).map((record, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="font-mono">{record.provider}/{record.model}</span>
                <div className="flex items-center gap-4">
                  <span className="text-gray-500">{record.requestCount} requests</span>
                  <span className="font-semibold">${record.totalCostUsd.toFixed(4)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ⏱️ NOOB EXPLAINER: Latency by provider */}
      {/* Shows how fast each AI provider responds. */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
        <h3 className="text-lg font-semibold mb-3">⏱️ Latency by Provider</h3>
        {latencyStats.length === 0 ? (
          <p className="text-gray-500 text-sm">No latency data yet.</p>
        ) : (
          <div className="space-y-2">
            {latencyStats.map((record, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="font-mono">{record.provider}/{record.model}</span>
                <div className="flex items-center gap-4">
                  <span>Avg: {(record.avgLatencyMs / 1000).toFixed(1)}s</span>
                  <span className="text-gray-500">p95: {(record.p95LatencyMs / 1000).toFixed(1)}s</span>
                  <span className="text-gray-500">({record.sampleSize} samples)</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 📈 NOOB EXPLAINER: Quality trends */}
      {/* Shows if humanization quality is improving over time. */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
        <h3 className="text-lg font-semibold mb-3">📈 Quality Trends</h3>
        {qualityTrends.length === 0 ? (
          <p className="text-gray-500 text-sm">No quality data yet.</p>
        ) : (
          <div className="space-y-2">
            {qualityTrends.slice(-7).map((record, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="font-mono">{record.date}</span>
                <div className="flex items-center gap-4">
                  <span>Human: {record.avgHumanScore.toFixed(1)}%</span>
                  <span className="text-gray-500">Pass: {(record.passRate * 100).toFixed(0)}%</span>
                  <span className="text-gray-500">({record.sampleSize} samples)</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// 🃏 NOOB EXPLAINER: Summary card component
// A simple card that shows one big number with a label underneath.
function SummaryCard({ label, value, sublabel }: { label: string; value: string; sublabel: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow text-center">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm font-medium text-gray-600 dark:text-gray-400">{label}</div>
      <div className="text-xs text-gray-500">{sublabel}</div>
    </div>
  );
}
