import { parseDocx } from './docx.ts'
import { parseTex } from './tex.ts'
import type { LoadedDocument } from '../review/types.ts'

export async function loadManuscript(file: File): Promise<LoadedDocument> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf')) {
    throw new Error('PDF files are not supported in this version. Upload a .docx or .tex file.')
  }
  if (name.endsWith('.docx')) {
    return parseDocx(file.name, await file.arrayBuffer())
  }
  if (name.endsWith('.tex')) {
    return parseTex(file.name, await file.text())
  }
  throw new Error('Upload a .docx or .tex file.')
}
