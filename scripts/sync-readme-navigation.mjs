import { readFile, writeFile } from 'node:fs/promises';

const languages = [
  ['en', 'README.md', '%F0%9F%87%AC%F0%9F%87%A7', 'English'],
  ['id', 'README.id.md', '%F0%9F%87%AE%F0%9F%87%A9', 'Indonesia'],
  ['zh-tw', 'README.zh-tw.md', '%F0%9F%87%B9%F0%9F%87%BC', '繁體中文'],
  ['zh-cn', 'README.zh-cn.md', '%F0%9F%87%A8%F0%9F%87%B3', '简体中文'],
  ['ja', 'README.ja.md', '%F0%9F%87%AF%F0%9F%87%B5', '日本語'],
  ['ko', 'README.ko.md', '%F0%9F%87%B0%F0%9F%87%B7', '한국어'],
  ['de', 'README.de.md', '%F0%9F%87%A9%F0%9F%87%AA', 'Deutsch'],
  ['fr', 'README.fr.md', '%F0%9F%87%AB%F0%9F%87%B7', 'Français'],
  ['es', 'README.es.md', '%F0%9F%87%AA%F0%9F%87%B8', 'Español'],
  ['it', 'README.it.md', '%F0%9F%87%AE%F0%9F%87%B9', 'Italiano'],
  ['pt-br', 'README.pt-br.md', '%F0%9F%87%A7%F0%9F%87%B7', 'Português'],
];

function navigation(active) {
  const links = languages.map(([code, file, flag, label]) => {
    const current = code === active;
    const state = current ? ' (current language)' : '';
    const color = current ? '6D28D9' : '1D3557';
    return `  <a href="./${file}" title="${label}${state}"><img src="https://img.shields.io/badge/${flag}-${label}-${color}?style=for-the-badge" alt="${label}${state}"></a>`;
  }).join('\n');
  return `<p align="center">\n  <strong>Choose your language</strong><br>\n${links}\n</p>`;
}

for (const [code, file] of languages) {
  const url = new URL(`../profile/${file}`, import.meta.url);
  const source = await readFile(url, 'utf8');
  const updated = source.replace(
    /<p align="center">\s*<strong>[^<]*<\/strong><br>[\s\S]*?<\/p>/,
    navigation(code),
  );
  if (updated === source) throw new Error(`Language navigation was not found in ${file}`);
  await writeFile(url, updated, 'utf8');
  console.log(`${file}: navigation synchronized`);
}
