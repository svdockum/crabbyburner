// Renders the crab sprite to the home-screen icons in public/ (192 and 512 px PNG).
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const Sprite = require('../public/sprite.js');

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const BG = hex('#141110');

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function png(size, rgb) {
  const row = size * 4 + 1;
  const raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = y * row + 1 + x * 4;
      const c = rgb[y * size + x];
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function render(size) {
  // Keep the crab inside the maskable safe zone (the middle 80%).
  const scale = Math.floor((size * 0.62) / Sprite.w);
  const ox = Math.floor((size - Sprite.w * scale) / 2);
  const oy = Math.floor((size - Sprite.h * scale) / 2);
  const rgb = new Array(size * size).fill(BG);
  for (const [x, y, key] of Sprite.pixels({ eyes: 'open' })) {
    const c = hex(Sprite.colors[key]);
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) rgb[(oy + y * scale + dy) * size + ox + x * scale + dx] = c;
    }
  }
  return png(size, rgb);
}

for (const size of [192, 512]) {
  const file = new URL(`../public/icon-${size}.png`, import.meta.url);
  writeFileSync(file, render(size));
  console.log('wrote', file.pathname);
}
