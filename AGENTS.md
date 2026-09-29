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

The published site is `https://samthiele.github.io/iedit/`. Pages deploys `dist` from `main` (`.github/workflows/pages.yml`, Node 22). GitHub Pages has no SPA fallback of its own, so the workflow copies `dist/index.html` to `dist/test/index.html` and `dist/404.html`, and copies `test/wordChatLog.txt`, `test/latexChatLog.txt`, and `test/testLatex.tex` into `dist/__fixtures/`. `test/testManuscript.docx` is copied only when it is in the checkout; if it is missing, the workflow warns and continues. The Word demo appears on `/iedit/test` only after that file is committed. Dev and preview serve the same fixtures through the `iedit-test-fixtures` plugin in `vite.config.ts`; that plugin does not run in the production build.

## What the page does

Header: icon and “iEdit”, with the subtitle “Improving scientific writing” and `(DEMO: WORD | LATEX)` on one line. WORD goes to `/test` and LATEX goes to `/test?demo=latex` (on Pages, under `/iedit/`). The discipline control is a dropdown with no “Discipline” label (`aria-label="Discipline"`). Its last option is `Custom...`, which opens the skill dialog and does not change the selected discipline. The settings button label is exactly `Setup`.

Setup is a modal, not a route. It holds the model connection and the optional Parallel API key. Tabs: Gemini (default), ChatGPT, Groq, OpenRouter, Cerebras, Mistral, Other API. Review with a missing key, model, or server opens Setup instead of showing an error. The review button is not disabled for a missing model.

The confidentiality line next to Review names the selected provider and links that provider’s privacy or terms page. Other API has no privacy link. The drop zone does not say that PDF is unsupported.

The science checkbox is always shown. Its label is exactly `Include a science fact-checking pass`. When it is checked, the note reads: `Checks claims and reasoning with a web search. This can be helpful, though is narrower than a full literature search or human thought. Always think yourself, always verify yourself.` An optional Parallel API key (`iedit.parallelApiKey`) is entered in Setup, raises the free search limit, and stays in this browser. When the box is checked, the confidentiality line also reads: `Science checks are also sent to Parallel, possibly including small sections/snippets of your text.` and links the Parallel privacy policy.

Effort is Low (80000 characters), Medium (36000, the default), or High (9000). Higher effort means more calls and less text per reply. The stored key is still `iedit.blockSize`. An optional custom prompt (`iedit.customPrompt`) is appended to the system instruction as `# Author instructions`.

The review view is one dark manuscript (`.manuscript`, background `#121316`, paragraphs with no extra margin). Summary is a `<details>` collapsed by default, and it includes the science-search note, any science error, and the source list. Suggestions render as strikethrough deletions and underlined insertions. Comments sit in a right rail and are stacked against the matching span (`layoutCommentRail`). Below 800px they stack under the paragraph. Accept, Reject, and Undo live in the copy-edit bubble and share one status with the redline. Accept bakes the replacement as plain text. Reject restores the original wording as a plain span so hover can still highlight it. Pending shows the redline. Do not drop rejected spans from the pieces. Science notes are bubbles too, marked search-checked or not. A science note with no span highlights the whole paragraph on hover. Hover paints the passage with `#1d4e89`, the same blue as `::selection`, and bolds it.

Accept all and Reject all stay. Download Word and Download LaTeX stay enabled. A chat-log button opens a new window with the system instruction and every turn.

`/test` loads `test/wordChatLog.txt` and `test/testManuscript.docx`. `/test?demo=latex` loads `test/latexChatLog.txt` and `test/testLatex.tex`. Both render through the same review pane, with no model call.

## Providers

`generateReview` in `src/llm/client.ts` is the only completion call. Review and Auto skill both use it.

- Gemini: `@google/genai` `generateContent`, `maxOutputTokens: 32768`. Do not send `googleSearch` on the science pass.
- Every other tab is OpenAI-compatible: `POST {base}/chat/completions` and `GET {base}/models`, Bearer auth, `max_tokens: 16384`. History role `model` is sent as `assistant`. Official `https://api.openai.com/v1` allows this browser call. Do not document it as blocked by CORS. ChatGPT’s listed models are `gpt-4.1-mini` (default) and `gpt-4.1` because of that token cap.
- The science pass works for every provider. It looks for statements that may be incorrect, unsupported, or logically flawed, then searches those. It does not check every citation, and it skips the bibliography. The first turn must return an `iedit-search` fence (`objective:` and `query:` lines, at most six). The page calls `web_search` on `https://search.parallel.ai/mcp`, then sends the excerpts back. The comment turn writes `[COMMENT-SCIENCE: …]` notes, and those notes are search-checked. That comment may also return one `iedit-search` fence of at most three objectives when a narrower query would help. The page searches that once and sends one last comment turn, which must not ask again. One `session_id` covers the whole review. A missing search fence on the first turn, a failed first search, or a first search with no sources stops the science pass and keeps the copy-edit. A failed follow-up keeps the notes already written and stops later science chunks. Do not present those missing notes as literature-checked.
- This science pass is a web search, not a full literature review. The skill text already says to answer “could not verify” when the excerpts do not settle a claim.

Do not add GitHub Copilot or Microsoft 365 Copilot as a paste-a-key tab. Neither exposes an OpenAI-compatible endpoint this static page can call. A user who has an OpenAI-compatible Azure or Foundry endpoint uses Other API.

One `history` of `{ role: 'user' | 'model', text }` runs through every copy-edit chunk and then the science chunks. Later turns are told not to repeat earlier suggestions. A retry because `~~old~~` was not verbatim is another turn in that same thread.

## Skills

The writing skill is three files, and each review step sends only its own file plus the discipline under `# Active discipline` (`systemInstruction` in `src/skills/index.ts`). Copy-edit uses `src/skills/copy-edit.md`. The science question turn uses `src/skills/science-review.md`. The science note turn uses `src/skills/science-comment.md`. The built-in discipline is `src/skills/disciplines/geoscience.md` (`id: geoscience`). Another built-in is a markdown file in that folder with `title:` in `---` frontmatter, registered in `BUILTIN_DISCIPLINES`.

Uploaded and generated skills are `{ id, title, body }` in `iedit.customSkills` only. They are not written into the repo. Auto skill lives in `src/components/SkillDialog.tsx`, not in Setup. It sends the geoscience skill as the example, forces the dropdown title to the name the user typed, and can download the `.md`. Generation uses the saved connection (`activeConnection()`), with `search: false`. A key typed in Setup but not saved with “Use this model” is invisible to it.

## Manuscript text and the model

Editable paragraphs are `body`, `heading`, and `table` (`isEditable`). Ids are `p-001` onward in emitted order (`paragraphId`).

`paragraph.text` is the plain Word string for body and headings. That is the coordinate space for `span`, `find`, `insert`, and `segments`. `marks` and `links` are for the prompt and the review display. Never write markdown syntax or those marks back into Word runs.

A `.tex` paragraph is stored the same way. `parseTex` drops comment, verbatim, and equation environments, and turns the rest into plain text: `\section` and `\title` become headings, `\textbf` and `\emph` become marks, and other commands are removed. `texMap` records where each plain character sits in the original source. Download LaTeX splices through that map, so a change inside `\textbf{...}` keeps the command.

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
- LaTeX pending wording is a `pdfcomment` strikeout of the source slice plus the replacement as normal text. A comment with no wording change is a `\pdfcomment` icon. `\usepackage{pdfcomment}` is added before `\begin{document}` when an annotation is present and the package is not already loaded. A source slice that contains a command is left in place and the note, including the suggested replacement, is a `\pdfcomment` instead of a strikeout. Accepted wording is written into the source. Rejected suggestions are omitted (`src/export/tex.ts`).

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
