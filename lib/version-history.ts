import { HumanizationResult } from '@/lib/types';

export interface VersionSnapshot {
  id: string;
  documentId: string;
  createdAt: number;
  author: string;
  label: string;
  text: string;
  score?: number;
  semanticScore?: number;
}

const VERSION_HISTORY_KEY = 'stealthhumanizer_version_history';

export function getVersionHistory(documentId = 'local-draft'): VersionSnapshot[] {
  if (typeof window === 'undefined') return [];
  try {
    const all = JSON.parse(localStorage.getItem(VERSION_HISTORY_KEY) || '[]');
    return Array.isArray(all) ? all.filter((snapshot: VersionSnapshot) => snapshot.documentId === documentId) : [];
  } catch {
    return [];
  }
}

export function saveVersionSnapshot(snapshot: Omit<VersionSnapshot, 'id' | 'createdAt'>): VersionSnapshot | null {
  if (typeof window === 'undefined') return null;
  const all = JSON.parse(localStorage.getItem(VERSION_HISTORY_KEY) || '[]') as VersionSnapshot[];
  const saved = { ...snapshot, id: crypto.randomUUID(), createdAt: Date.now() };
  all.push(saved);
  localStorage.setItem(VERSION_HISTORY_KEY, JSON.stringify(all.slice(-200)));
  return saved;
}

export function saveHumanizationVersion(result: HumanizationResult, documentId = 'local-draft', author = 'local-user'): VersionSnapshot | null {
  return saveVersionSnapshot({
    documentId,
    author,
    label: `${result.modelName} • ${result.finalScore}% human`,
    text: result.fullText,
    score: result.finalScore,
    semanticScore: result.semanticFidelity?.score,
  });
}
