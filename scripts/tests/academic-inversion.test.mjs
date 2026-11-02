import test from 'node:test';
import assert from 'node:assert/strict';
import { maskAcademicConstructs, unmaskAcademicConstructs, runAcademicInversion, refineAcademicSentences } from '../../lib/academic-inversion.ts';

test('maskAcademicConstructs protects citations and LaTeX equations', () => {
  const input = 'We analyze UAV trajectory [1, 2] under kinetic bounds $\\omega > \\omega_{crit}$ and $F(t) = m \\cdot \\ddot{x}$ [3].';
  const { maskedText, tokenMap } = maskAcademicConstructs(input);

  assert.equal(tokenMap.size, 4, 'Should extract exactly 4 tokens (2 math, 2 citations)');
  assert.match(maskedText, /\[REF_0\]/);
  assert.match(maskedText, /\[REF_1\]/);
  assert.match(maskedText, /\[MATH_0\]/);
  assert.match(maskedText, /\[MATH_1\]/);
  assert.ok(!maskedText.includes('\\omega'), 'LaTeX variable should be masked out');
});

test('unmaskAcademicConstructs restores exact LaTeX backslashes without regex escape corruption', () => {
  const input = 'Equation $\\mathbf{N} = \\mathbf{I} - \\mathbf{J}^{\\dagger}\\mathbf{J}$ verified by [14, 18].';
  const { maskedText, tokenMap } = maskAcademicConstructs(input);
  const restored = unmaskAcademicConstructs(maskedText, tokenMap);

  assert.equal(restored, input, 'Restored text must match original exactly');
  assert.ok(restored.includes('\\mathbf{N}'), 'Backslashes must not be stripped or mangled');
});

test('runAcademicInversion executes multi-hop pivot and preserves academic integrity', async () => {
  const sample = 'Recent advancements in deep learning have demonstrated significant potential for automated fault detection in industrial manufacturing [1, 2]. Under continuous high speed where $\\omega > 12000\\text{ rpm}$, harmonic vibration increases non-linearly according to $F(t) = m \\cdot \\ddot{x} + c \\cdot \\dot{x}$ [3].';
  
  const result = await runAcademicInversion(sample, { timeoutMs: 15000 });

  assert.ok(result.text.length > 50, 'Result must contain rewritten text');
  assert.ok(result.text.includes('[1, 2]'), 'Citation [1, 2] must be preserved in final output');
  assert.ok(result.text.includes('[3]'), 'Citation [3] must be preserved in final output');
  assert.ok(result.text.includes('\\omega'), 'LaTeX math must be preserved in final output');
  assert.ok(result.elapsedMs < 10000, 'Pivot translation must complete within 10 seconds');
  assert.equal(result.tokensPreserved, 4, 'All 4 tokens must be tracked');
});

test('refineAcademicSentences actively transforms flagged nominalizations and improves prose', async () => {
  const flagged = [
    'The implementation of AI technologies has enabled rapid developments in automation, data analysis and customer service.',
    'The use of machine learning algorithms has enabled businesses to process huge amounts of data with high efficiency.',
    'Organizations must ensure that their AI implementations are transparent, fair and accountable.',
  ];

  const refined = await refineAcademicSentences(flagged);

  assert.equal(refined.length, flagged.length, 'Must return same count of sentences');
  refined.forEach((r, idx) => {
    assert.notEqual(r.trim(), flagged[idx].trim(), `Sentence ${idx + 1} must be actively transformed`);
    assert.ok(r.length > 15, `Sentence ${idx + 1} must be a complete sentence`);
    assert.ok(!r.includes('AI implementations'), `Sentence ${idx + 1} should purge AI buzzphrase 'AI implementations'`);
  });
});

