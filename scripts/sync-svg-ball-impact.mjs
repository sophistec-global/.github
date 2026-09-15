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
  const inline = attr(tag, 'style')?.match(/(?:^|;)\s*fill:\s*(#[0-9a-f]{3,8})/i)?.[1];
  if (inline) return inline;
  for (const cls of (attr(tag, 'class') || '').split(/\s+/).reverse()) {
    const match = raw.match(new RegExp(`\\.${cls}\\s*\\{[^}]*?fill:\\s*(#[0-9a-f]{3,8})`, 'i'));
    if (match) return match[1];
  }
  return '#FFFFFF';
}

function addTextImpacts(raw) {
  const stack = [{ x: 0, y: 0 }], activeRects = [], replacements = [];
  const tokenPattern = /<g\b[^>]*>|<\/g>|<rect\b[^>]*(?:\/>|>[\s\S]*?<\/rect>)|<text\b[^>]*>[\s\S]*?<\/text>/g;
  for (const match of raw.matchAll(tokenPattern)) {
    const token = match[0];
    if (token.startsWith('<g')) {
      const parent = stack.at(-1);
      const move = attr(token, 'transform')?.match(/translate\(([\d.-]+)[ ,]+([\d.-]+)\)/);
      stack.push({ x: parent.x + +(move?.[1] || 0), y: parent.y + +(move?.[2] || 0) });
      continue;
    }
    if (token === '</g>') { if (stack.length > 1) stack.pop(); continue; }
    const offset = stack.at(-1);
    if (token.startsWith('<rect') && token.includes('data-ball-impact="true"')) {
      const impact = token.match(/<animate\b[^>]*data-ball-impact="true"[^>]*>/)?.[0];
      if (!impact) continue;
      activeRects.push({
        x: +(attr(token, 'x') || 0) + offset.x,
        y: +(attr(token, 'y') || 0) + offset.y,
        w: +(attr(token, 'width') || 0), h: +(attr(token, 'height') || 0),
        begin: attr(impact, 'begin') || '0s', dur: attr(impact, 'dur') || '6s', keyTimes: attr(impact, 'keyTimes') || '0;.07;.16;1',
      });
      continue;
    }
    if (!token.startsWith('<text') || token.includes('data-ball-text-impact="true"')) continue;
    const x = +(attr(token, 'x') || 0) + offset.x, y = +(attr(token, 'y') || 0) + offset.y;
    const node = [...activeRects].reverse().find((box) => x >= box.x - 2 && x <= box.x + box.w + 2 && y >= box.y - 2 && y <= box.y + box.h + 4);
    if (!node) continue;
    const base = fillFor(raw, token);
    const animation = `<animate data-ball-text-impact="true" attributeName="fill" values="${base};#FFFFFF;${base};${base}" keyTimes="${node.keyTimes}" dur="${node.dur}" begin="${node.begin}" repeatCount="indefinite"/>`;
    replacements.push([match.index, token.length, token.replace('</text>', `${animation}</text>`)]);
  }
  for (const [index, length, updated] of replacements.reverse()) raw = raw.slice(0, index) + updated + raw.slice(index + length);
  return raw;
}

let changed = 0, impacted = 0;
for (const name of files) {
  const file = path.join(root, name);
  let raw = fs.readFileSync(file, 'utf8');
  if (name === 'hero-technology-network.svg') {
    const boundaryRoutes = new Map([
      ['<path d="M600 180 L150 95" class="dash"/>', '<path d="M465 154.5 L260 115.8" class="dash"/>'],
      ['<path d="M600 180 L150 250" class="dash"/>', '<path d="M465 201 L260 232.9" class="dash"/>'],
      ['<path d="M600 180 L1050 95" class="dash"/>', '<path d="M735 154.5 L940 115.8" class="dash"/>'],
      ['<path d="M600 180 L1050 250" class="dash"/>', '<path d="M735 201 L940 232.9" class="dash"/>'],
      ['<path d="M600 180 L600 300" class="dash"/>', '<path d="M600 220 L600 269" class="dash"/>'],
    ]);
    for (const [fullRoute, boundaryRoute] of boundaryRoutes) raw = raw.replace(fullRoute, boundaryRoute);
    fs.writeFileSync(file, raw);
  }
  if (name === 'product-constellation.svg') {
    const misplacedMotion = '<g class="motion-layer" pointer-events="none"><circle r="6" class="pulse"><animateMotion dur="4.8s" repeatCount="indefinite" path="M450 370C410 370 405 378 350 378"/></circle></g>';
    raw = raw.replace(`<g transform="translate(50 72)">${misplacedMotion}`, `${misplacedMotion}<g transform="translate(50 72)">`);
    raw = raw.replace('href="../logos/main_sophistec_global_01.png" x="18" y="16" width="40" height="40"/><text x="75" y="32" class="label">Sophistec Lumora', 'href="../logos/main_studio_01.png" x="18" y="16" width="40" height="40"/><text x="75" y="32" class="label">Sophistec Lumora');
    raw = raw.replace('values="#FFFFFF;#93C5FD;#FFFFFF;#FFFFFF" keyTimes="0;.07;.16;1" dur="4.8s" begin="0.00s"', 'values="#6D28D9;#00A99D;#6D28D9;#6D28D9" keyTimes="0;.07;.16;1" dur="4.8s" begin="0.00s"');
    raw = raw.replace(/href="\.\.\/logos\/([^"]+\.png)"/g, (_, logoName) => {
      const logoPath = path.resolve(root, '..', 'logos', logoName);
      const encoded = fs.readFileSync(logoPath).toString('base64');
      return `href="data:image/png;base64,${encoded}"`;
    });
    fs.writeFileSync(file, raw);
  }
  const stronger = raw.replace(/<animate\b[^>]*attributeName="fill"[^>]*>/g, (tag) => tag
    .replaceAll('#DBEAFE', '#0B5FFF').replaceAll('#93C5FD', '#0B5FFF')
    .replaceAll('#CCFBF1', '#00A99D').replaceAll('#5EEAD4', '#00A99D')
    .replaceAll('#EDE9FE', '#6D28D9').replaceAll('#C4B5FD', '#6D28D9'));
  if (stronger !== raw) { raw = stronger; fs.writeFileSync(file, raw); }
  const withTextImpact = addTextImpacts(raw);
  if (withTextImpact !== raw) { raw = withTextImpact; fs.writeFileSync(file, raw); }
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
    const tint = /teal|green/i.test(attr(tag, 'class') || '') ? '#00A99D' : /violet|purple/i.test(attr(tag, 'class') || '') ? '#6D28D9' : '#0B5FFF';
    const animation = `<animate data-ball-impact="true" attributeName="fill" values="${base};${tint};${base};${base}" keyTimes="0;.07;.16;1" dur="${best.duration}s" begin="${best.delay.toFixed(2)}s" repeatCount="indefinite"/>`;
    const updated = tag.endsWith('/>') ? `${tag.slice(0, -2)}>${animation}</rect>` : tag.replace('</rect>', `${animation}</rect>`);
    replacements.push([match.index, tag.length, updated]); impacted++;
  }
  for (const [index, length, updated] of replacements.reverse()) raw = raw.slice(0, index) + updated + raw.slice(index + length);
  if (replacements.length) { fs.writeFileSync(file, raw); changed++; }
}

console.log(`updated_files=${changed}`);
console.log(`impacted_shapes=${impacted}`);
