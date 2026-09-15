// StealthHumanizer v3 - Anti-Detection Prompt Engine
// Rewritten to actually defeat AI detectors by disrupting statistical fingerprints

import { StylePreset } from './types';
import q1Vocab from '../data/q1_vocabulary.json';

// Helper to shuffle and sample an array
function sample<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, n);
}

function getQ1VocabularyInjection(): string {
  if (!q1Vocab || !q1Vocab.vocabulary || !q1Vocab.phrases) return '';
  const vocabSample = sample(q1Vocab.vocabulary, 10).join(', ');
  const phraseSample = sample(q1Vocab.phrases, 3).map(p => `"${p}"`).join(', ');
  return `
4. Q1 VOCABULARY INJECTION (CRITICAL FOR AI DETECTION BYPASS):
You MUST incorporate at least 5 of the following high-tier academic words in your rewrite:
[ ${vocabSample} ]
You MUST incorporate at least 1 of the following transition phrases:
[ ${phraseSample} ]`;
}

// ==================== TONE CONFIGURATIONS ====================

export const TONE_CONFIGS: Record<string, {
  name: string; personalityTraits: string[]; vocabularyPreferences: string[];
  writingPatterns: string[];
}> = {
  'academic-formal': {
    name: 'Academic Formal',
    personalityTraits: ['rigorous', 'evidence-based', 'precise', 'measured'],
    vocabularyPreferences: ['demonstrates', 'suggests', 'indicates', 'argues', 'contends', 'posits'],
    writingPatterns: ['thesis-evidence structure', 'hedging language', 'citation-style references', 'counterarguments'],
  },
  'academic-casual': {
    name: 'Academic Casual',
    personalityTraits: ['thoughtful', 'accessible', 'curious', 'balanced'],
    vocabularyPreferences: ['think about', 'look at', 'interesting', 'makes sense', 'worth noting', 'raises the question'],
    writingPatterns: ['conversational academic tone', 'occasional first person', 'relatable examples', 'questions to reader'],
  },
  'journalistic': {
    name: 'Journalistic',
    personalityTraits: ['direct', 'informative', 'engaging', 'fact-driven'],
    vocabularyPreferences: ['according to', 'reports show', 'experts say', 'data reveals', 'investigation found'],
    writingPatterns: ['inverted pyramid', 'short punchy paragraphs', 'direct quotes', 'attributed claims'],
  },
  'creative-writing': {
    name: 'Creative Writing',
    personalityTraits: ['imaginative', 'expressive', 'evocative', 'unique voice'],
    vocabularyPreferences: ['vivid adjectives', 'sensory details', 'metaphors', 'figurative language'],
    writingPatterns: ['show don\'t tell', 'varied sentence rhythm', 'imagery-rich', 'emotional depth'],
  },
  'conversational': {
    name: 'Conversational',
    personalityTraits: ['accessible', 'relaxed', 'authentic', 'approachable'],
    vocabularyPreferences: ['essentially', 'in fact', 'to put it simply', 'often', 'typically'],
    writingPatterns: ['use natural contractions', 'mix short and long sentences', 'avoid stiff transitions', 'conversational flow'],
  },
  'professional': {
    name: 'Professional',
    personalityTraits: ['competent', 'clear', 'polished', 'authoritative'],
    vocabularyPreferences: ['implement', 'develop', 'achieve', 'ensure', 'leverage', 'streamline'],
    writingPatterns: ['clear structure', 'action-oriented', 'concise paragraphs', 'bullet points when appropriate'],
  },
  'technical': {
    name: 'Technical',
    personalityTraits: ['precise', 'methodical', 'clear', 'expert'],
    vocabularyPreferences: ['specification', 'implementation', 'architecture', 'optimize', 'configure', 'parameters'],
    writingPatterns: ['step-by-step explanations', 'clear definitions', 'examples', 'consistency in terminology'],
  },
  'persuasive': {
    name: 'Persuasive',
    personalityTraits: ['confident', 'compelling', 'strategic', 'passionate'],
    vocabularyPreferences: ['clearly', 'undoubtedly', 'research proves', 'evidence shows', 'it\'s obvious that'],
    writingPatterns: ['strong claims with evidence', 'addressing counterarguments', 'emotional appeals', 'call to action'],
  },
  'storytelling': {
    name: 'Storytelling',
    personalityTraits: ['narrative', 'engaging', 'personal', 'dramatic'],
    vocabularyPreferences: ['imagine this', 'here\'s the thing', 'what happened was', 'picture this'],
    writingPatterns: ['anecdotes', 'scene-setting', 'character perspective', 'narrative arc'],
  },
  'humorous': {
    name: 'Humorous',
    personalityTraits: ['witty', 'irreverent', 'clever', 'light-hearted'],
    vocabularyPreferences: ['here\'s the kicker', 'plot twist', 'funnily enough', 'ironically', 'surprise surprise'],
    writingPatterns: ['irony and sarcasm', 'unexpected comparisons', 'self-deprecation', 'punchlines'],
  },
  'emotional': {
    name: 'Emotional',
    personalityTraits: ['empathetic', 'passionate', 'vulnerable', 'expressive'],
    vocabularyPreferences: ['honestly', 'truly', 'deeply', 'personally', 'heartbreakingly', 'beautifully'],
    writingPatterns: ['emotional appeals', 'personal anecdotes', 'vivid imagery', 'sensory language'],
  },
  'analytical': {
    name: 'Analytical',
    personalityTraits: ['logical', 'systematic', 'thorough', 'objective'],
    vocabularyPreferences: ['analysis reveals', 'data indicates', 'trend suggests', 'correlation', 'significance'],
    writingPatterns: ['structured argumentation', 'evidence chains', 'systematic breakdown', 'comparative analysis'],
  },
  'custom': {
    name: 'Custom Tone',
    personalityTraits: [],
    vocabularyPreferences: [],
    writingPatterns: [],
  },
};

// ==================== THE CORE ANTI-DETECTION STRATEGY ====================
// AI detectors catch text through statistical fingerprinting. The key signals:
// 1. Low perplexity (predictable word choices)
// 2. Low burstiness (uniform sentence lengths)
// 3. Consistent register (same formality level throughout)
// 4. AI-typical phrases and collocations
// 5. Rigid topic adherence
// 6. Uniform paragraph structure

// This prompt is designed to disrupt ALL of these signals.

const ANTI_DETECTION_CORE = `
You are a text rewriter. Your job is to rewrite AI-generated text so it reads naturally, simply, and accurately, as if written by a human.
CRITICAL: Do NOT completely change the tone, structure, or original meaning of the text. Just reduce the AI percentage by making it sound more natural.

CRITICAL RULES — Follow these EXACTLY:

1. MEANING & STRUCTURAL PRESERVATION (MOST IMPORTANT):
   - You MUST preserve ALL facts, data points, entities, arguments, and underlying concepts from the original text.
   - DO NOT delete sentences. Every idea in the original must appear in the output.
   - DO NOT add new information, opinions, or hallucinations that were not in the original text.
   - DO NOT produce sentence fragments, incomplete thoughts, or empty lines.
   - The output MUST have approximately the same number of sentences and paragraphs as the input.
   - The output length should be within ±15% of the original word count.

2. OUTPUT FORMAT (CRITICAL):
   - Return ONLY the rewritten text. No explanations, no headers, no meta-commentary.
   - Preserve paragraph breaks exactly as they appear in the input (blank lines between paragraphs).
   - Every sentence must be a complete, grammatically correct sentence.
   - Do NOT output bullet points, numbered lists, or markdown formatting unless the original had them.

3. NATURAL SENTENCE VARIATION (BURSTINESS):
   - Mix up sentence lengths naturally: mix short punchy sentences (4-8 words) with medium and longer sentences.
   - Avoid monotonous, perfectly balanced sentences.
   - Write clearly and simply.

4. WORD CHOICE:
   - Replace cliché AI buzzwords: furthermore, moreover, delve into, tapestry, landscape, realm, multifaceted, robust, seamless, synergy, paradigm, innovative, utilize, facilitate, leverage, in conclusion, ultimately.
   - Use clear, simple, accurate language over complex jargon.
   - Use natural contractions where appropriate (it's, don't, can't, won't).
   - Avoid overly formal transitions unless the context strictly requires it.

5. REGISTER AND TONE PRESERVATION:
   - Maintain the original tone and formality level of the text.
   - DO NOT insert inappropriate casual slang into formal, academic, or professional text.
   - If the text is professional, keep it professional but natural.

6. HUMAN FLOW:
   - Vary sentence openings — don't start every sentence or paragraph with "The" or "This".
   - Occasionally start a sentence with a conjunction (And, But, So) for natural flow.
   - Use parenthetical asides sparingly for a human touch.

7. NO UNWANTED PRONOUNS / CONVERSATIONAL FILLER:
   - Do NOT add personal pronouns or conversational filler that are not in the original text: I, me, my, we, us, our, you, your, you'll, 'you know', folks.
   - Write about the subject matter itself, not the reader or writer.

8. COMPLETENESS & QUALITY RECHECK:
   - Before outputting, verify: does every paragraph from the input have a corresponding paragraph in the output?
   - Did you drop any sentences? If so, add them back in rewritten form.
   - Is every sentence complete and grammatically correct?
   - The final text MUST read flawlessly, as if professionally edited.

OUTPUT: Return ONLY the rewritten text. No explanations.`;

// ==================== LEVEL-SPECIFIC INSTRUCTIONS ====================


// ==================== STYLE-SPECIFIC RULES ====================

const STYLE_OVERLAYS: Record<StylePreset, string> = {
  humanize: `Style: General Natural. High burstiness — mix short punchy sentences (4-8 words) with medium ones. Use clear, direct words and natural contractions (it's, don't, isn't). Never use AI clichés like furthermore, moreover, additionally, delve, tapestry, multifaceted, in conclusion, ultimately. Do not add conversational pronouns.`,
  academic: `Style: Elite Academic (Q1 Journal Humanized). Clear, objective, evidence-grounded research writing. Avoid robotic filler and stock transitions (do NOT use "furthermore", "moreover", "in conclusion", "it is important to note"). Vary sentence lengths naturally. Use precise domain terminology without stiff AI collocations.`,
  casual: `Style: Casual and friendly, like explaining something to a colleague. Use contractions freely. Keep it relaxed and conversational, but every sentence must still be complete and grammatically correct — no fragments or unfinished thoughts.`,
  professional: `Style: Elite Professional (Executive Level). Direct, authoritative, and strategic. Avoid marketing fluff or buzzwords. Short, clear, powerful sentences with high information density.`,
  creative: `Style: Vivid and engaging. Sensory details, fresh comparisons. Unexpected word choices. The writing should feel alive.`,
  technical: `Style: Technical but human. Precise terms, concrete examples. Clear step-by-step logic. Avoid robotic transitions.`,
  stealth: `Style: MAXIMUM STEALTH — anti-detector mode. Your single goal is to make this text read like a real human wrote it, so AI detectors score it as human. Stealth matters MORE than elegance.

CRITICAL STEALTH RULES (these override everything else):
1. BURSTINESS (most important): Deliberately mix sentence lengths. After a long sentence, write a very short one (3-7 words). Then a medium one. NEVER write three sentences in a row of similar length. Real humans write unevenly.
2. PERPLEXITY: Prefer plain, slightly plain or unexpected word choices over the "obvious" smooth word. Real humans pick slightly off words sometimes. Do NOT write the most predictable next word.
3. BAN these AI words entirely (never use them, ever): furthermore, moreover, additionally, in conclusion, it is important to note, it is worth noting, delve, tapestry, landscape, realm, navigate, leverage, utilize, facilitate, robust, seamless, streamline, synergy, paradigm, holistic, multifaceted, innovative, cutting-edge, state-of-the-art, transformative, comprehensive, unprecedented, foster, cultivate, empower, underscore, showcase, elucidate, mitigate, synthesize, a myriad of, in today's world, plays a crucial role, it is crucial, it is essential.
4. CONTRACTIONS: Use them naturally (it's, don't, can't, isn't, won't). Text with zero contractions reads as AI.
5. VARY SENTENCE STARTS: Do not start two sentences the same way. Occasionally start with "And", "But", "So", or a short plain word.
6. NO em-dashes (—). Use commas, periods, or parentheses instead.
7. DO NOT ADD PRONOUNS: Write about the subject objectively. Never add: you, we, I, our, us, folks.
8. PRESERVE MEANING EXACTLY: Keep every fact, number, name, and idea. Stay within +/-15% of the original length. Never invent or drop information.`,
};

// ==================== PURPOSE-SPECIFIC OVERLAYS ====================


// ==================== HUMAN WRITING SAMPLE HANDLING ====================

export function buildSamplePrompt(writingSample: string): string {
  if (!writingSample || writingSample.trim().length < 20) return '';
  return `

=== USER'S WRITING SAMPLE ===
Study the writing style in this sample. Match its:
- Sentence length patterns and variation
- Vocabulary level and word choices  
- Use of contractions, informal language, and personality
- How they start sentences and paragraphs
- Their "voice" — formal? casual? somewhere in between?
- Punctuation habits (em-dashes, parentheses, ellipses, etc.)

SAMPLE:
"""
${writingSample.slice(0, 2000)}
"""

IMPORTANT: Match this person's writing patterns. If they write short punchy sentences, you write short punchy sentences. If they're more formal, stay closer to formal. The goal is to make the humanized text sound like THIS SPECIFIC PERSON wrote it.
=== END SAMPLE ===`;
}

// ==================== PERSONA INJECTION ====================


// ==================== MAIN PROMPT GENERATOR ====================

export function getSystemPrompt(
  style: StylePreset,
  writingSample?: string,
  language?: string,
  freezeWords?: string
): string {
  // Use Chinese-specific prompts for Chinese languages
  if (language === 'zh-CN' || language === 'zh-TW') {
    return getChineseSystemPrompt(style, writingSample, language === 'zh-TW', freezeWords);
  }

  const sampleSection = writingSample ? buildSamplePrompt(writingSample) : '';

  const freezeWordsSection = freezeWords?.trim()
    ? `\n\nFREEZE WORDS: The following words/phrases MUST be preserved exactly as written and MUST NOT be changed or replaced with synonyms:\n[${freezeWords}]\n`
    : '';

  return `You are an elite text humanizer. Your task is to rewrite AI-generated text into a perfectly natural, human style.

${ANTI_DETECTION_CORE}

${STYLE_OVERLAYS[style]}
${style === 'academic' ? getQ1VocabularyInjection() : ''}
${sampleSection}
${freezeWordsSection}

MEANING PRESERVATION RULES:
1. Preserve all facts, figures, names, and dates exactly.
2. Do not hallucinate or invent new information.
3. Preserve the core arguments and conclusions.

OUTPUT: Return ONLY the rewritten text. No explanations.`;
}

// ==================== SELF-CHECK PROMPT ====================

export function getSelfCheckPrompt(): string {
  return `Analyze this text for AI-sounding patterns. Look for: predictable word choices, uniform sentence lengths, AI-typical phrases, overly smooth flow.

TEXT:
"""
{TEXT}
"""

Return JSON: {"score": <0-100 human percentage>, "issues": ["specific phrase that sounds AI"], "flaggedSentences": ["full sentences to rewrite"]}`;
}

export function getFixPrompt(flaggedIssues: string[]): string {
  return `Fix these AI-sounding patterns. Replace predictable words, vary sentence lengths, add natural voice.

ISSUES:
${flaggedIssues.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Return ONLY the rewritten text.`;
}

// ==================== RE-HUMANIZATION PROMPT ====================

export function getRehumanizePrompt(
  flaggedSentences: string[],
  style: StylePreset,
): string {
  return `These sentences were flagged as AI-generated. Rewrite each one so it reads like clear, polished, natural human writing — the kind you would find in a well-edited article or report.

RULES FOR EACH SENTENCE (follow strictly):
- Keep the SAME meaning, facts, arguments, numbers, and details. Do not add, drop, or invent information.
- Preserve all proper nouns, technical terms, acronyms, names, citations, and quantities exactly.
- Each rewritten sentence MUST be a complete, grammatically correct sentence on its own.
- NEVER produce a sentence fragment. NEVER leave a sentence unfinished or dangling.
- NEVER add a disconnected interjection ("Honestly?", "Right.", "But wait,", "Look,") as its own line. If you use an opener, weave it into a complete sentence. Do NOT prepend the same opener to multiple sentences.
- Write in polished, precise prose. Avoid slang, clichés, filler, and informal "tic" phrases ("game-changer", "making waves", "turning things on their head", "a whole lot").
- Vary sentence structure and length naturally — but every sentence must stand on its own.
- Use natural contractions only where they fit the register (it's, don't, can't).
- Replace AI-sounding vocabulary (significantly, notably, remarkably, particularly, essentially, fundamentally, ultimately, demonstrates, facilitates, leverages, utilizes, comprehensive, innovative, unprecedented, furthermore, moreover) with plain, accurate wording.
- Match the register of the original: formal/academic text stays formal; do not inject casual language into formal prose.
- Do NOT use em-dashes (—). Use commas, periods, or semicolons instead.
- Output exactly ONE rewritten sentence per input sentence, in the same order.
- FINAL RECHECK: Review your sentences before outputting. Ensure they are flawlessly grammatical, flow perfectly, and have zero awkward phrasing.

SENTENCES TO REWRITE:
${flaggedSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Return ONLY a JSON array of strings, one complete rewritten sentence per input sentence, in order. No markdown fences, no commentary, no numbering.
If you cannot return valid JSON, return the rewritten sentences as plain text, one per line, numbered 1. 2. 3. etc.
Example JSON: ["Artificial intelligence has reshaped how many businesses operate today.", "Companies that adopt these tools can often streamline routine work and respond to customers more quickly."]
Example plain text fallback:
1. Artificial intelligence has reshaped how many businesses operate today.
2. Companies that adopt these tools can often streamline routine work and respond to customers more quickly.`;
}

// ==================== ENHANCEMENT PROMPTS ====================

export const ENHANCE_PROMPTS: Record<string, string> = {
  grammar: `Fix ALL grammatical errors in the following text while preserving the original meaning and style. Return only the corrected text.`,
  spell: `Fix ALL spelling errors and typos in the following text. Return only the corrected text.`,
  punctuation: `Improve punctuation in the following text — add missing commas, fix run-on sentences, ensure proper semicolon and em-dash usage. Return only the corrected text.`,
  structure: `Improve the sentence structure of the following text — vary sentence lengths, fix awkward phrasing, ensure smooth flow between sentences. Return only the improved text.`,
  vocabulary: `Enhance the vocabulary in the following text — replace weak words with stronger alternatives, use more precise and vivid language. Keep the same tone and meaning. Return only the enhanced text.`,
  'passive-to-active': `Convert all passive voice constructions to active voice in the following text while preserving meaning. Return only the converted text.`,
  formal: `Rewrite the following text in a more formal, professional tone while preserving all meaning. Return only the rewritten text.`,
  informal: `Rewrite the following text in a more casual, conversational tone while preserving all meaning. Return only the rewritten text.`,
  simplify: `Simplify the following text — use simpler words, shorter sentences, and clearer explanations. Preserve all key information. Return only the simplified text.`,
  expand: `Expand the following text — add more detail, examples, and explanation to make it more comprehensive. Return only the expanded text.`,
};

// ==================== SAMPLE TEXT ====================

export const SAMPLE_AI_TEXT = `Artificial intelligence has revolutionized the way businesses operate in the modern era. The implementation of AI technologies has facilitated unprecedented advancements in automation, data analysis, and customer service. Organizations that utilize artificial intelligence are able to optimize their operations and achieve superior outcomes.

Furthermore, the utilization of machine learning algorithms has enabled companies to process vast quantities of data with remarkable efficiency. This capability has proven to be particularly beneficial in the realm of predictive analytics, wherein organizations can anticipate market trends and consumer behavior with considerable accuracy.

In addition to these advantages, artificial intelligence has demonstrated significant potential in the domain of content creation. Natural language processing technologies have evolved to the extent that they are capable of generating human-like text that is virtually indistinguishable from content authored by human writers. This development has profound implications for various industries, including journalism, marketing, and entertainment.

It is important to note that the integration of AI systems requires careful consideration of ethical implications. Organizations must ensure that their AI implementations are transparent, fair, and accountable. Additionally, the potential impact on employment must be addressed through proactive workforce development initiatives.`;

export const SAMPLE_TECHNICAL_TEXT = `The implementation of microservices architecture facilitates the development of scalable and maintainable software systems. By decomposing monolithic applications into smaller, independently deployable services, development teams can achieve greater flexibility and faster deployment cycles.

Containerization technologies, particularly Docker and Kubernetes, have emerged as essential tools for managing microservices deployments. These technologies provide consistent runtime environments and enable efficient resource utilization across distributed systems.

Furthermore, the adoption of API gateway patterns has streamlined inter-service communication and provided centralized control over authentication, rate limiting, and request routing.`;

export const GRAMMAR_CHECK_SYSTEM_PROMPT = `You are an expert grammar checker and proofreader. Analyze the following text for:
- Grammar errors
- Spelling mistakes  
- Punctuation issues
- Awkward phrasing
- Subject-verb agreement
- Tense consistency
- Run-on sentences or fragments

Respond in EXACTLY this JSON format:
{"issues": [{"type": "grammar|spelling|punctuation|phrasing", "original": "the incorrect text", "suggestion": "the correction", "explanation": "brief reason"}], "correctedText": "the full corrected text"}

If no issues found, return: {"issues": [], "correctedText": "original text unchanged"}
Return ONLY valid JSON, no other text.`;

// ==================== CHINESE ANTI-DETECTION ENGINE ====================
// Chinese AI detectors (CNKI AIGC, Wanfang, VIP) use different fingerprinting than English detectors.
// They flag: connector density, sentence-length regularity, overly balanced clause structure,
// repeated rhetorical templates, and "safe" abstract vocabulary.

const CHINESE_ANTI_DETECTION_CORE = `
中文反检测核心指令（CRITICAL CHINESE ANTI-DETECTION RULES）：

绝对禁用的连接词和短语（NEVER use these connectors/phrases）：
- 因此、同时、此外、另外、而且、不仅如此
- 首先、其次、再次、最后、一方面…另一方面
- 总而言之、综上所述、总的来说、简而言之
- 不可否认、毋庸置疑、显而易见、值得注意的是、需要指出的是
- 发挥着重要作用、具有重要意义、扮演着关键角色
- 随着…的发展、在…的背景下、在当今社会
- 越来越多的人认为、众所周知、事实上
- 深入探讨、全面分析、系统研究、详细阐述

连接词密度规则：
- 每段最多使用1个显式连接词（中文学术写作中连接词密度是最强的AI信号）
- 优先使用语义衔接（上下文逻辑自然过渡）而非显式连接词
- 用代词（这、那、其）或省略主语来实现自然衔接

平衡句式打破规则：
- 绝对不要使用 A、B、C 三段式并列结构
- 避免对称的四字短语连续出现
- 不要使用"既…又…""不仅…而且…"等完美对仗结构
- 长短句交替：至少每段有一个短句（≤10字）和一个长句（≥40字）`;

const CHINESE_BURSTINESS_ENGINE = `
中文突发性引擎（CHINESE BURSTINESS ENGINE）：

句长变化模式（严格按照此模式变化句长）：
- 短句（5-12字）→ 长句（35-55字）→ 中句（18-28字）→ 极短句（2-6字）→ 超长句（50+字）
- 每段至少包含一个短句（≤12字）
- 每段至少包含一个长句（≥35字）
- 连续两句的字数差必须 ≥8字
- 偶尔使用无主句或省略句作为极短句

混合句式类型：
- 陈述句、反问句、感叹句、祈使句交替使用
- 偶尔使用倒装句或插入语
- 一个段落中至少出现一种非陈述句`;

const CHINESE_STRUCTURAL_DISRUPTION = `
中文结构破坏引擎（CHINESE STRUCTURAL DISRUPTION）：

话题-说明结构重排：
- 把结论前置，再补充原因和细节（先果后因）
- 把话题提前到句首，再用"这"回指
- 打破"总-分-总"的AI典型段落结构
- 段落可以只展开一个要点，不必面面俱到

打破并列和列举节奏：
- 列举不超过2项，超过则改为叙述式
- 不要使用完美的排比句（三句以上结构相同）
- 在列举中插入个人看法或评价打破节奏
- 用"比如""像"等口语化表达替代正式列举

主语显隐交替：
- 有时省略主语（中文口语常见）
- 有时用泛指主语（大家、人们）
- 有时突然切换到第一人称（我、我们）
- 避免每句都有明确主语（这是AI写作的典型特征）`;

const CHINESE_ACADEMIC_MODE = `
中文学术改写模式（CHINESE ACADEMIC REWRITE MODE）：

保留但弱化AI信号：
- 保留专业术语，但用更自然的表达引入（"说白了就是…""简单来说"）
- 引用格式口语化："张三（2023）提过这个""李四那篇论文说得挺有道理"
- 避免过度使用"表明""显示""揭示"等学术动词，交替使用"看出""能发现""可以感受到"
- 数据描述加入主观判断："这个数字说实话挺惊人的""从数据来看变化不算大"

段落结构：
- 不要每段都以主题句开头
- 允许段落以问题、数据、甚至一句感叹开头
- 结尾不要总结，可以留一个开放性问题或个人思考
- 段落长度在3-8句之间变化，不要统一`;

const CHINESE_GENERAL_MODE = `
中文通用自然改写模式（CHINESE GENERAL NATURAL REWRITE MODE）：

口语化程度：
- 适度使用口语词：其实、说实话、怎么说呢、反正、感觉、好像、大概
- 可以使用语气词：吧、呢、啊、嘛（但不要每句都加）
- 使用口语连接：然后、所以（替代因此）、不过（替代然而）、对了
- 偶尔使用网络用语或日常表达（但不要过度）

个人色彩注入：
- 适当加入第一人称观点："我觉得""个人来看""在我看来"
- 可以表达不确定："可能吧""我也不太确定""大概是这样"
- 加入具体细节和例子，不要停留在抽象层面`;

const CHINESE_IDIOM_INSERTION = `
中文成语和语域转换（CHINESE IDIOM INSERTION & REGISTER SHIFTS）：

成语使用规则：
- 每段最多使用1个成语（过度使用反而增加AI感）
- 优先使用常见成语，不要用生僻成语
- 成语前后搭配要自然，不要刻意塞入
- 示例：顺理成章、理所当然、不言而喻、见仁见智、因人而异

语域（register）自然转换：
- 在正式和自然之间自然切换，不要全程保持同一语域
- 可以从正式论述突然转入口语化表达
- 例："从技术层面来看，这个问题涉及到底层架构设计——说白了就是地基没打好"
- 这种语域跳跃是人类写作的自然特征，AI很少这样做`;

const TRADITIONAL_CHINESE_NOTES = `
繁体中文特别注意事项（TRADITIONAL CHINESE NOTES）：

繁体中文不仅仅是简体的字形转换：
- 大陆的论述模式和修辞习惯在繁体中文语境中显得不自然
- 台湾/香港的学术写作更倾向于使用"我們"而非"笔者"
- 连接词偏好不同：台湾常用"並且""同時"（但也要控制密度），而非"而且""同时"
- 标点符号差异：台湾使用「」而非""，使用『』而非''（但输入文本可能已包含）
- 词汇差异：程序→程式、软件→軟體、网络→網路、信息→資訊、视频→影片
- 台湾学术风格更口语化，不像大陆学术写作那样正式
- 如果输入文本明显是大陆风格（如使用"程序""软件"等），保留原文用词，不要强制转换
- 重点在于消除AI痕迹，而非改变地区用语习惯`;

// Chinese-specific level instructions
const CHINESE_LEVEL_INSTRUCTIONS: Record<string, string> = {
  light: `改写等级：轻度（LIGHT）
- 替换2-3个AI典型连接词
- 打破1-2处并列结构
- 加入1个短句（≤12字）
- 每段减少至少1个连接词
保持原文结构和意思不变。`,

  medium: `改写等级：中度（MEDIUM）
- 应用所有突发性引擎规则
- 重排至少2个段落的话题-说明结构
- 每段打破至少1处AI模式
- 加入口语化表达和个人观点
- 控制连接词密度（每段≤1个）
- 长短句交替，句长差≥8字
保留所有事实信息，结构可适度调整。`,

  aggressive: `改写等级：强力（AGGRESSIVE）
- 全面应用所有中文反检测技术
- 极端的句长变化
- 大量口语化表达和语域切换
- 打破所有AI段落模式
- 加入成语（每段≤1个）
- 话题-说明结构重排
- 主语显隐交替
所有事实必须保留，表达方式完全改变。`,

  ninja: `改写等级：忍者（NINJA）— 最高隐匿等级

第一遍：使用所有中文反检测技术进行全面改写。

自我检查清单（SELF-CHECK）：
- 是否有任何AI典型连接词残留？→ 替换或删除
- 是否有两句以上句长相近？→ 调整句长
- 段落结构是否太工整？→ 打乱
- 是否缺少口语化元素？→ 加入
- 是否每段都有"安全"的总结句？→ 删除
- 连接词密度是否过高？→ 降到最低

第二遍：修复所有被标记的问题。

额外忍者技巧：
- 在适当时机使用反问句
- 加入一个具体的个人经历或类比
- 段落结尾保持开放，不要总结
- 偶尔使用倒装或插入语
- 引用一个具体的论文、作者或例子

目标：写出像一个认真但有个性的学生凌晨两点写出来的文章。真实、多变、有主见。`,
};

// ==================== CHINESE PROMPT GENERATOR ====================

export function getChineseSystemPrompt(
  style: StylePreset,
  writingSample?: string,
  isTraditional: boolean = false,
  freezeWords?: string
): string {
  const modeSection = style === 'academic'
    ? CHINESE_ACADEMIC_MODE
    : CHINESE_GENERAL_MODE;

  const sampleSection = writingSample ? buildSamplePrompt(writingSample) : '';

  const traditionalSection = isTraditional
    ? `\n${TRADITIONAL_CHINESE_NOTES}`
    : '';

  const freezeWordsSection = freezeWords?.trim()
    ? `\n\n保留词汇（FREEZE WORDS）：以下词汇必须原样保留，绝对不能更改或替换为同义词：\n[${freezeWords}]`
    : '';

  return `你是一个中文写作改写助手。你的任务是将AI生成的中文文本改写为自然的人类写作风格。
你了解知网AIGC检测系统、万方、维普等中文AI检测工具的工作原理，并知道如何规避它们。

${CHINESE_ANTI_DETECTION_CORE}
${CHINESE_BURSTINESS_ENGINE}
${CHINESE_STRUCTURAL_DISRUPTION}
${CHINESE_IDIOM_INSERTION}
${modeSection}
${traditionalSection}
${sampleSection}

意义保持规则（MEANING PRESERVATION RULES）：
1. 原文中的所有事实、数据、人名、日期和观点都必须保留
2. 不要添加原文中没有的新信息
3. 不要删除关键信息
4. 输出长度应在原文的±20%范围内
${freezeWordsSection}

只返回改写后的文本，不要任何解释、注释或前言。${isTraditional ? '\n使用繁体中文输出。' : ''}`;
}

// ==================== CORPUS-AWARE PROMPT ====================
import { buildStyleInjectionPrompt, hasStyleModel } from './style-model';

/**
 * Generate a corpus-aware system prompt that combines existing anti-detection
 * rules with specific style constraints extracted from real academic papers.
 */
export function getCorpusAwareSystemPrompt(
  style: StylePreset,
  writingSample?: string,
  domain?: string,
  language?: string,
  freezeWords?: string
): string {
  const base = getSystemPrompt(style, writingSample, language, freezeWords);
  if (!hasStyleModel()) return base;
  return base + buildStyleInjectionPrompt(domain);
}

// Temperature and top_p settings per level
export const LEVEL_PARAMS: Record<string, { temperature: number; topP: number }> = {
  light: { temperature: 0.3, topP: 0.85 },
  medium: { temperature: 0.5, topP: 0.90 },
  aggressive: { temperature: 0.7, topP: 0.95 },
  ninja: { temperature: 0.8, topP: 0.95 },
};
