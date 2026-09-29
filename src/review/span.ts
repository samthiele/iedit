export function locateSpan(
  haystack: string,
  needle: string,
  from = 0,
): { start: number; end: number; actual: string } | null {
  const trimmed = needle.trim()
  if (!trimmed) return null

  const exact = haystack.indexOf(needle, from)
  if (exact >= 0) {
    return { start: exact, end: exact + needle.length, actual: needle }
  }

  const exactTrim = haystack.indexOf(trimmed, from)
  if (exactTrim >= 0) {
    return { start: exactTrim, end: exactTrim + trimmed.length, actual: trimmed }
  }

  const parts = trimmed.split(/\s+/).filter(Boolean).map(escapeRegExp)
  if (parts.length === 0) return null
  const match = new RegExp(parts.join('\\s+')).exec(haystack.slice(from))
  if (!match) return null
  return {
    start: from + match.index,
    end: from + match.index + match[0].length,
    actual: match[0],
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
