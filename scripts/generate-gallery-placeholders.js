// One-off generator for the gallery's placeholder artwork imagery — abstract
// monochrome graphite/charcoal-like textures (SVG feTurbulence), never
// photographs, so there's nothing to mistake for a real drawing once real
// photography replaces these via /gallery/admin. Re-run with `node
// scripts/generate-gallery-placeholders.js` any time a seed artwork needs a
// fresh placeholder.
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(process.cwd(), 'public', 'gallery-assets', 'placeholder');
fs.mkdirSync(OUT_DIR, { recursive: true });

function grain({ id, freq, seed, octaves = 4, scale = 40, contrast = 1 }) {
  return `
    <filter id="${id}" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${octaves}" seed="${seed}" result="noise" stitchTiles="stitch"/>
      <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.9 0.9 0.9 0 0" result="alphaNoise"/>
      <feComponentTransfer in="alphaNoise" result="contrastNoise">
        <feFuncA type="gamma" amplitude="${contrast}" exponent="1.4" offset="0"/>
      </feComponentTransfer>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  `;
}

function baseCanvas({ w, h, id, freq, seed, bg = '#efe9df', fg = '#171412' }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    ${grain({ id, freq, seed })}
    <radialGradient id="${id}-vignette" cx="50%" cy="42%" r="75%">
      <stop offset="0%" stop-color="${bg}" stop-opacity="0"/>
      <stop offset="78%" stop-color="${bg}" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.35"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="${bg}"/>
  <g filter="url(#${id})" opacity="0.9">
    <rect width="${w}" height="${h}" fill="${fg}" opacity="0.55"/>
  </g>
  <rect width="${w}" height="${h}" fill="url(#${id}-vignette)"/>
</svg>`;
}

function textureCanvas({ w, h, id, freq, seed }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>${grain({ id, freq, seed, scale: 14, octaves: 5 })}</defs>
  <rect width="${w}" height="${h}" fill="#e9e2d5"/>
  <g filter="url(#${id})">
    <rect width="${w}" height="${h}" fill="#2a2621" opacity="0.5"/>
  </g>
</svg>`;
}

function framedCanvas({ w, h, id, freq, seed }) {
  const matW = w * 0.62;
  const matH = h * 0.62;
  const matX = (w - matW) / 2;
  const matY = h * 0.16;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    ${grain({ id, freq, seed, scale: 22 })}
    <linearGradient id="${id}-wall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#c9c3b8"/>
      <stop offset="100%" stop-color="#a9a296"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#${id}-wall)"/>
  <rect x="${matX - 14}" y="${matY - 14}" width="${matW + 28}" height="${matH + 28}" fill="#1b1815"/>
  <rect x="${matX}" y="${matY}" width="${matW}" height="${matH}" fill="#f3efe6"/>
  <g filter="url(#${id})">
    <rect x="${matX + matW * 0.06}" y="${matY + matH * 0.06}" width="${matW * 0.88}" height="${matH * 0.88}" fill="#221f1b" opacity="0.6"/>
  </g>
  <rect x="${matX - 14}" y="${matY - 14}" width="${matW + 28}" height="${matH + 28}" fill="none" stroke="#0c0a09" stroke-width="3"/>
</svg>`;
}

const works = [
  { seed: 'the-garden', n: 1 },
  { seed: 'gethsemane', n: 2 },
  { seed: 'uniform', n: 3 },
  { seed: 'held', n: 4 },
];

for (const w of works) {
  fs.writeFileSync(path.join(OUT_DIR, `${w.seed}.svg`), baseCanvas({ w: 1000, h: 1250, id: `${w.seed}-hero`, freq: 0.012 + w.n * 0.002, seed: w.n }));
  fs.writeFileSync(path.join(OUT_DIR, `${w.seed}-detail-1.svg`), textureCanvas({ w: 900, h: 900, id: `${w.seed}-detail`, freq: 0.05 + w.n * 0.01, seed: w.n + 10 }));
  fs.writeFileSync(path.join(OUT_DIR, `${w.seed}-texture.svg`), textureCanvas({ w: 900, h: 900, id: `${w.seed}-texture`, freq: 0.08 + w.n * 0.01, seed: w.n + 20 }));
  fs.writeFileSync(path.join(OUT_DIR, `${w.seed}-framed.svg`), framedCanvas({ w: 1200, h: 1000, id: `${w.seed}-framed`, freq: 0.012 + w.n * 0.002, seed: w.n }));
}

const portrait = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1250" viewBox="0 0 1000 1250">
  <defs>
    ${grain({ id: 'portrait-grain', freq: 0.018, seed: 7, scale: 30 })}
    <radialGradient id="portrait-light" cx="38%" cy="30%" r="65%">
      <stop offset="0%" stop-color="#3a352d"/>
      <stop offset="100%" stop-color="#0c0a08"/>
    </radialGradient>
  </defs>
  <rect width="1000" height="1250" fill="url(#portrait-light)"/>
  <g filter="url(#portrait-grain)" opacity="0.5">
    <rect width="1000" height="1250" fill="#000000"/>
  </g>
  <g opacity="0.55" stroke="#cfc6b4" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M330 980 C 330 760, 380 640, 500 640 C 620 640, 670 760, 670 980" />
    <circle cx="500" cy="470" r="120" />
    <path d="M260 1080 C 340 1010, 660 1010, 740 1080" />
    <path d="M420 640 C 420 560, 430 500, 500 470" />
    <path d="M540 900 L 640 940" />
  </g>
  <rect width="1000" height="1250" fill="url(#portrait-light)" opacity="0.15"/>
</svg>`;
fs.writeFileSync(path.join(OUT_DIR, 'artist-portrait.svg'), portrait);
fs.writeFileSync(path.join(OUT_DIR, 'upcoming-silhouette.svg'), baseCanvas({ w: 1000, h: 1250, id: 'upcoming-hero', freq: 0.014, seed: 99, bg: '#151210', fg: '#050403' }));

const signature = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240" viewBox="0 0 600 240">
  <rect width="600" height="240" fill="#f3efe6"/>
  <path d="M40 170 C 80 90, 120 90, 140 150 S 200 90, 230 150 S 290 90, 320 150 S 380 100, 410 150 C 430 175, 470 175, 500 140"
        fill="none" stroke="#171412" stroke-width="4" stroke-linecap="round" opacity="0.85"/>
  <text x="40" y="205" font-family="Georgia, serif" font-size="20" fill="#4a453e" letter-spacing="2">SIGNED, GRAPHITE ON PAPER</text>
</svg>`;
fs.writeFileSync(path.join(OUT_DIR, 'signature.svg'), signature);

console.log(`[gallery-placeholders] wrote ${works.length * 4 + 3} SVGs to ${OUT_DIR}`);
