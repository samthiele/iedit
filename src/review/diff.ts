import { diffWords } from 'diff'
import type { DiffSegment } from './types.ts'

export function wordDiff(before: string, after: string): DiffSegment[] {
  return diffWords(before, after)
    .map((part) => ({
      type: part.added ? 'insert' as const : part.removed ? 'delete' as const : 'equal' as const,
      text: part.value,
    }))
    .filter((part) => part.text.length > 0)
}
