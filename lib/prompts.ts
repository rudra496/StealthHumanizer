// StealthHumanizer v3 - Anti-Detection Prompt Engine
// Rewritten to actually defeat AI detectors by disrupting statistical fingerprints

import { RewriteLevel, StylePreset, TonePreset, TextPurpose } from './types';

// ==================== TONE CONFIGURATIONS ====================

export const TONE_CONFIGS: Record<TonePreset, {
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
    personalityTraits: ['friendly', 'relaxed', 'authentic', 'approachable'],
    vocabularyPreferences: ['honestly', 'basically', 'kind of', 'pretty much', 'you know', 'I mean', 'stuff like that'],
    writingPatterns: ['contractions everywhere', 'rhetorical questions', 'short sentences mixed with longer ones', 'personal asides'],
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
You are a text rewriter. Your job is to rewrite AI-generated text so it reads naturally, as if written by a human.

CRITICAL RULES — Follow these EXACTLY:

1. BURSTINESS (sentence length variation):
   - Every paragraph MUST have sentences of dramatically different lengths
   - Include at least ONE very short sentence (3-6 words) per paragraph
   - Include at least ONE long sentence (25+ words) per paragraph
   - Pattern example: short. Medium length with some detail here. Long sentence that really goes into depth and explores the idea thoroughly. Short! Another medium one.
   - NEVER have 3+ sentences of similar length in a row

2. PERPLEXITY (unpredictable word choices):
   - NEVER use: furthermore, moreover, additionally, consequently, in conclusion, it is important to note, delve into, tapestry, landscape, realm, multifaceted, robust, seamless, synergy, paradigm, innovative, cutting-edge, groundbreaking, transformative, comprehensive, unprecedented, utilize, facilitate, leverage, foster, cultivate, empower, streamline, optimize, implement, navigate, embark, underscores, highlights, showcases, illustrates, demonstrates
   - NEVER use: significantly, substantially, notably, remarkably, particularly, essentially, fundamentally, ultimately, inherently, arguably
   - NEVER start sentences with: "In this [article/paper/study]", "The [results/findings/analysis]", "Research has shown", "It is [widely/commonly]", "There is a growing", "One of the"
   - Use unexpected word choices. Instead of "important" → "matters", "changes things", "worth paying attention to"
   - Instead of "demonstrates" → "shows", "makes clear", "tells us"
   - Instead of "significant" → "real", "big", "notable", "worth mentioning"

7. REGISTER MATCHING:
   - Match formality to the topic and style. Academic text should stay academic — don't insert slang into a research paper.
   - Casual interjections ("Right.", "Wild.", "Honestly.") are only appropriate for casual/creative contexts.
   - For academic/professional: use mild asides ("— though this remains debated"), not slang.
   - For casual/creative: full personality is appropriate.
   - Never force casualness in formal writing. The goal is natural, not fake-casual.

3. STRUCTURAL DISRUPTION:
   - Never start two consecutive paragraphs the same way
   - Start paragraphs with: "And", "But", "So", "OK", "Here's the thing", "Wait—", a question, or a short fragment
   - End paragraphs mid-thought sometimes — don't wrap up neatly
   - Use ONE-word paragraphs occasionally for emphasis
   - Mix paragraph lengths: some 1 sentence, some 5-6 sentences

4. HUMAN VOICE:
   - Use contractions everywhere: it's, don't, can't, won't, that's, there's, you'd, they're, we've, shouldn't've
   - Include personal asides: "(which, honestly, surprised me)", "—at least in my experience", "if you think about it"
   - Use first person occasionally: "I'd argue", "from what I can tell", "the way I see it"
   - Add casual connectors: "so", "anyway", "right", "basically", "plus", "though"
   - Occasional incomplete thoughts: "Well." "Right." "Exactly."

5. FLOW DISRUPTION:
   - Occasionally break the fourth wall: "which is kind of wild when you think about it"
   - Add rhetorical questions
   - Use em-dashes (—) for sudden topic shifts
   - Use semicolons occasionally
   - Add parenthetical asides that add personality

6. ABSOLUTELY FORBIDDEN:
   - No "In conclusion" or "To summarize" — just stop
   - No "It is worth noting/mentioning" — just note it
   - No hedging: "it could be argued", "one might consider", "it is possible that"
   - No lists of three adjectives: "comprehensive, robust, and innovative"
   - No balanced sentence pairs: "not only X but also Y"
   - No "plays a [adjective] role" constructions

OUTPUT: Return ONLY the rewritten text. No explanations.`;

// ==================== LEVEL-SPECIFIC INSTRUCTIONS ====================

const LEVEL_INSTRUCTIONS: Record<RewriteLevel, string> = {
  light: `LEVEL: Light — Minimal changes.
Only fix obvious AI patterns. Swap 2-3 formal words for casual ones. Add contractions. Keep 90% of the original text intact. If it already sounds natural, change almost nothing.`,

  medium: `LEVEL: Medium — Moderate rewrite.
Rearrange 30-40% of sentences for variety. Add personal voice in a few spots. Replace transitions with casual alternatives. Keep the core structure but make it feel like a real person wrote it.`,

  aggressive: `LEVEL: Aggressive — Strong rewrite.
Rewrite most sentences in your own words. Strong personal voice throughout. Vary sentence lengths dramatically. Remove all formal transitions. The facts stay, but the voice is completely different — like a student explaining it to a friend.`,

  ninja: `LEVEL: Ninja — Maximum stealth.
Rewrite everything. The output should read like a blog post by someone passionate about the topic, not an essay. Short paragraphs. One-sentence paragraphs for emphasis. Occasional rhetorical questions. End with a thought, not a conclusion. No paragraph should start with "The" or "This".`,
};

// ==================== STYLE-SPECIFIC RULES ====================

const STYLE_OVERLAYS: Record<StylePreset, string> = {
  humanize: `Style: General. Write like a college student who knows the topic but isn't trying to impress anyone.`,
  academic: `Style: Academic but real. Like a student paper, not a journal article. Use "I" sometimes. Cite casually: "Smith (2023) makes a good point about this." Don't over-explain.`,
  casual: `Style: Super casual. Like texting a friend who asked about this. Contractions everywhere. "Honestly," "basically," "kind of." Sentence fragments are fine.`,
  professional: `Style: Professional but real person. Direct, specific, no buzzwords. Short paragraphs. "We found" not "It was discovered."`,
  creative: `Style: Vivid and engaging. Sensory details, fresh comparisons. Unexpected word choices. The writing should feel alive.`,
  technical: `Style: Technical but human. Precise terms, concrete examples. "You'll see" not "It can be observed." Step-by-step.`,
};

// ==================== PURPOSE-SPECIFIC OVERLAYS ====================

export const PURPOSE_CONFIGS: Record<TextPurpose, {
  name: string; icon: string; description: string; promptOverlay: string;
}> = {
  essay: {
    name: 'Essay',
    icon: 'FileText',
    description: 'Academic or argumentative essay',
    promptOverlay: `Purpose: Essay. Maintain a clear thesis and argument structure. Each paragraph should develop one idea. Use evidence and reasoning, not just assertions. Avoid bullet points — write in prose. End with a strong concluding thought (not "in conclusion").`,
  },
  article: {
    name: 'Article',
    icon: 'Newspaper',
    description: 'Blog post or online article',
    promptOverlay: `Purpose: Article. Engaging introduction that hooks the reader. Clear subheadings or section breaks. Mix facts with analysis. End with a takeaway or call to action. Keep paragraphs short (2-4 sentences) for readability.`,
  },
  blog: {
    name: 'Blog Post',
    icon: 'PenLine',
    description: 'Personal or professional blog',
    promptOverlay: `Purpose: Blog. Conversational and personal. Use "I" and "you." Short paragraphs. Include opinions and personal takes. Headings are OK. Write like you're explaining to a smart friend.`,
  },
  email: {
    name: 'Email',
    icon: 'Mail',
    description: 'Professional or personal email',
    promptOverlay: `Purpose: Email. Clear and direct. State the purpose early. Use short paragraphs (1-3 sentences). Professional but warm tone. End with a clear next step or question.`,
  },
  marketing: {
    name: 'Marketing',
    icon: 'Megaphone',
    description: 'Copy, ads, or landing pages',
    promptOverlay: `Purpose: Marketing. Persuasive and benefit-focused. Use concrete numbers and specific claims instead of vague adjectives. Address the reader directly with "you." Keep sentences punchy. Focus on outcomes.`,
  },
  report: {
    name: 'Report',
    icon: 'BarChart3',
    description: 'Business or research report',
    promptOverlay: `Purpose: Report. Structured and factual. Use clear section breaks. Present data with context. Use "we found" or "the data shows" rather than passive constructions. Include specific numbers. Professional but not stiff.`,
  },
  story: {
    name: 'Story',
    icon: 'BookOpen',
    description: 'Creative fiction or narrative',
    promptOverlay: `Purpose: Story. Show don't tell. Use sensory details and dialogue. Vary paragraph length for pacing. Build scenes rather than summarizing. Let the reader experience events rather than reading about them.`,
  },
  'social-media': {
    name: 'Social Media',
    icon: 'Share2',
    description: 'Twitter, LinkedIn, Instagram, etc.',
    promptOverlay: `Purpose: Social media. Hook in the first line. Keep it concise. Use line breaks for readability. One idea per paragraph. Conversational tone. OK to use casual language and mild slang.`,
  },
  general: {
    name: 'General',
    icon: 'Type',
    description: 'Any other text type',
    promptOverlay: '',
  },
};

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

const PERSONAS: Record<RewriteLevel, string> = {
  light: `You're a student doing a quick proofread. Fix obvious AI patterns. Subtle changes only.`,
  medium: `You're rewriting this in your own words. Make it sound natural and human.`,
  aggressive: `You're a blogger rewriting this for your audience. Strong voice, interesting, not academic.`,
  ninja: `You're rewriting this to sound completely natural. Write like a real person — not polished, not perfect, just genuinely human.`,
};

// ==================== MAIN PROMPT GENERATOR ====================

export function getSystemPrompt(
  level: RewriteLevel,
  style: StylePreset,
  tone: TonePreset = 'conversational',
  customTone?: string,
  writingSample?: string,
  language?: string,
  purpose?: TextPurpose
): string {
  // Use Chinese-specific prompts for Chinese languages
  if (language === 'zh-CN' || language === 'zh-TW') {
    return getChineseSystemPrompt(level, style, tone, customTone, writingSample, language === 'zh-TW');
  }

  const toneConfig = TONE_CONFIGS[tone];
  const toneSection = tone === 'custom' && customTone
    ? `CUSTOM TONE: ${customTone}`
    : tone !== 'custom'
    ? `TONE: ${toneConfig.name}
Personality: ${toneConfig.personalityTraits.join(', ')}`
    : '';

  const sampleSection = writingSample ? buildSamplePrompt(writingSample) : '';

  const purposeSection = purpose && purpose !== 'general'
    ? `\n\n${PURPOSE_CONFIGS[purpose].promptOverlay}`
    : '';

  return `${PERSONAS[level]}

${ANTI_DETECTION_CORE}

${STYLE_OVERLAYS[style]}${purposeSection}
${toneSection}
${sampleSection}

${LEVEL_INSTRUCTIONS[level]}

Return ONLY the rewritten text.`;
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
  level: RewriteLevel,
  style: StylePreset,
  tone: TonePreset = 'conversational',
  customTone?: string,
  purpose?: TextPurpose
): string {
  const toneNote = tone === 'custom' && customTone
    ? `Tone: ${customTone}`
    : `Tone: ${TONE_CONFIGS[tone]?.name || tone}`;
  const purposeNote = purpose && PURPOSE_CONFIGS[purpose]?.promptOverlay
    ? PURPOSE_CONFIGS[purpose].promptOverlay
    : 'Purpose: preserve the original use case and meaning.';

  return `These sentences were flagged as AI-generated. Rewrite each one to sound completely human.

${toneNote}
${purposeNote}

RULES FOR EACH SENTENCE:
- Change the sentence structure completely (don't just swap words)
- Add a casual opener if possible: "Honestly,", "Basically,", "Look,", "The thing is,"
- Use contractions
- Make it shorter or longer than the original (different length = different fingerprint)
- If it's long (>20 words), split it into two shorter sentences
- If it's short (<8 words), merge with context or add detail
- Remove any formal vocabulary: significantly, notably, remarkably, particularly, essentially, fundamentally, ultimately, demonstrates, facilitates, leverages, utilizes, comprehensive, innovative, unprecedented
- Add personality: em-dash, parenthetical aside, or rhetorical question
- Never start with "The" followed by a noun

SENTENCES TO REWRITE:
${flaggedSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Return ONLY a JSON array of strings in the same order, with one rewritten sentence per input sentence. Do not include markdown or explanations.
Example: ["Honestly, this now sounds more like something a person would actually write.", "Look, the point still holds, but the rhythm feels less canned."]`;
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
const CHINESE_LEVEL_INSTRUCTIONS: Record<RewriteLevel, string> = {
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
  level: RewriteLevel,
  style: StylePreset,
  tone: TonePreset = 'conversational',
  customTone?: string,
  writingSample?: string,
  isTraditional: boolean = false
): string {
  const modeSection = style === 'academic'
    ? CHINESE_ACADEMIC_MODE
    : CHINESE_GENERAL_MODE;

  const toneSection = tone === 'custom' && customTone
    ? `自定义语调（CUSTOM TONE）: ${customTone}`
    : '';

  const sampleSection = writingSample ? buildSamplePrompt(writingSample) : '';

  const traditionalSection = isTraditional
    ? `\n${TRADITIONAL_CHINESE_NOTES}`
    : '';

  return `你是一个中文写作改写助手。你的任务是将AI生成的中文文本改写为自然的人类写作风格。
你了解知网AIGC检测系统、万方、维普等中文AI检测工具的工作原理，并知道如何规避它们。

${CHINESE_ANTI_DETECTION_CORE}
${level !== 'light' ? CHINESE_BURSTINESS_ENGINE : ''}
${level !== 'light' ? CHINESE_STRUCTURAL_DISRUPTION : ''}
${level !== 'light' ? CHINESE_IDIOM_INSERTION : ''}
${modeSection}
${toneSection}
${traditionalSection}
${sampleSection}

${CHINESE_LEVEL_INSTRUCTIONS[level]}

意义保持规则（MEANING PRESERVATION RULES）：
1. 原文中的所有事实、数据、人名、日期和观点都必须保留
2. 不要添加原文中没有的新信息
3. 不要删除关键信息
4. 输出长度应在原文的±20%范围内

只返回改写后的文本，不要任何解释、注释或前言。${isTraditional ? '\n使用繁体中文输出。' : ''}`;
}

// ==================== CORPUS-AWARE PROMPT ====================
import { buildStyleInjectionPrompt, hasStyleModel } from './style-model';

/**
 * Generate a corpus-aware system prompt that combines existing anti-detection
 * rules with specific style constraints extracted from real academic papers.
 */
export function getCorpusAwareSystemPrompt(
  level: RewriteLevel,
  style: StylePreset,
  tone: TonePreset = 'conversational',
  customTone?: string,
  writingSample?: string,
  domain?: string,
  language?: string,
  purpose?: TextPurpose
): string {
  const base = getSystemPrompt(level, style, tone, customTone, writingSample, language, purpose);
  if (!hasStyleModel()) return base;
  return base + buildStyleInjectionPrompt(domain);
}

// Temperature and top_p settings per level
export const LEVEL_PARAMS: Record<RewriteLevel, { temperature: number; topP: number }> = {
  light: { temperature: 0.8, topP: 0.92 },
  medium: { temperature: 0.9, topP: 0.95 },
  aggressive: { temperature: 1.0, topP: 0.97 },
  ninja: { temperature: 1.1, topP: 0.99 },
};
