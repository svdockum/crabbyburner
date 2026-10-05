// Renders the crab sprite to every icon the project ships: the web page's
// home-screen icons (public/) and the Flutter app's Android launcher icons.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const Sprite = require('../public/sprite.js');

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(255);
const INK = hex('#141110');
const CLEAR = [0, 0, 0, 0];

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const row = size * 4 + 1;
  const raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = y * row + 1 + x * 4;
      const c = rgba[y * size + x];
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = c[3];
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

// The crab, centred, `fill` of the icon wide, on `bg`.
function render(size, { bg = INK, fill = 0.62 } = {}) {
  const scale = Math.max(1, Math.floor((size * fill) / Sprite.w));
  const ox = Math.floor((size - Sprite.w * scale) / 2);
  const oy = Math.floor((size - Sprite.h * scale) / 2);
  const rgba = new Array(size * size).fill(bg);
  for (const [x, y, key] of Sprite.pixels({ eyes: 'open' })) {
    const c = hex(Sprite.colors[key]);
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) rgba[(oy + y * scale + dy) * size + ox + x * scale + dx] = c;
    }
  }
  return png(size, rgba);
}

function write(rel, data) {
  const file = new URL(rel, import.meta.url);
  mkdirSync(new URL('.', file), { recursive: true });
  writeFileSync(file, data);
  console.log('wrote', rel.replace('../', ''));
}

// Web page: maskable, so the crab stays inside the middle 80%.
for (const size of [192, 512]) write(`../public/icon-${size}.png`, render(size));

// Android: a legacy square for Android 7, and an adaptive foreground (108dp,
// transparent, crab inside the 66dp circle every launcher mask keeps).
const RES = '../app/android/app/src/main/res/';
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [name, k] of Object.entries(DENSITIES)) {
  write(`${RES}mipmap-${name}/ic_launcher.png`, render(48 * k));
  write(`${RES}mipmap-${name}/ic_launcher_foreground.png`, render(108 * k, { bg: CLEAR, fill: 0.5 }));
}
