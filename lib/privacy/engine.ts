// 🏭 NOOB EXPLAINER: The Privacy Mode Engine
// This is the "factory" that processes text entirely in your browser.
// It uses transformers.js (by HuggingFace) which can run AI models
// using WebAssembly — no server needed!
//
// How it works:
// 1. Download a small language model to your browser (~50-200MB)
// 2. When you click "Humanize", the model runs on YOUR device
// 3. Your text never goes anywhere — it stays in your browser's memory
// 4. The result is shown to you directly
//
// This is slower than server-side AI but 100% private.

import type { PrivacyModeConfig, PrivacyModeResult } from './types';

// 🤖 NOOB EXPLAINER: Model definitions
// These are the AI models that can run in the browser. Each one is
// a different size/quality trade-off:
// - small: ~50MB download, fast, basic quality
// - medium: ~150MB download, moderate speed, good quality
// - large: ~300MB download, slow, best quality
const MODEL_IDS = {
  small: 'Xenova/distilgpt2',           // 66M params, ~50MB
  medium: 'Xenova/gpt2',                // 124M params, ~150MB
  large: 'Xenova/opt-350m',             // 350M params, ~300MB
} as const;

// 📝 NOOB EXPLAINER: Humanization strategies
// Since browser models are smaller than GPT-4, we can't just ask them
// to "rewrite to sound human." Instead, we use RULE-BASED transformations
// that are proven to reduce AI detection scores:
const HUMANIZATION_STRATEGIES = {
  // 🔄 Strategy 1: Sentence restructuring
  // Split long sentences, merge short ones, reorder clauses
  restructure: true,
  
  // 🎲 Strategy 2: Vocabulary variation
  // Replace AI-typical words with human alternatives
  vocabularySwap: true,
  
  // 📏 Strategy 3: Length variation injection
  // Force varying sentence lengths (short, long, medium, etc.)
  lengthVariation: true,
  
  // 🏷️ Strategy 4: Punctuation humanization
  // Add contractions, em-dashes, parentheticals
  punctuationHumanize: true,
  
  // 🔀 Strategy 5: Register mixing
  // Alternate between formal and casual within paragraphs
  registerMix: true,
};

export class PrivacyModeEngine {
  private config: PrivacyModeConfig;
  private pipeline: any = null; // Will be a transformers.js pipeline
  private isLoaded = false;
  private loadPromise: Promise<void> | null = null;

  constructor(config: PrivacyModeConfig) {
    this.config = config;
  }

  // 📥 NOOB EXPLAINER: Loading the model
  // Before we can process text, we need to download the AI model.
  // This only happens once — after that, the model is cached by
  // the browser and loads instantly next time.
  async load(): Promise<void> {
    if (this.isLoaded) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = this._loadModel();
    await this.loadPromise;
  }

  private async _loadModel(): Promise<void> {
    try {
      this.config.onProgress?.(0.1, 'Downloading AI model...');
      
      // 📦 NOOB EXPLAINER: Dynamic import
      // We only load the transformers.js library when the user
      // actually wants Privacy Mode. This saves ~5MB of JavaScript
      // for users who don't use this feature.
      const { pipeline } = await import('@huggingface/transformers');
      
      this.config.onProgress?.(0.3, 'Loading model into memory...');
      
      const modelId = MODEL_IDS[this.config.modelSize];
      
      this.pipeline = await pipeline(
        'text-generation',
        modelId,
        {
          progress_callback: (progress: any) => {
            if (progress.status === 'progress' && progress.progress) {
              const pct = 0.3 + (progress.progress / 100) * 0.6;
              this.config.onProgress?.(pct, `Downloading: ${progress.progress.toFixed(0)}%`);
            }
          },
        }
      );
      
      this.config.onProgress?.(0.95, 'Model loaded! Preparing...');
      this.isLoaded = true;
      this.config.onProgress?.(1.0, 'Ready');
    } catch (error) {
      this.loadPromise = null;
      throw new Error(`Failed to load privacy mode model: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // ✨ NOOB EXPLAINER: The main humanization function
  // This processes text entirely in the browser. It first applies
  // rule-based transformations (which are fast and reliable), then
  // optionally uses the browser-based AI model for final polishing.
  async humanize(text: string, options?: { style?: string; level?: string }): Promise<PrivacyModeResult> {
    const startTime = Date.now();
    
    if (!this.isLoaded) {
      await this.load();
    }

    let result = text;

    // Step 1: Rule-based transformations (fast, no model needed)
    if (HUMANIZATION_STRATEGIES.vocabularySwap) {
      result = this.applyVocabularySwaps(result);
    }
    if (HUMANIZATION_STRATEGIES.restructure) {
      result = this.applyRestructuring(result);
    }
    if (HUMANIZATION_STRATEGIES.lengthVariation) {
      result = this.applyLengthVariation(result);
    }
    if (HUMANIZATION_STRATEGIES.punctuationHumanize) {
      result = this.applyPunctuationHumanize(result);
    }
    if (HUMANIZATION_STRATEGIES.registerMix) {
      result = this.applyRegisterMix(result);
    }

    // Step 2: AI model polishing (if available)
    if (this.pipeline) {
      try {
        result = await this.modelPolish(result, options);
      } catch {
        // If model fails, still return the rule-based result
        // 🛡️ NOOB EXPLAINER: Graceful degradation
        // If the AI model fails (out of memory, etc.), we still
        // return the rule-based result. Something is better than nothing!
      }
    }

    const processingTimeMs = Date.now() - startTime;
    const modificationScore = this.calculateModificationScore(text, result);

    return {
      text: result,
      modificationScore,
      processingTimeMs,
      modelUsed: MODEL_IDS[this.config.modelSize],
      usedWebWorker: this.config.useWebWorker,
    };
  }

  // 🔄 NOOB EXPLAINER: Vocabulary swapping
  // Replace words that AI detectors flag with human alternatives.
  // This is a DETERMINISTIC transformation (same input → same output)
  // so it's very reliable, unlike asking an LLM to "be creative."
  private applyVocabularySwaps(text: string): string {
    const swaps: [RegExp, string][] = [
      [/\bfurthermore\b/gi, 'also'],
      [/\bmoreover\b/gi, 'plus'],
      [/\badditionally\b/gi, 'and'],
      [/\bconsequently\b/gi, 'so'],
      [/\bnevertheless\b/gi, 'still'],
      [/\butilize\b/gi, 'use'],
      [/\bfacilitate\b/gi, 'help'],
      [/\bimplement\b/gi, 'do'],
      [/\bdemonstrate\b/gi, 'show'],
      [/\bnumerous\b/gi, 'many'],
      [/\bsignificant\b/gi, 'big'],
      [/\bsubsequently\b/gi, 'then'],
      [/\bapproximately\b/gi, 'about'],
      [/\bendeavor\b/gi, 'try'],
      [/\bcommence\b/gi, 'start'],
      [/\bterminate\b/gi, 'end'],
      [/\bascertain\b/gi, 'find out'],
      [/\bdisseminate\b/gi, 'spread'],
      [/\bmitigate\b/gi, 'reduce'],
      [/\bleverage\b/gi, 'use'],
    ];
    
    let result = text;
    for (const [pattern, replacement] of swaps) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  // 🔀 NOOB EXPLAINER: Sentence restructuring
  // Split sentences at natural break points and reorder clauses.
  // This breaks the "uniform syntax" pattern that AI detectors look for.
  private applyRestructuring(text: string): string {
    let result = text;
    
    // Split sentences with "because" — put the reason first
    result = result.replace(/(\w+)\s+because\s+/g, (_, subject, offset) => {
      if (Math.random() > 0.5) return `Since `; // 50% chance to restructure
      return `${subject} because `;
    });
    
    // Add parenthetical asides to break up long sentences
    const sentences = result.match(/[^.!?]+[.!?]+/g) || [];
    const asides = [
      '(which makes sense)',
      '(for the most part)',
      '(—and this is important)',
      '(roughly speaking)',
      '(in practice, anyway)',
    ];
    
    result = sentences.map(s => {
      const words = s.trim().split(/\s+/);
      if (words.length > 20 && Math.random() > 0.6) {
        const insertPoint = Math.floor(words.length * 0.6);
        const aside = asides[Math.floor(Math.random() * asides.length)];
        words.splice(insertPoint, 0, aside);
      }
      return words.join(' ');
    }).join(' ');
    
    return result;
  }

  // 📏 NOOB EXPLAINER: Length variation
  // AI writes sentences of similar length. Humans don't.
  // This splits some long sentences and merges some short ones.
  private applyLengthVariation(text: string): string {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
    
    return sentences.map(s => {
      const words = s.trim().split(/\s+/);
      
      // Split very long sentences (>30 words) at a natural point
      if (words.length > 30) {
        const midPoint = Math.floor(words.length / 2);
        // Find nearest comma or conjunction
        let splitPoint = midPoint;
        for (let i = midPoint - 3; i <= midPoint + 3; i++) {
          if (words[i]?.match(/^(and|but|or|so|which|that|while|although)$/i)) {
            splitPoint = i;
            break;
          }
        }
        const first = words.slice(0, splitPoint).join(' ');
        const second = words.slice(splitPoint).join(' ');
        return `${first}. ${second.charAt(0).toUpperCase()}${second.slice(1)}`;
      }
      
      return s;
    }).join(' ');
  }

  // 🏷️ NOOB EXPLAINER: Punctuation humanization
  // AI is very consistent with punctuation. Humans are messy.
  // This adds contractions, em-dashes, and other human markers.
  private applyPunctuationHumanize(text: string): string {
    let result = text;
    
    // Expand some formal contractions
    result = result.replace(/\bdo not\b/g, "don't");
    result = result.replace(/\bcannot\b/g, "can't");
    result = result.replace(/\bwill not\b/g, "won't");
    result = result.replace(/\bit is\b/g, "it's");
    result = result.replace(/\bthat is\b/g, "that's");
    result = result.replace(/\bthey are\b/g, "they're");
    result = result.replace(/\bwe are\b/g, "we're");
    result = result.replace(/\bis not\b/g, "isn't");
    result = result.replace(/\bare not\b/g, "aren't");
    result = result.replace(/\bdid not\b/g, "didn't");
    result = result.replace(/\bhave not\b/g, "haven't");
    result = result.replace(/\bwould not\b/g, "wouldn't");
    result = result.replace(/\bshould not\b/g, "shouldn't");
    result = result.replace(/\bcould not\b/g, "couldn't");
    
    // Add occasional em-dashes
    const sentences = result.match(/[^.!?]+[.!?]+/g) || [];
    result = sentences.map(s => {
      const words = s.trim().split(/\s+/);
      if (words.length > 15 && Math.random() > 0.7) {
        const insertPoint = 5 + Math.floor(Math.random() * (words.length - 8));
        words.splice(insertPoint, 0, '—');
      }
      return words.join(' ');
    }).join(' ');
    
    return result;
  }

  // 🎭 NOOB EXPLAINER: Register mixing
  // AI text is consistently formal or consistently casual.
  // Humans naturally mix registers within a paragraph.
  private applyRegisterMix(text: string): string {
    const paragraphs = text.split(/\n\n+/);
    
    return paragraphs.map(p => {
      const sentences = p.match(/[^.!?]+[.!?]+/g) || [];
      if (sentences.length < 3) return p;
      
      // Insert a casual aside in formal text
      const casualAsides = [
        '—which is kind of wild—',
        '—honestly—',
        '—basically—',
        '—the short version is—',
        '—and here\'s the thing—',
      ];
      
      return sentences.map((s, i) => {
        // Add a casual aside to ~1 in 5 sentences
        if (i > 0 && i % 5 === 0 && Math.random() > 0.3) {
          const aside = casualAsides[Math.floor(Math.random() * casualAsides.length)];
          return s.trim().replace(/\.\s*$/, ` ${aside}. `);
        }
        return s;
      }).join(' ');
    }).join('\n\n');
  }

  // 🤖 NOOB EXPLAINER: AI model polishing
  // After rule-based transformations, we can optionally use the
  // browser-based AI model for a final "polish" pass. This helps
  // smooth out any awkwardness from the rule-based changes.
  private async modelPolish(text: string, options?: { style?: string; level?: string }): Promise<string> {
    if (!this.pipeline) return text;
    
    const prompt = `Rewrite this text to sound more natural and human-like, keeping the same meaning:\n\n${text.substring(0, 500)}`;
    
    try {
      const output = await this.pipeline(prompt, {
        max_new_tokens: Math.min(text.split(/\s+/).length * 1.2, 512),
        temperature: 0.9,
        top_p: 0.95,
        do_sample: true,
      });
      
      const generated = Array.isArray(output) ? output[0]?.generated_text : output?.generated_text;
      if (generated && typeof generated === 'string') {
        // Extract only the new text (after the prompt)
        const newPart = generated.substring(prompt.length).trim();
        if (newPart.length > 50) {
          return newPart;
        }
      }
    } catch {
      // Model failed — return rule-based result
    }
    
    return text;
  }

  // 📊 NOOB EXPLAINER: Modification score
  // This measures how much the text changed. 0 = identical, 1 = completely different.
  // We use a simple word-overlap metric.
  private calculateModificationScore(original: string, modified: string): number {
    const origWords = new Set(original.toLowerCase().split(/\s+/));
    const modWords = new Set(modified.toLowerCase().split(/\s+/));
    
    let unchanged = 0;
    origWords.forEach(w => { if (modWords.has(w)) unchanged++; });
    
    return 1 - (unchanged / Math.max(origWords.size, 1));
  }

  // 🧹 NOOB EXPLAINER: Cleanup
  // When the user switches away from Privacy Mode, we should free
  // up the memory used by the model. This can be ~300MB!
  async dispose(): Promise<void> {
    if (this.pipeline) {
      // transformers.js doesn't have a formal dispose method,
      // but we can clear our reference and let GC handle it
      this.pipeline = null;
      this.isLoaded = false;
      this.loadPromise = null;
    }
  }
}
