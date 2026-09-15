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
  const gradientId = direct?.match(/^url\(#([^)]+)\)$/)?.[1];
  if (gradientId) {
    const gradient = raw.match(new RegExp(`<linearGradient\\b[^>]*\\bid="${gradientId}"[^>]*>([\\s\\S]*?)<\\/linearGradient>`))?.[1];
    const firstStop = gradient?.match(/stop-color="(#[0-9a-f]{3,8})"/i)?.[1];
    if (firstStop) return firstStop;
  }
  const inline = attr(tag, 'style')?.match(/(?:^|;)\s*fill:\s*(#[0-9a-f]{3,8})/i)?.[1];
  if (inline) return inline;
  for (const cls of (attr(tag, 'class') || '').split(/\s+/).reverse()) {
    const match = raw.match(new RegExp(`\\.${cls}\\s*\\{[^}]*?fill:\\s*(#[0-9a-f]{3,8})`, 'i'));
    if (match) return match[1];
  }
  return '#FFFFFF';
}

function repairGradientImpactBases(raw) {
  return raw.replace(/<rect\b[^>]*fill="url\(#[^)]+\)"[^>]*>[\s\S]*?<\/rect>/g, (rect) => {
    const base = fillFor(raw, rect);
    return rect.replace(/<animate\b[^>]*data-ball-impact="true"[^>]*>/, (animation) => {
      const values = (attr(animation, 'values') || '').split(';');
      if (values.length === 5) {
        values[0] = base;
        values[3] = base;
        values[4] = base;
        return animation.replace(/values="[^"]+"/, `values="${values.join(';')}"`);
      }
      return animation;
    });
  });
}

function addTextImpacts(raw) {
  const stack = [{ x: 0, y: 0 }], rects = [], replacements = [];
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
    if (token.startsWith('<rect')) {
      const impact = token.match(/<animate\b[^>]*data-ball-impact="true"[^>]*>/)?.[0];
      rects.push({
        x: +(attr(token, 'x') || 0) + offset.x,
        y: +(attr(token, 'y') || 0) + offset.y,
        w: +(attr(token, 'width') || 0), h: +(attr(token, 'height') || 0),
        impact,
        begin: impact ? attr(impact, 'begin') || '0s' : null,
        dur: impact ? attr(impact, 'dur') || '6s' : null,
        keyTimes: impact ? attr(impact, 'keyTimes') || '0;.07;.16;1' : null,
      });
      continue;
    }
    if (!token.startsWith('<text')) continue;
    const cleaned = token.replace(/<animate\b[^>]*data-ball-text-impact="true"[^>]*\/>/g, '');
    const x = +(attr(cleaned, 'x') || 0) + offset.x, y = +(attr(cleaned, 'y') || 0) + offset.y;
    const node = [...rects].reverse().find((box) => x >= box.x - 2 && x <= box.x + box.w + 2 && y >= box.y - 2 && y <= box.y + box.h + 4);
    if (!node?.impact) {
      if (cleaned !== token) replacements.push([match.index, token.length, cleaned]);
      continue;
    }
    const base = fillFor(raw, cleaned);
    const animation = `<animate data-ball-text-impact="true" attributeName="fill" values="${base};#FFFFFF;${base};${base}" keyTimes="${node.keyTimes}" dur="${node.dur}" begin="${node.begin}" repeatCount="indefinite"/>`;
    replacements.push([match.index, token.length, cleaned.replace('</text>', `${animation}</text>`)]);
  }
  for (const [index, length, updated] of replacements.reverse()) raw = raw.slice(0, index) + updated + raw.slice(index + length);
  return raw;
}

function makeReadable(raw) {
  if (!raw.includes('<animateMotion') || raw.includes('data-readable-timing="3x"')) return raw;
  raw = raw.replace('<svg ', '<svg data-readable-timing="3x" ');
  raw = raw.replace(/<animate(?:Motion)?\b[^>]*>/g, (tag) => {
    tag = tag.replace(/\bdur="([\d.]+)s"/, (_, value) => `dur="${(+value * 3).toFixed(2).replace(/\.00$/, '')}s"`);
    tag = tag.replace(/\bbegin="(-?[\d.]+)s"/, (_, value) => `begin="${(+value * 3).toFixed(2).replace(/\.00$/, '')}s"`);
    if (!/data-ball-(?:text-)?impact="true"/.test(tag)) return tag;
    const duration = +(attr(tag, 'dur') || '18').replace('s', '');
    const values = (attr(tag, 'values') || '').split(';');
    if (values.length === 4) tag = tag.replace(/\bvalues="[^"]+"/, `values="${values[0]};${values[1]};${values[1]};${values[2]};${values[3]}"`);
    const ramp = Math.min(.08, .4 / duration), hold = Math.min(.8, 2.4 / duration), fade = Math.min(.9, 2.8 / duration);
    tag = tag.replace(/\bkeyTimes="[^"]+"/, `keyTimes="0;${ramp.toFixed(4)};${hold.toFixed(4)};${fade.toFixed(4)};1"`);
    return tag;
  });
  return raw;
}

let changed = 0, impacted = 0;
for (const name of files) {
  const file = path.join(root, name);
  let raw = fs.readFileSync(file, 'utf8');
  const beforeWhiteTextFix = raw;
  raw = raw.replace(/<text\b[^>]*>[\s\S]*?<\/text>/g, (textTag) => {
    if (!/class="[^"]*(?:white|inverse)[^"]*"/.test(textTag) || !textTag.includes('data-ball-text-impact="true"')) return textTag;
    return textTag.replace(/<animate\b[^>]*data-ball-text-impact="true"[^>]*\/>/, (animation) => animation.replace(/values="[^"]+"/, 'values="#FFFFFF;#FFFFFF;#FFFFFF;#FFFFFF;#FFFFFF"'));
  });
  if (raw !== beforeWhiteTextFix) fs.writeFileSync(file, raw);
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
    const productMotion = '<g class="motion-layer" pointer-events="none">'
      + '<circle r="5" fill="#0B5FFF"><animateMotion dur="14.40s" begin="0s" repeatCount="indefinite" path="M450 340C410 340 405 108 350 108"/></circle>'
      + '<circle r="5" fill="#00A99D"><animateMotion dur="14.40s" begin="-1s" repeatCount="indefinite" path="M450 350C410 350 405 198 350 198"/></circle>'
      + '<circle r="5" fill="#6D28D9"><animateMotion dur="14.40s" begin="-2s" repeatCount="indefinite" path="M450 360C410 360 405 288 350 288"/></circle>'
      + '<circle r="5" fill="#17375E"><animateMotion dur="14.40s" begin="-3s" repeatCount="indefinite" path="M450 370C410 370 405 378 350 378"/></circle>'
      + '<circle r="5" fill="#0B5FFF"><animateMotion dur="14.40s" begin="-4s" repeatCount="indefinite" path="M450 380C410 380 405 468 350 468"/></circle>'
      + '<circle r="5" fill="#00A99D"><animateMotion dur="14.40s" begin="-5s" repeatCount="indefinite" path="M450 390C410 390 405 558 350 558"/></circle>'
      + '<circle r="5" fill="#6D28D9"><animateMotion dur="14.40s" begin="-6s" repeatCount="indefinite" path="M450 400C410 400 405 648 350 648"/></circle>'
      + '<circle r="5" fill="#0B5FFF"><animateMotion dur="14.40s" begin="-.5s" repeatCount="indefinite" path="M750 340C790 340 795 108 850 108"/></circle>'
      + '<circle r="5" fill="#00A99D"><animateMotion dur="14.40s" begin="-1.5s" repeatCount="indefinite" path="M750 350C790 350 795 198 850 198"/></circle>'
      + '<circle r="5" fill="#6D28D9"><animateMotion dur="14.40s" begin="-2.5s" repeatCount="indefinite" path="M750 360C790 360 795 288 850 288"/></circle>'
      + '<circle r="5" fill="#17375E"><animateMotion dur="14.40s" begin="-3.5s" repeatCount="indefinite" path="M750 370C790 370 795 378 850 378"/></circle>'
      + '<circle r="5" fill="#0B5FFF"><animateMotion dur="14.40s" begin="-4.5s" repeatCount="indefinite" path="M750 380C790 380 795 468 850 468"/></circle>'
      + '<circle r="5" fill="#00A99D"><animateMotion dur="14.40s" begin="-5.5s" repeatCount="indefinite" path="M750 390C790 390 795 558 850 558"/></circle>'
      + '<circle r="5" fill="#6D28D9"><animateMotion dur="14.40s" begin="-6.5s" repeatCount="indefinite" path="M750 400C790 400 795 648 850 648"/></circle>'
      + '</g>';
    raw = raw.replace(/<g class="motion-layer" pointer-events="none">(?:<circle\b[\s\S]*?<\/circle>)+<\/g>/, productMotion);
    raw = raw.replace('href="../logos/main_sophistec_global_01.png" x="18" y="16" width="40" height="40"/><text x="75" y="32" class="label">Sophistec Lumora', 'href="../logos/main_studio_01.png" x="18" y="16" width="40" height="40"/><text x="75" y="32" class="label">Sophistec Lumora');
    raw = raw.replace('values="#FFFFFF;#93C5FD;#FFFFFF;#FFFFFF" keyTimes="0;.07;.16;1" dur="4.8s" begin="0.00s"', 'values="#6D28D9;#00A99D;#6D28D9;#6D28D9" keyTimes="0;.07;.16;1" dur="4.8s" begin="0.00s"');
    raw = raw.replace(/href="\.\.\/logos\/([^"]+\.png)"/g, (_, logoName) => {
      const logoPath = path.resolve(root, '..', 'logos', logoName);
      const encoded = fs.readFileSync(logoPath).toString('base64');
      return `href="data:image/png;base64,${encoded}"`;
    });
    fs.writeFileSync(file, raw);
  }
  if (name === 'engineering-journey.svg' || name === 'platform-ecosystem.svg' || name === 'ai-intelligence-layer.svg') {
    const keyPoints = '0;0;.1663;.1663;.3337;.3337;.5;.5;.6663;.6663;.8337;.8337;1;1;1';
    const keyTimes = '0;.0952;.1429;.2381;.2857;.3810;.4286;.5238;.5714;.6667;.7143;.8095;.8571;.9524;1';
    raw = raw.replace(/<animateMotion dur="21s" repeatCount="indefinite" path="M80 140 H1120"[^>]*\/>/, `<animateMotion dur="21s" repeatCount="indefinite" path="M80 140 H1120" keyPoints="${keyPoints}" keyTimes="${keyTimes}" calcMode="linear"/>`);
    const arrivals = new Map([['2.43s', '3s'], ['5.82s', '6s'], ['9.36s', '9s'], ['12.93s', '12s'], ['16.32s', '15s'], ['19.86s', '18s']]);
    raw = raw.replace(/begin="(2\.43s|5\.82s|9\.36s|12\.93s|16\.32s|19\.86s)"/g, (_, timing) => `begin="${arrivals.get(timing)}"`);
    fs.writeFileSync(file, raw);
  }
  const stronger = raw.replace(/<animate\b[^>]*attributeName="fill"[^>]*>/g, (tag) => tag
    .replaceAll('#DBEAFE', '#0B5FFF').replaceAll('#93C5FD', '#0B5FFF')
    .replaceAll('#CCFBF1', '#00A99D').replaceAll('#5EEAD4', '#00A99D')
    .replaceAll('#EDE9FE', '#6D28D9').replaceAll('#C4B5FD', '#6D28D9'));
  if (stronger !== raw) { raw = stronger; fs.writeFileSync(file, raw); }
  const withGradientBases = repairGradientImpactBases(raw);
  if (withGradientBases !== raw) { raw = withGradientBases; fs.writeFileSync(file, raw); }
  raw = withGradientBases;
  const withTextImpact = addTextImpacts(raw);
  if (withTextImpact !== raw) { raw = withTextImpact; fs.writeFileSync(file, raw); }
  const readable = makeReadable(raw);
  if (readable !== raw) { raw = readable; fs.writeFileSync(file, raw); }
  raw = readable;
  if (name === 'engineering-principles.svg') {
    const alwaysDarkLabels = 'Secure|By Design|Observable|In Production|AI Grounded|Controlled';
    const withReadableStaticLabels = raw.replace(
      new RegExp(`(<text[^>]*>(?:${alwaysDarkLabels}))<animate data-ball-text-impact="true"[^>]*/>(</text>)`, 'g'),
      '$1$2',
    );
    if (withReadableStaticLabels !== raw) {
      raw = withReadableStaticLabels;
      fs.writeFileSync(file, raw);
    }
  }
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
