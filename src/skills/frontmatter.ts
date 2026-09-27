export function parseSkill(raw: string, fallbackTitle: string): { title: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!match) return { title: fallbackTitle, body: raw.trim() }
  const titleLine = /^title:\s*(.+)$/m.exec(match[1])
  const title = titleLine?.[1]?.trim().replace(/^["']|["']$/g, '') || fallbackTitle
  return { title, body: raw.slice(match[0].length).trim() }
}
