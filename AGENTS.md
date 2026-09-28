# iEdit agent guide

iEdit is a static Vite + React + TypeScript site for academic line-editing. A reader uploads a `.docx` or `.tex` manuscript, reviews sentence-level suggestions in the browser, and downloads a redlined Word or LaTeX file. There is no backend and no Pyodide. The manuscript stays in the browser except for the text sent to the model the user chose. The user brings their own API key; it lives in `localStorage` and is sent only to that provider.

Do not commit API keys, `.env` files, or chat logs that contain a key. Do not commit unless the user asks. Do not mention a particular institute or a private server URL in setup copy or defaults. `DEFAULT_OPENAI_BASE_URL` in `src/llm/storage.ts` stays `''`.

## Setup

```bash
npm install
npm test
npm run dev
```

`./launch.sh` starts the dev server at `http://127.0.0.1:5173`. `npm run build:pages` is the GitHub Pages build (`tsc -b && vite build --mode pages`) with Vite `base` `/iedit/`. Local dev uses base `/`.

Tests are Vitest in happy-dom (`npm test`). `src/llm/liveReview.test.ts` calls Gemini and only runs when a key is present in the environment; do not add a key to the repo to make it pass. After a TypeScript change, run `npx tsc -b --pretty false` as well as the tests you touched.

The published site is `https://samthiele.github.io/iedit/`. Pages deploys `dist` from `main` (`.github/workflows/pages.yml`, Node 22). GitHub Pages has no SPA fallback of its own, so the workflow copies `dist/index.html` to `dist/test/index.html` and `dist/404.html`, and copies `test/chatLog.txt` into `dist/__fixtures/`. `test/testManuscript.docx` is copied only when it is in the checkout; if it is missing, the workflow warns and continues. The demo manuscript appears on `/iedit/test` only after that file is committed. Dev and preview serve the same fixtures through the `iedit-test-fixtures` plugin in `vite.config.ts`; that plugin does not run in the production build.

## What the page does

Header: icon and “iEdit”, with the subtitle “Improving scientific writing” and a Demo link, on one line. Demo goes to `/test` (on Pages, `/iedit/test`). The discipline control is a dropdown with no “Discipline” label (`aria-label="Discipline"`). Its last option is `Custom...`, which opens the skill dialog and does not change the selected discipline. The settings button label is exactly `Setup`.

Setup is a modal, not a route, and it is only for the model connection. Tabs: Gemini (default), ChatGPT, Groq, OpenRouter, Cerebras, Mistral, Other API. Review with a missing key, model, or server opens Setup instead of showing an error. The review button is not disabled for a missing model.

The confidentiality line next to Review names the selected provider and links that provider’s privacy or terms page. Other API has no privacy link. The drop zone does not say that PDF is unsupported.

The science checkbox is shown only when the active preset has `webSearch: true` (Gemini only). Its label is exactly `Include a science fact-checking pass`. When web search is unavailable, the run forces science off.

Effort is Low (80000 characters), Medium (36000, the default), or High (9000). Higher effort means more calls and less text per reply. The stored key is still `iedit.blockSize`. An optional custom prompt (`iedit.customPrompt`) is appended to the system instruction as `# Author instructions`.

The review view is one dark manuscript (`.manuscript`, background `#121316`, paragraphs with no extra margin). Summary is a `<details>` collapsed by default. Suggestions render as strikethrough deletions and underlined insertions. Comments sit in a right rail and are stacked against the matching span (`layoutCommentRail`). Below 800px they stack under the paragraph. Accept, Reject, and Undo live in the copy-edit bubble and share one status with the redline. Accept bakes the replacement as plain text. Reject restores the original wording as a plain span so hover can still highlight it. Pending shows the redline. Do not drop rejected spans from the pieces. Science notes are bubbles too, marked search-checked or not. A science note with no span highlights the whole paragraph on hover. Hover paints the passage with `#1d4e89`, the same blue as `::selection`, and bolds it.

Accept all and Reject all stay. Download Word and Download LaTeX stay enabled. A chat-log button opens a new window with the system instruction and every turn.

`/test` loads `test/chatLog.txt` and `test/testManuscript.docx` and renders them through the same review pane, with no model call.

## Providers

`generateReview` in `src/llm/client.ts` is the only completion call. Review and Auto skill both use it.

- Gemini: `@google/genai` `generateContent`, `maxOutputTokens: 32768`. A science chunk passes `tools: [{ googleSearch: {} }]`. Grounding is `groundingMetadata` with search queries or grounding chunks.
- Every other tab is OpenAI-compatible: `POST {base}/chat/completions` and `GET {base}/models`, Bearer auth, `max_tokens: 16384`. History role `model` is sent as `assistant`. Official `https://api.openai.com/v1` allows this browser call. Do not document it as blocked by CORS. ChatGPT’s listed models are `gpt-4.1-mini` (default) and `gpt-4.1` because of that token cap.
- `search` is ignored for OpenAI-compatible calls. Those replies are `grounded: false` with no sources. Do not warn that a non-Gemini science pass “returned no search queries”.
- If a Gemini science chunk returns no grounding, keep the copy-edit already produced, stop the science pass, and do not present those notes as literature-checked. A science failure must not discard copy-edit results.
- This science pass is one grounded call per chunk. It is not a multi-step literature review. The skill text already says to answer “could not verify” when search cannot settle a claim.

Do not add GitHub Copilot or Microsoft 365 Copilot as a paste-a-key tab. Neither exposes an OpenAI-compatible endpoint this static page can call. A user who has an OpenAI-compatible Azure or Foundry endpoint uses Other API.

One `history` of `{ role: 'user' | 'model', text }` runs through every copy-edit chunk and then the science chunks. Later turns are told not to repeat earlier suggestions. A retry because `~~old~~` was not verbatim is another turn in that same thread.

## Skills

`src/skills/scientific-writing.md` is always included. One discipline body is appended under `# Active discipline` (`systemInstruction` in `src/skills/index.ts`). The built-in discipline is `src/skills/disciplines/geoscience.md` (`id: geoscience`). Another built-in is a markdown file in that folder with `title:` in `---` frontmatter, registered in `BUILTIN_DISCIPLINES`.

Uploaded and generated skills are `{ id, title, body }` in `iedit.customSkills` only. They are not written into the repo. Auto skill lives in `src/components/SkillDialog.tsx`, not in Setup. It sends the geoscience skill as the example, forces the dropdown title to the name the user typed, and can download the `.md`. Generation uses the saved connection (`activeConnection()`), with `search: false`. A key typed in Setup but not saved with “Use this model” is invisible to it.

## Manuscript text and the model

Editable paragraphs are `body`, `heading`, and `table` (`isEditable`). Ids are `p-001` onward in emitted order (`paragraphId`).

`paragraph.text` is the plain Word string for body and headings. That is the coordinate space for `span`, `find`, `insert`, and `segments`. `marks` and `links` are for the prompt and the review display. Never write markdown syntax or those marks back into Word runs.

`projectParagraph` (`src/review/richText.ts`) builds the markdown the model sees and a `map` of plain indexes (`-1` for syntax characters). Headings get a `#` prefix only in that projection. Display does not prefix `#`; `ReviewPane` renders heading paragraphs as `h1`–`h6` with class `md-heading`. Bold is `**`, italic is `*`, underline is `<u>`, subscript and superscript are `<sub>` and `<sup>`, and safe links are `[text](url)`.

`locateFormatted` finds the model’s quote in that markdown and maps it back to plain `paragraph.text`, then falls back to a plain search. `bindEdits` stores plain coordinates. `plainInsert` strips heading hashes, link wrappers, `<u>`, `<sub>`, `<sup>`, `**`, and flanking `*` / `_` before download.

Word tables become one GFM pipe paragraph when every cell is a single column and there is no nested table, `gridSpan` greater than 1, or `vMerge`. Cell paragraphs join with `<br>`. `|` in cell text is escaped as `\|`. Each cell keeps `docxIndex`, `text`, `start`, and `end` in the pipe string. `docxIndex` counts every `w:p` in document order, including paragraphs inside a skipped table, so export still addresses `descendants(body, 'p')[docxIndex]`. A table that cannot be a pipe table is omitted from the prompt and the review. It stays in the downloaded `.docx` because export starts from the original zip. A suggestion that does not lie entirely inside one cell is dropped.

Existing Word comments are not shown in the web review. `w:del` / `delText` is omitted from the text the page and the model see. `w:ins` text is shown as ordinary text. Download keeps those older comments and revisions and adds iEdit’s notes beside them.

## Model output

The canonical fence is `iedit-edits`. Inside it, one `### p-014` block per paragraph. Wording changes are `~~old~~` copied verbatim from the projected paragraph, then `**<u>replacement</u>**`, then `[COMMENT-COPYEDIT: why]`. A science note is `[COMMENT-SCIENCE: ...]` and does not replace wording. Authors are `AI-copyedit` and `AI-science`. Edits are one sentence or clause, not a whole paragraph. Parser: `src/review/edits.ts`.

## Download

Export starts from the original `.docx` or `.tex`. Rejected suggestions are omitted.

- Pending wording becomes real `w:del` / `w:ins` plus a Word comment. Inside a table the change is red and blue runs, not a nested revision. Pending comment-only notes become Word comments.
- Accepted wording is written as plain `w:t`. The old wording and the comment are omitted. An accepted comment with no wording change is omitted.
- LaTeX uses the `changes` package and `pdfcomment`, with the same accept and reject rules (`src/export/tex.ts`).

`spliceVisibleSpan` in `src/export/docx.ts` applies a spanned edit without nesting a new `w:ins` or `w:del` inside an older one, and it carries `commentRangeStart` / `commentRangeEnd` markers that sat between the edited runs. New comment and revision ids start after the highest id already in the package (`maxMarkupId`), including `word/comments.xml`. If the edited runs do not share one parent after that split, the suggestion is dropped rather than corrupting the paragraph. `wrapComment` (comment-only notes) can still place markers inside an existing `w:ins`.

`mergeMarks` in `src/ooxml/xml.ts` currently keeps bold and italic only. Underline, subscript, and superscript are read from runs and then dropped. Fix that loop if you touch the function; do not change how adjacent bold and italic runs merge.

## Where to change things

| Area | Files |
| --- | --- |
| Page shell, header, review launch | `src/App.tsx`, `src/main.tsx`, `src/route.ts` |
| Setup tabs and saved connection | `src/llm/setup.ts`, `src/llm/storage.ts`, `src/components/SetupDialog.tsx` |
| Completion calls | `src/llm/client.ts`, `src/llm/runReview.ts` |
| Discipline skills and Auto skill | `src/skills/`, `src/components/SkillDialog.tsx` |
| docx read, tables, formatting | `src/parse/docx.ts`, `src/ooxml/xml.ts` |
| Prompt markdown versus plain offsets | `src/review/richText.ts`, `src/review/edits.ts` |
| Review rendering | `src/components/ReviewPane.tsx`, `src/review/manuscriptMarkdown.ts`, `src/index.css` |
| Word and LaTeX download | `src/export/docx.ts`, `src/export/tex.ts`, `src/export/markdown.ts` |
| Demo route | `src/TestPage.tsx`, `vite.config.ts`, `.github/workflows/pages.yml` |

UI work needs a check of the changed flow in the browser when a browser is available. Otherwise run the closest Vitest file and say what was not clicked through. Theme tokens live in `src/index.css`: dark background, muted text, accent `#8ab4f8`, monospace stack, `html { font-size: 120% }`.
