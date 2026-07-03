import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessSemanticFidelity } from '../../lib/semantic-fidelity.ts';
import { localHumanizeText } from '../../lib/local-humanizer.ts';
import { stripAILexicon } from '../../lib/postprocess.ts';
import { estimateRunCost, getDailyObservability, getProviderBreakdown, summarizeObservability } from '../../lib/observability.ts';
import { consumeHumanizeStream } from '../../lib/streaming-client.ts';

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

test('AI lexicon strips common issue 91 framing phrases', () => {
  const rewritten = stripAILexicon(
    "It is worth noting that in today's digital landscape, in the realm of education, as we navigate new tools, teams adapt."
  );
  assert.doesNotMatch(rewritten, /worth noting|digital landscape|realm of|as we navigate/i);
  assert.match(rewritten, /Today in education/i);
  assert.match(rewritten, /as we handle new tools/i);
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


test('semantic fidelity flags changed numbers and negation drift', () => {
  const report = assessSemanticFidelity(
    'The trial did not reduce errors by 37% for Acme Health in 2025.',
    'The trial reduced errors for Acme Health.'
  );
  assert.ok(report.numberRecall < 100);
  assert.ok(report.negationConsistency < 100);
  assert.ok(report.warnings.some(warning => warning.includes('number') || warning.includes('Negation')));
});

test('observability exposes provider and daily breakdowns', () => {
  const now = Date.now();
  const events = [
    { id: '1', timestamp: now, type: 'humanize', provider: 'gemini', inputWords: 100, outputWords: 110, latencyMs: 250, costUsd: 0.001, finalScore: 80, semanticScore: 90, success: true },
    { id: '2', timestamp: now, type: 'stream', provider: 'gemini', inputWords: 70, outputWords: 75, latencyMs: 300, costUsd: 0.001, finalScore: 78, semanticScore: 88, success: true },
  ];
  assert.equal(getProviderBreakdown(events).at(0)?.provider, 'gemini');
  assert.equal(getDailyObservability(30, events).at(0)?.runs, 2);
});

test('streaming client parses incremental SSE result events', async () => {
  const payload = {
    sentences: [], fullText: 'hello', model: 'gemini', modelName: 'Gemini', wordCount: { input: 1, output: 1 },
    timestamp: 1, passes: 1, finalScore: 90, options: { level: 'medium', style: 'humanize', tone: 'conversational', model: 'gemini', language: 'auto' }, success: true,
  };
  const response = new Response(`event: progress\ndata: {"message":"one"}\n\nevent: result\ndata: ${JSON.stringify(payload)}\n\nevent: done\ndata: {"ok":true}\n\n`);
  const seen = [];
  const result = await consumeHumanizeStream(response, event => seen.push(event.type));
  assert.equal(result.fullText, 'hello');
  assert.deepEqual(seen, ['progress', 'result', 'done']);
});

test('privacy local humanizer preserves prohibitions instead of weakening never', () => {
  const rewritten = localHumanizeText('Never share API keys or commit secrets.', { level: 'ninja', style: 'technical', tone: 'technical' });
  assert.doesNotMatch(rewritten, /rarely share/i);
  assert.match(rewritten, /never share/i);
});
