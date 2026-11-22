// Unit tests for the AI detection engine

import { detectAI, getScoreColor, getClassificationColor, getScoreBarColor, calibrateWithCorpus, getHumanScoreRange } from '../detector';

describe('splitIntoSentences', () => {
  it('splits on periods', () => {
    const result = detectAI('Hello world. This is a test. Another one.');
    expect(result.sentences).toHaveLength(3);
  });
  it('handles abbreviations', () => {
    const result = detectAI('Dr. Smith went to the store. He bought milk.');
    expect(result.sentences).toHaveLength(2);
  });
  it('handles single sentence', () => {
    const result = detectAI('Just one sentence here.');
    expect(result.sentences).toHaveLength(1);
  });
  it('handles empty text', () => {
    const result = detectAI('');
    expect(result.sentences).toHaveLength(0);
  });
  it('handles question marks and exclamation', () => {
    const result = detectAI('What is this? It is great! I agree.');
    expect(result.sentences.length).toBeGreaterThanOrEqual(2);
  });
});

describe('calculatePerplexity', () => {
  it('returns low score for repetitive text', () => {
    const result = detectAI('the the the the the the the the the the the the the the the the the the the the the the');
    expect(result.analysis.perplexity).toBeLessThan(50);
  });
  it('returns higher score for diverse vocabulary', () => {
    const text = 'The quick brown fox jumps over the lazy dog. Beautiful sunset painted orange across horizon. Philosophical arguments require careful examination of premises.';
    const result = detectAI(text);
    expect(result.analysis.perplexity).toBeGreaterThan(30);
  });
  it('returns 50 for very short text', () => {
    const result = detectAI('hi');
    expect(result.analysis.perplexity).toBe(50);
  });
});

describe('calculateBurstiness', () => {
  it('gives low burstiness for uniform sentence lengths', () => {
    const uniform = 'The cat sat on the mat. The dog ran in the park. The bird flew in the sky. The fish swam in the sea. The cow ate green grass now.';
    const result = detectAI(uniform);
    expect(result.analysis.burstiness).toBeLessThan(70);
  });
  it('gives higher burstiness for varied lengths', () => {
    const varied = 'Hi. This is a moderately long sentence that has quite a few words in it, more than the short one. OK. The quick brown fox jumped over the lazy dog and then ran all the way to the other side of the field where the other animals were waiting. Yo!';
    const result = detectAI(varied);
    expect(result.analysis.burstiness).toBeGreaterThan(20);
  });
  it('returns 50 for less than 3 sentences', () => {
    const result = detectAI('Hello. Goodbye.');
    expect(result.analysis.burstiness).toBe(50);
  });
});

describe('calculateVocabularyDiversity', () => {
  it('returns high diversity for unique words', () => {
    const text = 'Apple banana cherry date elderberry fig grape honeydew kiwi lemon mango nectarine orange peach quince raspberry strawberry tangerine';
    const result = detectAI(text);
    expect(result.analysis.vocabularyDiversity).toBeGreaterThan(80);
  });
  it('returns low diversity for repeated words', () => {
    const text = 'the the the the the the the the the the the the the the the the the the the the the the the the the the the the the the the';
    const result = detectAI(text);
    expect(result.analysis.vocabularyDiversity).toBeLessThan(20);
  });
});

describe('calculateAIPhraseDensity', () => {
  it('detects AI-typical phrases', () => {
    const aiText = 'It is important to note that furthermore it is worth mentioning that in conclusion it is crucial to understand that moreover it is essential to recognize that additionally it is worth noting that';
    const result = detectAI(aiText);
    expect(result.analysis.aiPhraseDensity).toBeGreaterThan(30);
  });
  it('gives low density for natural text', () => {
    const humanText = 'I went to the store today and bought some stuff. It was pretty good honestly. Kind of expensive though, you know? Anyway, I think it was worth it.';
    const result = detectAI(humanText);
    expect(result.analysis.aiPhraseDensity).toBeLessThan(20);
  });
});

describe('calculateSentenceStartDiversity', () => {
  it('gives low diversity for repetitive starters', () => {
    const text = 'The cat ran fast. The dog barked loudly. The bird sang sweetly. The fish swam quickly. The cow mooed loudly.';
    const result = detectAI(text);
    expect(result.analysis.sentenceStartDiversity).toBeLessThan(40);
  });
  it('gives high diversity for varied starters', () => {
    const text = 'Running fast, the cat escaped. However, the dog chased it. Suddenly, a loud noise! Birds flew away quickly. In the end, everyone was safe.';
    const result = detectAI(text);
    expect(result.analysis.sentenceStartDiversity).toBeGreaterThan(50);
  });
  it('returns 50 for fewer than 4 sentences', () => {
    const result = detectAI('One. Two. Three.');
    expect(result.analysis.sentenceStartDiversity).toBe(50);
  });
});

describe('calculatePassiveVoiceRatio', () => {
  it('detects passive voice', () => {
    const text = 'The ball was thrown by the boy. The window was broken by the storm. The car was parked by the driver.';
    const result = detectAI(text);
    expect(result.analysis.passiveVoiceRatio).toBeGreaterThan(30);
  });
  it('returns low for active voice', () => {
    const text = 'The boy threw the ball. The storm broke the window. The driver parked the car.';
    const result = detectAI(text);
    expect(result.analysis.passiveVoiceRatio).toBeLessThan(20);
  });
});

describe('calculateTransitionFrequency', () => {
  it('detects transition overuse', () => {
    const text = 'Furthermore, this shows that moreover, the study indicates however, there are limitations. Additionally, the results suggest consequently, we conclude that furthermore, the data supports.';
    const result = detectAI(text);
    expect(result.analysis.transitionFrequency).toBeGreaterThan(30);
  });
});

describe('detectAI - overall scoring', () => {
  it('returns a score between 0 and 100', () => {
    const result = detectAI('This is some sample text for testing purposes.');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
  it('returns confidence interval', () => {
    const result = detectAI('This is some sample text for testing purposes.');
    expect(result.confidenceInterval.lower).toBeGreaterThanOrEqual(0);
    expect(result.confidenceInterval.upper).toBeLessThanOrEqual(100);
    expect(result.confidenceInterval.lower).toBeLessThanOrEqual(result.confidenceInterval.upper);
  });
  it('returns verdict', () => {
    const result = detectAI('This is some sample text for testing purposes.');
    expect(['human', 'ai', 'mixed']).toContain(result.overallVerdict);
  });
  it('returns sentence-level results', () => {
    const result = detectAI('First sentence. Second sentence. Third sentence.');
    expect(result.sentences.length).toBe(3);
    result.sentences.forEach(s => {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
      expect(['human', 'maybe', 'ai']).toContain(s.classification);
    });
  });
  it('includes readability metrics', () => {
    const result = detectAI('This is some sample text for testing purposes.');
    expect(result.readability).toBeDefined();
    expect(result.readability.fleschReadingEase).toBeDefined();
    expect(result.readability.fleschKincaidGrade).toBeDefined();
  });
});

describe('getScoreColor', () => {
  it('returns green for high scores', () => expect(getScoreColor(80)).toBe('text-green-400'));
  it('returns yellow for medium scores', () => expect(getScoreColor(55)).toBe('text-yellow-400'));
  it('returns red for low scores', () => expect(getScoreColor(30)).toBe('text-red-400'));
});

describe('getClassificationColor', () => {
  it('returns green for human', () => expect(getClassificationColor('human')).toBe('bg-green-500/20 border-green-500/50'));
  it('returns yellow for maybe', () => expect(getClassificationColor('maybe')).toBe('bg-yellow-500/20 border-yellow-500/50'));
  it('returns red for ai', () => expect(getClassificationColor('ai')).toBe('bg-red-500/20 border-red-500/50'));
});

describe('getScoreBarColor', () => {
  it('returns green for high scores', () => expect(getScoreBarColor(80)).toBe('bg-green-500'));
  it('returns yellow for medium scores', () => expect(getScoreBarColor(55)).toBe('bg-yellow-500'));
  it('returns red for low scores', () => expect(getScoreBarColor(30)).toBe('bg-red-500'));
});

describe('calibrateWithCorpus', () => {
  it('returns calibrated thresholds', () => {
    const thresholds = calibrateWithCorpus({
      generatedAt: '2024-01-01',
      paperCount: 100,
      global: {
        avgSentenceLength: 15,
        avgBurstiness: 0.35,
        avgVocabularyDiversity: 0.65,
        avgContractionFrequency: 1.0,
        avgPassiveVoiceRatio: 15,
        avgFirstPersonPronouns: 5,
        avgHedgingFrequency: 8,
        avgWordsPerParagraph: 80,
      },
      byDomain: {},
      sentenceLengthDistribution: { mean: 20, median: 18, stddev: 8, min: 5, max: 50, p10: 8, p25: 13, p75: 27, p90: 35 },
      burstinessProfile: { mean: 50, stddev: 20 },
      vocabularyDiversityRange: { mean: 65, min: 40, max: 90 },
      transitionWordFrequency: { 'however': 5, 'therefore': 3, 'moreover': 2 },
      aiPhraseFrequency: {},
      contractionFrequency: { mean: 1.0, stddev: 0.5 },
      passiveVoiceRatio: { mean: 15, stddev: 5 },
      sentenceStarters: {},
      humanWritingExamples: [],
      punctuation: {
        emDashPer1000: { mean: 0.5, stddev: 0.3 },
        semicolonPer1000: { mean: 1.0, stddev: 0.5 },
        exclamationPer1000: { mean: 0.5, stddev: 0.3 },
      },
    });
    expect(thresholds.humanScoreMin).toBe(55);
    expect(thresholds.burstinessFloor).toBeDefined();
    expect(thresholds.vocabularyFloor).toBeDefined();
  });
});

describe('getHumanScoreRange', () => {
  it('returns default range when not calibrated', () => {
    const range = getHumanScoreRange();
    expect(range.min).toBe(50);
    expect(range.max).toBe(90);
    expect(range.median).toBe(70);
  });
  it('returns calibrated range after calibration', () => {
    calibrateWithCorpus({
      generatedAt: '2024-01-01',
      paperCount: 100,
      global: {
        avgSentenceLength: 15,
        avgBurstiness: 0.35,
        avgVocabularyDiversity: 0.65,
        avgContractionFrequency: 1.0,
        avgPassiveVoiceRatio: 15,
        avgFirstPersonPronouns: 5,
        avgHedgingFrequency: 8,
        avgWordsPerParagraph: 80,
      },
      byDomain: {},
      sentenceLengthDistribution: { mean: 20, median: 18, stddev: 8, min: 5, max: 50, p10: 8, p25: 13, p75: 27, p90: 35 },
      burstinessProfile: { mean: 50, stddev: 20 },
      vocabularyDiversityRange: { mean: 65, min: 40, max: 90 },
      transitionWordFrequency: { 'however': 5 },
      aiPhraseFrequency: {},
      contractionFrequency: { mean: 1.0, stddev: 0.5 },
      passiveVoiceRatio: { mean: 15, stddev: 5 },
      sentenceStarters: {},
      humanWritingExamples: [],
      punctuation: {
        emDashPer1000: { mean: 0.5, stddev: 0.3 },
        semicolonPer1000: { mean: 1.0, stddev: 0.5 },
        exclamationPer1000: { mean: 0.5, stddev: 0.3 },
      },
    });
    const range = getHumanScoreRange();
    expect(range.min).toBe(55);
  });
});
