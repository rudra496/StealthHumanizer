import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessSemanticFidelity } from '../../lib/semantic-fidelity.ts';
import { localHumanizeText } from '../../lib/local-humanizer.ts';
import { estimateRunCost, summarizeObservability } from '../../lib/observability.ts';

test('semantic fidelity gives high score for meaning-preserving rewrite', () => {
  const report = assessSemanticFidelity(
    'Automation improves team workflows and reduces repeated manual review for distributed teams.',
    'Automation improves workflows for distributed teams and reduces repeated manual review.'
  );
  assert.equal(report.verdict, 'preserved');
  assert.ok(report.score >= 74);
});

test('privacy local humanizer rewrites common AI phrases without network state', () => {
  const rewritten = localHumanizeText('Furthermore, it is important to note that teams utilize robust systems.', { level: 'ninja', style: 'humanize', tone: 'conversational' });
  assert.match(rewritten, /also|notably|use|solid|In practice/i);
  assert.doesNotMatch(rewritten, /important to note/i);
});

test('observability summarizes cost and quality metrics', () => {
  const cost = estimateRunCost(100, 120, 'gemini');
  assert.ok(cost > 0);
  const summary = summarizeObservability([
    { id: '1', timestamp: 1, type: 'humanize', provider: 'gemini', inputWords: 100, outputWords: 110, latencyMs: 250, costUsd: cost, finalScore: 80, semanticScore: 90, success: true },
    { id: '2', timestamp: 2, type: 'privacy', provider: 'local-privacy', inputWords: 50, outputWords: 55, latencyMs: 10, costUsd: 0, finalScore: 70, semanticScore: 82, success: true },
  ]);
  assert.equal(summary.runs, 2);
  assert.equal(summary.successRate, 100);
  assert.equal(summary.avgHumanScore, 75);
});
