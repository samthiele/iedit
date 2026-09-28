import example from './disciplines/geoscience.md?raw'
import { parseSkill } from './frontmatter.ts'

export function skillPrompt(name: string, description: string): string {
  return `Write a discipline skill for a scientific copyeditor.

Follow the example's shape and tone: a short title, then imperative guidance about wording, evidence, and reasoning. Do not change how edits or comments are written.

Example:

${example.trim()}

Discipline name: ${name.trim()}

The author describes this discipline and its writing and reasoning conventions:

${description.trim()}

Return only the markdown file. Start with YAML frontmatter whose title is exactly the discipline name, then a heading of that name.`
}

export function skillFromReply(name: string, reply: string): { title: string; body: string; file: string } {
  const title = name.trim()
  if (!title) throw new Error('Name the discipline before generating a skill.')
  let text = reply.trim()
  const fence = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(text)
  if (fence) text = fence[1].trim()
  const body = parseSkill(text, title).body.trim()
  if (!body) throw new Error('The model returned an empty skill.')
  return { title, body, file: skillFile(title, body) }
}

export function skillFile(title: string, body: string): string {
  const quoted = /[:#\n"'`]/.test(title) ? JSON.stringify(title) : title
  return `---\ntitle: ${quoted}\n---\n\n${body.trim()}\n`
}
