import { readFile, writeFile } from 'node:fs/promises';

const sourcePath = new URL('../profile/README.md', import.meta.url);
const targets = [
  ['id', 'Indonesian (Bahasa Indonesia)'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['fr', 'French'],
  ['es', 'Spanish'],
  ['zh-tw', 'Traditional Chinese used in Taiwan'],
  ['zh-cn', 'Simplified Chinese'],
];

const badges = [
  ['en', './README.md', '%F0%9F%87%AC%F0%9F%87%A7', 'English'],
  ['id', './README.id.md', '%F0%9F%87%AE%F0%9F%87%A9', 'Indonesia'],
  ['ja', './README.ja.md', '%F0%9F%87%AF%F0%9F%87%B5', '日本語'],
  ['ko', './README.ko.md', '%F0%9F%87%B0%F0%9F%87%B7', '한국어'],
  ['fr', './README.fr.md', '%F0%9F%87%AB%F0%9F%87%B7', 'Français'],
  ['es', './README.es.md', '%F0%9F%87%AA%F0%9F%87%B8', 'Español'],
  ['zh-tw', './README.zh-tw.md', '%F0%9F%87%B9%F0%9F%87%BC', '繁體中文'],
  ['zh-cn', './README.zh-cn.md', '%F0%9F%87%A8%F0%9F%87%B3', '简体中文'],
];
const makeNavigation = (active) => `<p align="center">\n  <strong>Choose your language</strong><br>\n${badges.map(([code, href, flag, label]) => {
  const current = code === active;
  return `  <a href="${href}" title="${label}${current ? ' (current language)' : ''}"><img src="https://img.shields.io/badge/${flag}-${label}-${current ? '6D28D9' : '1D3557'}?style=for-the-badge" alt="${label}${current ? ' (current language)' : ''}"></a>`;
}).join('\n')}\n</p>`;

function splitSections(markdown, maxChars = 120000) {
  const pieces = markdown.split(/(?=^## )/m);
  const chunks = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + piece.length > maxChars) {
      chunks.push(current);
      current = '';
    }
    current += piece;
  }
  if (current) chunks.push(current);
  return chunks;
}

function signature(markdown) {
  return {
    h1: (markdown.match(/^# /gm) || []).length,
    h2: (markdown.match(/^## /gm) || []).length,
    h3: (markdown.match(/^### /gm) || []).length,
    images: [...markdown.matchAll(/src="([^"]+)"/g)].map((m) => m[1]),
    fences: (markdown.match(/^```/gm) || []).length,
    tables: (markdown.match(/^\|.*\|$/gm) || []).length,
  };
}

async function translate(chunk, language, index, total) {
  const prompt = `Translate the following GitHub profile README section from English into ${language}.

STRICT REQUIREMENTS:
- Return only the translated Markdown, with no commentary and no code fence around the result.
- Preserve every heading level, paragraph, list item, blockquote, table row, badge, image, HTML tag, URL, anchor, code block, diagram, emoji, and line order.
- Do not omit, summarize, merge, add, or reorder any content.
- Translate human-readable prose and headings only.
- Keep product names, company names, technology names, acronyms, commands, code, filenames, image alt-path values, URLs, and HTML attributes unchanged.
- Keep all relative links and src values byte-for-byte unchanged.
- This is chunk ${index + 1} of ${total}; do not add a document title or language navigation unless present in the input.

MARKDOWN TO TRANSLATE:
${chunk}`;
  const response = await fetch('http://127.0.0.1:11434/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gemma4:latest', prompt, stream: false, options: { temperature: 0.1, num_ctx: 49152 } }),
  });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return data.response.trim();
}

const source = await readFile(sourcePath, 'utf8');
const chunks = splitSections(source);
const expected = signature(source);
console.log(`Source: ${source.split('\n').length} lines, ${chunks.length} translation chunks.`);

for (const [code, language] of targets) {
  const translated = [];
  for (let index = 0; index < chunks.length; index++) {
    console.log(`[${code}] translating ${index + 1}/${chunks.length}`);
    translated.push(await translate(chunks[index], language, index, chunks.length));
  }
  let output = `${translated.join('\n\n').trim()}\n`;
  output = output.replace(/<p align="center">\s*<strong>Choose your language<\/strong><br>[\s\S]*?<\/p>/, makeNavigation(code));
  const actual = signature(output);
  const structuralMatch = actual.h1 === expected.h1 && actual.h2 === expected.h2 &&
    actual.h3 === expected.h3 && actual.fences === expected.fences &&
    JSON.stringify(actual.images) === JSON.stringify(expected.images);
  if (!structuralMatch) {
    throw new Error(`[${code}] structural validation failed: ${JSON.stringify({ expected, actual })}`);
  }
  await writeFile(new URL(`../profile/README.${code}.md`, import.meta.url), output, 'utf8');
  console.log(`[${code}] written and validated.`);
}

console.log('All localized README files are synchronized.');
