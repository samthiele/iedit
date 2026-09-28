# iEdit

Static manuscript review. Upload a Word or LaTeX file, bring a Gemini key or an OpenAI-compatible key, and review sentence-level suggestions before downloading a redlined `.docx` or `.tex` file.

The manuscript is read in the browser. The API key stays in local storage and is sent only to the provider you choose.

```bash
npm install
npm test
npm run dev
```

GitHub Pages build:

```bash
npm run build:pages
```

The pages workflow publishes `dist` from the `main` branch. The Vite base path for that build is `/iedit/`.

Discipline skills live in `src/skills/`. `scientific-writing.md` is always sent to Gemini. `src/skills/disciplines/geoscience.md` is the built-in field skill. More disciplines are further markdown files in that folder, each with a `title` in frontmatter. The page can also upload a discipline skill, which is stored only in the browser.
