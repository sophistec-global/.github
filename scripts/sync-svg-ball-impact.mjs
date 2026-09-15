import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('assets/svg');
const files = fs.readdirSync(root).filter((name) => name.endsWith('.svg'));
const number = String.raw`[-+]?\d*\.?\d+`;

function attr(tag, name) {
  return tag.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1];
}

function points(d) {
  const tokens = [...d.matchAll(/[MLHVCZmlhvcz]|[-+]?\d*\.?\d+(?:e[-+]?\d+)?/g)].map((m) => m[0]);
  const out = [];
  let i = 0, command = '', x = 0, y = 0, startX = 0, startY = 0;
  const pushLine = (nx, ny) => {
    const steps = Math.max(2, Math.ceil(Math.hypot(nx - x, ny - y) / 8));
    for (let s = 1; s <= steps; s++) out.push([x + (nx - x) * s / steps, y + (ny - y) * s / steps]);
    x = nx; y = ny;
  };
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) command = tokens[i++];
    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();
    if (upper === 'M' || upper === 'L') {
      let nx = +tokens[i++], ny = +tokens[i++];
      if (relative) { nx += x; ny += y; }
      if (upper === 'M') { x = nx; y = ny; startX = x; startY = y; out.push([x, y]); command = relative ? 'l' : 'L'; }
      else pushLine(nx, ny);
    } else if (upper === 'H') {
      let nx = +tokens[i++]; if (relative) nx += x; pushLine(nx, y);
    } else if (upper === 'V') {
      let ny = +tokens[i++]; if (relative) ny += y; pushLine(x, ny);
    } else if (upper === 'C') {
      let x1 = +tokens[i++], y1 = +tokens[i++], x2 = +tokens[i++], y2 = +tokens[i++], nx = +tokens[i++], ny = +tokens[i++];
      if (relative) { x1 += x; y1 += y; x2 += x; y2 += y; nx += x; ny += y; }
      const ox = x, oy = y;
      for (let s = 1; s <= 30; s++) { const t = s / 30, u = 1 - t; out.push([u*u*u*ox + 3*u*u*t*x1 + 3*u*t*t*x2 + t*t*t*nx, u*u*u*oy + 3*u*u*t*y1 + 3*u*t*t*y2 + t*t*t*ny]); }
      x = nx; y = ny;
    } else if (upper === 'Z') { pushLine(startX, startY); command = ''; }
    else i++;
  }
  return out;
}

function fillFor(raw, tag) {
  const direct = attr(tag, 'fill');
  if (direct && /^#[0-9a-f]{3,8}$/i.test(direct)) return direct;
  for (const cls of (attr(tag, 'class') || '').split(/\s+/)) {
    const match = raw.match(new RegExp(`\\.${cls}\\s*\\{[^}]*?fill:\\s*(#[0-9a-f]{3,8})`, 'i'));
    if (match) return match[1];
  }
  return '#FFFFFF';
}

let changed = 0, impacted = 0;
for (const name of files) {
  const file = path.join(root, name);
  let raw = fs.readFileSync(file, 'utf8');
  if (!raw.includes('<animateMotion') || raw.includes('data-ball-impact="true"')) continue;
  const svgWidth = +(raw.match(/<svg[^>]*\bwidth="([\d.]+)"/)?.[1] || 1200);
  const svgHeight = +(raw.match(/<svg[^>]*\bheight="([\d.]+)"/)?.[1] || 500);
  const routes = [];
  for (const motion of raw.matchAll(/<animateMotion\b[^>]*?(?:\/>|>[\s\S]*?<\/animateMotion>)/g)) {
    const duration = +(attr(motion[0], 'dur') || '6').replace('s', '');
    let d = attr(motion[0], 'path');
    if (!d) {
      const id = motion[0].match(/<mpath[^>]*href="#([^"]+)"/)?.[1];
      if (id) d = raw.match(new RegExp(`<path[^>]*id="${id}"[^>]*d="([^"]+)"`))?.[1];
    }
    if (d) routes.push({ duration, samples: points(d) });
  }
  if (!routes.length) continue;
  const replacements = [];
  for (const match of raw.matchAll(/<rect\b[^>]*(?:\/>|>[\s\S]*?<\/rect>)/g)) {
    const tag = match[0];
    const prefix = raw.slice(Math.max(0, match.index - 120), match.index);
    const translated = prefix.match(/<g\s+transform="translate\(([\d.-]+)[ ,]+([\d.-]+)\)"[^>]*>[^<]*$/);
    const x = +(attr(tag, 'x') || 0) + +(translated?.[1] || 0), y = +(attr(tag, 'y') || 0) + +(translated?.[2] || 0), w = +(attr(tag, 'width') || 0), h = +(attr(tag, 'height') || 0);
    if (!w || !h || w < 70 || h < 30 || w > svgWidth * .82 || h > svgHeight * .82 || /\bbg\b/.test(attr(tag, 'class') || '') || tag.includes('attributeName="fill"')) continue;
    let best = null;
    for (const route of routes) {
      const hit = route.samples.findIndex(([px, py]) => px >= x - 12 && px <= x + w + 12 && py >= y - 35 && py <= y + h + 12);
      if (hit >= 0) {
        const candidate = { delay: route.duration * hit / Math.max(1, route.samples.length - 1), duration: route.duration };
        if (!best || candidate.delay < best.delay) best = candidate;
      }
    }
    if (!best) continue;
    const base = fillFor(raw, tag);
    const tint = /teal|green/i.test(attr(tag, 'class') || '') ? '#CCFBF1' : /violet|purple/i.test(attr(tag, 'class') || '') ? '#EDE9FE' : '#DBEAFE';
    const animation = `<animate data-ball-impact="true" attributeName="fill" values="${base};${tint};${base};${base}" keyTimes="0;.07;.16;1" dur="${best.duration}s" begin="${best.delay.toFixed(2)}s" repeatCount="indefinite"/>`;
    const updated = tag.endsWith('/>') ? `${tag.slice(0, -2)}>${animation}</rect>` : tag.replace('</rect>', `${animation}</rect>`);
    replacements.push([match.index, tag.length, updated]); impacted++;
  }
  for (const [index, length, updated] of replacements.reverse()) raw = raw.slice(0, index) + updated + raw.slice(index + length);
  if (replacements.length) { fs.writeFileSync(file, raw); changed++; }
}

console.log(`updated_files=${changed}`);
console.log(`impacted_shapes=${impacted}`);
