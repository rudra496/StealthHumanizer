// ✅ NOOB EXPLAINER: What is "Fidelity"?
// "Fidelity" means faithfulness. When we humanize text, we want to
// change HOW it sounds but keep WHAT it says. Fidelity validation
// checks that the meaning wasn't lost or changed during humanization.
//
// Example:
//   Original: "The study found that exercise reduces stress."
//   Humanized: "Exercise cuts stress, the study showed." ← HIGH fidelity (same meaning)
//   Humanized: "The study found that exercise increases stress." ← LOW fidelity (meaning CHANGED!)
//
// We measure this using "embeddings" — mathematical representations
// of meaning. Two sentences with similar meanings will have similar
// embeddings, even if they use completely different words.

export interface FidelityResult {
  overall: number;    // 0-1 overall meaning preservation score
  perSentence: SentenceFidelity[];
  flaggedDrift: DriftInstance[];  // Sentences where meaning changed too much
}

export interface SentenceFidelity {
  original: string;
  humanized: string;
  score: number;      // 0-1 per-sentence fidelity
  method: 'embedding' | 'keyword' | 'combined';
}

export interface DriftInstance {
  original: string;
  humanized: string;
  score: number;
  severity: 'low' | 'medium' | 'high';
  suggestion: string;
}

// Thresholds for fidelity scores
export const FIDELITY_THRESHOLDS = {
  excellent: 0.90,  // Meaning very well preserved
  good: 0.80,       // Minor changes, core meaning intact
  acceptable: 0.70, // Some drift, but key points preserved
  poor: 0.60,       // Significant meaning change
  critical: 0.50,   // Meaning likely lost or reversed
};
