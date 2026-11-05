import test from 'node:test';
import assert from 'node:assert/strict';
import { maskAcademicConstructs, unmaskAcademicConstructs, runAcademicInversion, refineAcademicSentences } from '../../lib/academic-inversion.ts';
import { applyHumanizeTransforms, sentenceLooksBroken, digitsPreserved } from '../../lib/humanize-transforms.ts';
import { localRehumanizeSentence } from '../../lib/rehumanize.ts';

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

test('runAcademicInversion preserves academic integrity and never ships broken grammar', async () => {
  const sample = 'Recent advancements in deep learning have demonstrated significant potential for automated fault detection in industrial manufacturing [1, 2]. Under continuous high speed where $\\omega > 12000\\text{ rpm}$, harmonic vibration increases non-linearly according to $F(t) = m \\cdot \\ddot{x} + c \\cdot \\dot{x}$ [3].';

  const result = await runAcademicInversion(sample, { timeoutMs: 15000 });

  assert.ok(result.text.length > 50, 'Result must contain rewritten text');
  assert.ok(result.text.includes('[1, 2]'), 'Citation [1, 2] must be preserved in final output');
  assert.ok(result.text.includes('[3]'), 'Citation [3] must be preserved in final output');
  assert.ok(result.text.includes('\\omega'), 'LaTeX math must be preserved in final output');
  assert.equal(result.tokensPreserved, 4, 'All 4 tokens must be tracked');
  assert.equal(sentenceLooksBroken(result.text), false, 'Output must pass the mechanical-grammar gate');
  assert.doesNotMatch(result.text, /\$\d/, 'No literal replacement-group tokens may leak');
});

test('refineAcademicSentences transforms flagged nominalizations without fabricating content', async () => {
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
    assert.equal(sentenceLooksBroken(r), false, `Sentence ${idx + 1} must be grammatically clean`);
  });
  // The 2026-11-05 regression shipped fabricated insertions like
  // "particularly in data workflows" — none may return.
  const joined = refined.join(' ');
  assert.doesNotMatch(joined, /data workflows|measurably stronger|This transition|Such functionality excels/);
});

test('nominalization inside a prepositional phrase stays grammatical', () => {
  const out = applyHumanizeTransforms(
    'Businesses that benefit from the implementation of AI are seeing gains.',
    { style: 'academic' }
  );
  assert.match(out, /benefit from implementing AI/, 'Gerund after a preposition must be lowercase and drop the article');
  assert.equal(sentenceLooksBroken(out), false);
  // The following verb must survive verbatim (no "has enabled" -> "accelerates").
  const verbKept = applyHumanizeTransforms(
    'The implementation of AI has enabled rapid developments in automation.',
    { style: 'academic' }
  );
  assert.match(verbKept, /Implementing AI has enabled rapid developments/);
});

test('academic and technical styles never receive contractions', () => {
  for (const style of ['academic', 'technical']) {
    const out = applyHumanizeTransforms(
      'It is important to note that we do not know if it is ready.',
      { style }
    );
    assert.doesNotMatch(out, /\b\w+'(?:s|t|re|ve|ll|d|m)\b/, `${style} output must be contraction-free`);
    assert.doesNotMatch(out, /important to note/i, 'AI preamble must still be removed');
  }
});

test('casual and professional styles allow correspondence contractions', () => {
  const out = applyHumanizeTransforms(
    'I am writing to follow up on our previous conversation.',
    { style: 'professional' }
  );
  assert.match(out, /I'm following up on our earlier discussion/);
  // Academic register keeps the formal form.
  const formal = applyHumanizeTransforms(
    'I am writing to follow up on our previous conversation.',
    { style: 'academic' }
  );
  assert.doesNotMatch(formal, /I'm/);
});

test('sentenceLooksBroken vetoes mechanical defects without false-positives on good prose', () => {
  assert.equal(sentenceLooksBroken('We examine$1 the data.'), true, 'literal $N injection');
  assert.equal(sentenceLooksBroken('He looked of of the window.'), true, 'doubled preposition');
  assert.equal(sentenceLooksBroken('benefit from implementing of AI'), true, 'bare gerund + of');
  assert.equal(sentenceLooksBroken('He saw the the dog.'), true, 'doubled article');
  assert.equal(sentenceLooksBroken('It costs (a lot.'), true, 'unbalanced bracket');
  assert.equal(sentenceLooksBroken('Businesses benefit from implementing AI carefully.'), false);
  assert.equal(sentenceLooksBroken('She had had enough.'), false, 'legitimate double');
  assert.equal(sentenceLooksBroken('The price rose to $100.'), false, 'currency amounts are not group artifacts');
});

test('digitsPreserved gates translation drift on numbers and statistics', () => {
  assert.equal(digitsPreserved('In 2024 we saw 12,000 units (45%).', 'In 2024 we saw 12.000 units (45%).'), true);
  assert.equal(digitsPreserved('In 2024 we saw 12,000 units.', 'In 2024 we saw 12,000 units. But 1999 passed.'), false);
  assert.equal(digitsPreserved('GDP grew 3% in 2023.', 'GDP grew 4% in 2023.'), false);
});

test('academic register: deterministic-first path adds no contractions and keeps meaning', async () => {
  // Regression for the 2026-11-06 live finding: pivot round-trips leaked
  // contractions into academic output and drifted meaning ("ready" -> "over").
  const input = 'It is important to note that we do not know if it is ready. This study delves into the mechanisms that utilize large datasets.';
  const result = await runAcademicInversion(input, { timeoutMs: 15000, style: 'academic' });
  assert.equal((result.text.match(/\b\w+'(?:s|t|re|ve|ll|d|m)\b/g) || []).length, 0, 'academic output must be contraction-free');
  assert.match(result.text, /ready/i, '"ready" must survive');
  assert.doesNotMatch(result.text, /exploit/i, '"utilize" must not become "exploit"');
  assert.notEqual(result.text.trim().toLowerCase(), input.trim().toLowerCase(), 'output must still change');
});

test('expandContractions restores formal full forms', async () => {
  const { expandContractions } = await import('../../lib/humanize-transforms.ts');
  const out = expandContractions("It's important to note that we don't know if it's been ready.");
  assert.equal(out, 'It is important to note that we do not know if it has been ready.');
});

test('localRehumanizeSentence respects register and keeps verbs intact', () => {
  const academic = localRehumanizeSentence(
    'It is important to note that the implementation of AI has enabled rapid developments in automation.',
    0,
    { style: 'academic' }
  );
  assert.doesNotMatch(academic, /\b\w+'(?:s|t|re|ve|ll|d|m)\b/, 'no contractions in academic register');
  assert.match(academic, /enabled/, 'verb preserved');
  const casual = localRehumanizeSentence('I am writing to follow up on our previous conversation.', 0, { style: 'professional' });
  assert.match(casual, /I'm following up/);
});
