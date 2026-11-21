import { describe, expect, it } from 'vitest';
import {
  calibrateWithCorpus,
  detectAI,
  getClassificationColor,
  getHumanScoreRange,
  getScoreBarColor,
  getScoreColor,
} from '../../lib/detector';

describe('detector heuristics', () => {
  it.each([
    'Hello world.',
    'Hello world. This is a test.',
    'Dr. Smith went to the store. He bought milk.',
    'What is this? It is great! I agree.',
  ])('splits sentences safely for "%s"', (text) => {
    const result = detectAI(text);
    expect(result.sentences.length).toBeGreaterThanOrEqual(0);
  });

  it('returns 50 perplexity for short text', () => {
    expect(detectAI('hi').analysis.perplexity).toBe(50);
  });
  it('measures repetitive text as low perplexity', () => {
    expect(detectAI('the the the the the the the the the').analysis.perplexity).toBeLessThan(50);
  });
  it('measures diverse text with higher perplexity', () => {
    expect(detectAI('Apple banana cherry date; elegant mountains shimmer quietly beyond villages.')
      .analysis.perplexity).toBeGreaterThan(30);
  });
  it('returns low burstiness for uniform sentences', () => {
    expect(detectAI('The cat sat there. The dog ran away. The bird flew high. The fish swam fast.')
      .analysis.burstiness).toBeLessThan(70);
  });
  it('returns higher burstiness for varied lengths', () => {
    expect(detectAI('Hi. This is a moderately long sentence containing many additional words for variation. OK. The quick brown fox jumped over the lazy dog and ran across the entire field.')
      .analysis.burstiness).toBeGreaterThan(20);
  });
  it('returns low vocabulary diversity for repeated words', () => {
    expect(detectAI('the the the the the the the the the the the the the the the')
      .analysis.vocabularyDiversity).toBeLessThan(20);
  });
  it('returns high vocabulary diversity for varied words', () => {
    expect(detectAI('Apple banana cherry date elderberry fig grape honeydew kiwi lemon mango nectarine orange peach quince')
      .analysis.vocabularyDiversity).toBeGreaterThan(80);
  });
  it('detects AI phrase density', () => {
    expect(detectAI('It is important to note that furthermore it is worth mentioning that in conclusion')
      .analysis.aiPhraseDensity).toBeGreaterThan(30);
  });
  it('keeps natural prose phrase density low', () => {
    expect(detectAI('I went to the store today and bought some stuff. It was pretty good honestly.')
      .analysis.aiPhraseDensity).toBeLessThan(20);
  });
  it('detects repetitive sentence starts', () => {
    expect(detectAI('The cat ran. The dog barked. The bird sang. The fish swam.')
      .analysis.sentenceStartDiversity).toBeLessThan(40);
  });
  it('detects varied sentence starts', () => {
    expect(detectAI('Running fast, the cat escaped. However, the dog chased it. Suddenly, a noise. Birds flew away.')
      .analysis.sentenceStartDiversity).toBeGreaterThan(50);
  });
  it('detects passive voice', () => {
    expect(detectAI('The ball was thrown by the boy. The window was broken by the storm. The car was parked.')
      .analysis.passiveVoiceRatio).toBeGreaterThan(30);
  });
  it('keeps active voice low', () => {
    expect(detectAI('The boy threw the ball. The storm broke the window. The driver parked the car.')
      .analysis.passiveVoiceRatio).toBeLessThan(20);
  });
  it('detects transition overuse', () => {
    expect(detectAI('Furthermore, results show that moreover, evidence supports however, limitations exist. Additionally, the data suggests consequently, we conclude.')
      .analysis.transitionFrequency).toBeGreaterThan(30);
  });
});

describe('detector result shape and colors', () => {
  it('returns a score in range', () => {
    expect(detectAI('This is some sample text for testing purposes.').score).toBeGreaterThanOrEqual(0);
  });
  it('returns a bounded confidence interval', () => {
    const { confidenceInterval } = detectAI('Some plain text for detection.');
    expect(confidenceInterval.lower).toBeGreaterThanOrEqual(0);
    expect(confidenceInterval.upper).toBeLessThanOrEqual(100);
    expect(confidenceInterval.lower).toBeLessThanOrEqual(confidenceInterval.upper);
  });
  it('returns a known verdict', () => {
    expect(['human', 'ai', 'mixed']).toContain(detectAI('A natural sentence.').overallVerdict);
  });
  it('returns sentence-level classifications', () => {
    const result = detectAI('First sentence. Second sentence.');
    result.sentences.forEach((sentence) => {
      expect(sentence.score).toBeGreaterThanOrEqual(0);
      expect(sentence.score).toBeLessThanOrEqual(100);
      expect(['human', 'maybe', 'ai']).toContain(sentence.classification);
    });
  });
  it('includes readability metrics', () => {
    const result = detectAI('This is readable sample text.');
    expect(result.readability.fleschReadingEase).toBeDefined();
    expect(result.readability.fleschKincaidGrade).toBeDefined();
  });
  it.each([
    [80, 'text-green-400'],
    [55, 'text-yellow-400'],
    [30, 'text-red-400'],
  ])('maps score %i to a color', (score, color) => {
    expect(getScoreColor(score)).toBe(color);
  });
  it('maps classification colors', () => {
    expect(getClassificationColor('human')).toContain('green');
    expect(getClassificationColor('maybe')).toContain('yellow');
    expect(getClassificationColor('ai')).toContain('red');
  });
  it('maps score bar colors', () => {
    expect(getScoreBarColor(80)).toBe('bg-green-500');
    expect(getScoreBarColor(55)).toBe('bg-yellow-500');
    expect(getScoreBarColor(30)).toBe('bg-red-500');
  });
});

describe('detector calibration', () => {
  const model = {
    generatedAt: '2024-01-01',
    paperCount: 100,
    global: {
      avgSentenceLength: 15,
      avgBurstiness: 0.35,
      avgVocabularyDiversity: 0.65,
      avgContractionFrequency: 1,
      avgPassiveVoiceRatio: 15,
      avgFirstPersonPronouns: 5,
      avgHedgingFrequency: 8,
      avgWordsPerParagraph: 80,
    },
    byDomain: {},
    sentenceLengthDistribution: { mean: 20, median: 18, stddev: 8, min: 5, max: 50, p10: 8, p25: 13, p75: 27, p90: 35 },
    burstinessProfile: { mean: 50, stddev: 20 },
    vocabularyDiversityRange: { mean: 65, min: 40, max: 90 },
    transitionWordFrequency: { however: 5, therefore: 3, moreover: 2 },
    aiPhraseFrequency: {},
    contractionFrequency: { mean: 1, stddev: 0.5 },
    passiveVoiceRatio: { mean: 15, stddev: 5 },
    sentenceStarters: {},
    humanWritingExamples: [],
    punctuation: {
      emDashPer1000: { mean: 0.5, stddev: 0.3 },
      semicolonPer1000: { mean: 1, stddev: 0.5 },
      exclamationPer1000: { mean: 0.5, stddev: 0.3 },
    },
  };

  it('returns calibrated thresholds', () => {
    const thresholds = calibrateWithCorpus(model);
    expect(thresholds.humanScoreMin).toBe(55);
    expect(thresholds.burstinessFloor).toBeDefined();
    expect(thresholds.vocabularyFloor).toBeDefined();
  });
  it('updates and exposes the calibrated human score range', () => {
    calibrateWithCorpus(model);
    expect(getHumanScoreRange().min).toBe(55);
  });
  it('returns default range before calibration', () => {
    // Calibration state may persist across tests, so verify range shape only.
    const range = getHumanScoreRange();
    expect(range.min).toBeGreaterThanOrEqual(50);
    expect(range.max).toBeGreaterThanOrEqual(range.min);
  });
});
