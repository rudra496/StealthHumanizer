import { describe, expect, it } from 'vitest';
import {
  applyHumanizeTransforms,
  digitsPreserved,
  expandContractions,
  isFormalStyle,
  sentenceLooksBroken,
  textLooksBroken,
} from '../../lib/humanize-transforms';
import { localRehumanizeSentence } from '../../lib/rehumanize';

describe('humanize transform opener removal', () => {
  const openers = [
    ['It is important to note that machine learning helps.', 'machine learning', 'important to note'],
    ['It is worth to mention that data improves.', 'data improves', 'worth to mention'],
    ['It is crucial to highlight that results vary.', 'results vary', 'crucial to highlight'],
    ['It is essential to remember that context matters.', 'context matters', 'essential to remember'],
    ['It is imperative to mention that risk exists.', 'risk exists', 'imperative to mention'],
    ['It should be noted that evidence supports the claim.', 'evidence supports', 'should be noted'],
    ['It should also be noted that evidence supports the claim.', 'evidence supports', 'should also be noted'],
  ];

  it.each(openers)('removes opener from "%s"', (input, subject, opener) => {
    const out = applyHumanizeTransforms(input, { style: 'academic' });
    expect(out.toLowerCase()).toContain(String(subject).toLowerCase());
    expect(out.toLowerCase()).not.toContain(String(opener).toLowerCase());
  });
});

describe('humanize transform connectives', () => {
  it.each(['Furthermore', 'Moreover', 'Additionally'])('drops %s in formal register', (word) => {
    expect(applyHumanizeTransforms(`${word}, the results are clear.`, { style: 'academic' }))
      .toMatch(/^The results are clear/i);
  });
  it('maps Furthermore as casual', () => {
    expect(applyHumanizeTransforms('Furthermore, the results are clear.', { style: 'professional' }))
      .toContain('Also');
  });
  it('maps Moreover as casual', () => {
    expect(applyHumanizeTransforms('Moreover, the results are clear.', { style: 'professional' }))
      .toContain('Plus');
  });
  it('maps Additionally as casual', () => {
    expect(applyHumanizeTransforms('Additionally, the results are clear.', { style: 'professional' }))
      .toContain('In addition');
  });
  it('replaces In conclusion', () => {
    expect(applyHumanizeTransforms('In conclusion, the work succeeded.', { style: 'academic' }))
      .toMatch(/^Overall/);
  });
});

describe('humanize transform stiff phrases', () => {
  it.each([
    ['due to the fact that', 'because'],
    ['despite the fact that', 'although'],
    ['in order to', 'to'],
    ['at this point in time', 'now'],
    ['for the purpose of', 'for'],
    ['with regard to', 'regarding'],
    ['in reference to', 'about'],
    ['take into consideration', 'consider'],
    ['make a decision', 'decide'],
    ['provide assistance to', 'help'],
    ['perform an analysis of', 'analyze'],
    ['exhibits a tendency to', 'tends to'],
    ['at your earliest convenience', 'as soon as possible'],
  ])('maps "%s" to "%s"', (stiff, plain) => {
    expect(applyHumanizeTransforms(`We must ${stiff} the result.`, { style: 'academic' }).toLowerCase())
      .toContain(String(plain).toLowerCase());
  });
});

describe('humanize buzzword and phrase maps', () => {
  it.each([
    ['revolutionized the way', 'reshaped how'],
    ['revolutionized', 'transformed'],
    ['unprecedented advancements', 'rapid developments'],
    ['unprecedented', 'exceptional'],
    ['delves into', 'examines'],
    ['delve into', 'examine'],
    ['delving into', 'examining'],
    ['optimize', 'refine'],
    ['optimise', 'refine'],
    ['multifaceted', 'complex'],
    ['in modern times', 'today'],
    ["in today's world", 'today'],
    ['in the contemporary landscape', 'currently'],
    ['in the modern era', 'today'],
    ['in the realm of', 'in'],
    ['wherein', 'where'],
  ])('maps "%s" to "%s"', (source, replacement) => {
    expect(applyHumanizeTransforms(`We address ${source} outcomes.`, { style: 'academic' }).toLowerCase())
      .toContain(String(replacement).toLowerCase());
  });
  it('maps crucial role', () => {
    expect(applyHumanizeTransforms('Machine learning plays a crucial role in science.', { style: 'academic' }))
      .toContain('is central to');
  });
  it('maps a key role', () => {
    expect(applyHumanizeTransforms('Methods play a key role in science.', { style: 'academic' }))
      .toContain('are central to');
  });
  it('maps potential', () => {
    expect(applyHumanizeTransforms('This has the potential to improve.', { style: 'academic' }))
      .toContain('can');
  });
  it('maps human-like text', () => {
    expect(applyHumanizeTransforms('Models are capable of producing human-like text.', { style: 'academic' }))
      .toContain('can generate human-grade prose');
  });
  it('maps AI implementations', () => {
    expect(applyHumanizeTransforms('AI implementations improve care.', { style: 'academic' }))
      .toContain('AI deployments');
  });
});

describe('humanize contractions', () => {
  it('expands I am and common contractions', () => {
    expect(expandContractions("It's important; I am ready. We don't know.")).toBe(
      'It is important; I am ready. We do not know.',
    );
  });
  it('uses casual correspondence contractions', () => {
    expect(applyHumanizeTransforms('I am writing to follow up on our previous conversation.', { style: 'professional' }))
      .toBe("I'm following up on our earlier discussion.");
  });
  it('allows general casual contractions', () => {
    expect(applyHumanizeTransforms('I am ready; we do not know.', { style: 'casual' }))
      .toContain("I'm ready");
  });
  it.each(['academic', 'technical'])('keeps %s contraction-free', (style) => {
    const out = applyHumanizeTransforms("It is important to note that we do not know; I am ready.", { style });
    expect(out).not.toMatch(/\b(?:I'm|we're|don't|doesn't|can't)\b/);
  });
});

describe('humanize suffix verb maps', () => {
  it.each([
    ['utilize', 'use'],
    ['utilizes', 'uses'],
    ['utilized', 'used'],
    ['utilizing', 'using'],
    ['utilise', 'use'],
    ['utilises', 'uses'],
    ['leverage', 'use'],
    ['leverages', 'uses'],
    ['facilitate', 'enable'],
    ['facilitates', 'enables'],
    ['facilitated', 'enabled'],
    ['facilitating', 'enabling'],
    ['streamline', 'simplify'],
    ['streamlines', 'simplifies'],
    ['streamlined', 'simplified'],
    ['streamlining', 'simplifying'],
  ])('rewrites %s to %s', (source, replacement) => {
    expect(applyHumanizeTransforms(`Organizations ${source} operations.`, { style: 'academic' }).toLowerCase())
      .toContain(replacement);
  });
});

describe('humanize nominalizations and sentence starts', () => {
  it.each([
    ['implementation', 'Implementing'],
    ['utilization', 'Using'],
    ['utilisation', 'Using'],
    ['adoption', 'Adopting'],
    ['integration', 'Integrating'],
    ['application', 'Applying'],
    ['development', 'Developing'],
    ['execution', 'Executing'],
    ['operation', 'Operating'],
    ['deployment', 'Deploying'],
    ['analysis', 'Analyzing'],
    ['evaluation', 'Evaluating'],
    ['examination', 'Examining'],
    ['investigation', 'Investigating'],
    ['assessment', 'Assessing'],
  ])('rewrites the of %s nominalization', (noun, gerund) => {
    expect(applyHumanizeTransforms(`The ${noun} of AI improves systems.`, { style: 'academic' }))
      .toMatch(new RegExp(`^${gerund} AI`));
  });
  it('keeps mid-sentence nominalizations lowercase after prepositions', () => {
    expect(applyHumanizeTransforms('Businesses benefit from the implementation of AI.', { style: 'academic' }))
      .toContain('implementing AI');
  });
  it('re-capitalizes sentence starts after delving', () => {
    expect(applyHumanizeTransforms('Additionally, delving into data enables decisions.', { style: 'academic' }))
      .toMatch(/^Examining data/);
  });
  it('removes formal connectives before phrase rewrites', () => {
    expect(applyHumanizeTransforms('Furthermore, it is important to note that machine learning helps.', { style: 'academic' }))
      .toMatch(/^Machine learning helps/i);
  });
});

describe('grammar gates and register helpers', () => {
  it('detects replacement-group and doubled-word artifacts', () => {
    expect(sentenceLooksBroken('We examine$1 the data.')).toBe(true);
    expect(sentenceLooksBroken('He saw the the dog.')).toBe(true);
  });
  it('detects bare gerund of and unbalanced brackets', () => {
    expect(sentenceLooksBroken('benefit from implementing of AI')).toBe(true);
    expect(sentenceLooksBroken('It costs (a lot.')).toBe(true);
  });
  it('accepts good prose and legitimate doubles', () => {
    expect(sentenceLooksBroken('Businesses benefit from implementing AI carefully.')).toBe(false);
    expect(sentenceLooksBroken('She had had enough.')).toBe(false);
  });
  it('checks every sentence with textLooksBroken', () => {
    expect(textLooksBroken('Good prose. He saw the the dog.')).toBe(true);
  });
  it('preserves digit runs', () => {
    expect(digitsPreserved('In 2024, 12,000 units (45%).', 'In 2024, 12.000 units (45%).')).toBe(true);
    expect(digitsPreserved('GDP grew 3% in 2023.', 'GDP grew 4% in 2023.')).toBe(false);
  });
  it('identifies formal styles', () => {
    expect(isFormalStyle('academic')).toBe(true);
    expect(isFormalStyle('technical')).toBe(true);
    expect(isFormalStyle('professional')).toBe(false);
  });
  it('keeps local rehumanization register-aware', () => {
    expect(localRehumanizeSentence('I am writing to follow up.', 0, { style: 'professional' }))
      .toContain("I'm");
  });
});
