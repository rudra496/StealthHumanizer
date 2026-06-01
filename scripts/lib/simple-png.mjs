import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const FONT = {
  ' ': ['00000','00000','00000','00000','00000','00000','00000'],
  '!': ['00100','00100','00100','00100','00100','00000','00100'],
  '.': ['00000','00000','00000','00000','00000','00110','00110'],
  ',': ['00000','00000','00000','00000','00110','00110','01100'],
  ':': ['00000','00110','00110','00000','00110','00110','00000'],
  '/': ['00001','00010','00100','01000','10000','00000','00000'],
  '-': ['00000','00000','00000','11111','00000','00000','00000'],
  '_': ['00000','00000','00000','00000','00000','00000','11111'],
  '%': ['11001','11010','00100','01000','10110','00110','00000'],
  '$': ['00100','01111','10100','01110','00101','11110','00100'],
  '(': ['00010','00100','01000','01000','01000','00100','00010'],
  ')': ['01000','00100','00010','00010','00010','00100','01000'],
  '+': ['00000','00100','00100','11111','00100','00100','00000'],
  '0': ['01110','10001','10011','10101','11001','10001','01110'],
  '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00010','00100','01000','11111'],
  '3': ['11110','00001','00001','01110','00001','00001','11110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'],
  '5': ['11111','10000','10000','11110','00001','00001','11110'],
  '6': ['00110','01000','10000','11110','10001','10001','01110'],
  '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'],
  '9': ['01110','10001','10001','01111','00001','00010','01100'],
  'A': ['01110','10001','10001','11111','10001','10001','10001'],
  'B': ['11110','10001','10001','11110','10001','10001','11110'],
  'C': ['01110','10001','10000','10000','10000','10001','01110'],
  'D': ['11110','10001','10001','10001','10001','10001','11110'],
  'E': ['11111','10000','10000','11110','10000','10000','11111'],
  'F': ['11111','10000','10000','11110','10000','10000','10000'],
  'G': ['01110','10001','10000','10111','10001','10001','01111'],
  'H': ['10001','10001','10001','11111','10001','10001','10001'],
  'I': ['01110','00100','00100','00100','00100','00100','01110'],
  'J': ['00111','00010','00010','00010','10010','10010','01100'],
  'K': ['10001','10010','10100','11000','10100','10010','10001'],
  'L': ['10000','10000','10000','10000','10000','10000','11111'],
  'M': ['10001','11011','10101','10101','10001','10001','10001'],
  'N': ['10001','11001','10101','10011','10001','10001','10001'],
  'O': ['01110','10001','10001','10001','10001','10001','01110'],
  'P': ['11110','10001','10001','11110','10000','10000','10000'],
  'Q': ['01110','10001','10001','10001','10101','10010','01101'],
  'R': ['11110','10001','10001','11110','10100','10010','10001'],
  'S': ['01111','10000','10000','01110','00001','00001','11110'],
  'T': ['11111','00100','00100','00100','00100','00100','00100'],
  'U': ['10001','10001','10001','10001','10001','10001','01110'],
  'V': ['10001','10001','10001','10001','10001','01010','00100'],
  'W': ['10001','10001','10001','10101','10101','10101','01010'],
  'X': ['10001','10001','01010','00100','01010','10001','10001'],
  'Y': ['10001','10001','01010','00100','00100','00100','00100'],
  'Z': ['11111','00001','00010','00100','01000','10000','11111'],
};

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function color(hex) {
  const normalized = hex.replace('#', '');
  return [0, 2, 4].map(offset => Number.parseInt(normalized.slice(offset, offset + 2), 16));
}

export class SimplePngCanvas {
  constructor(width, height, background = '#0b1020') {
    this.width = width;
    this.height = height;
    this.pixels = Buffer.alloc(width * height * 4);
    this.fillRect(0, 0, width, height, background);
  }

  setPixel(x, y, hex, alpha = 255) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const [r, g, b] = color(hex);
    const index = (Math.floor(y) * this.width + Math.floor(x)) * 4;
    this.pixels[index] = r;
    this.pixels[index + 1] = g;
    this.pixels[index + 2] = b;
    this.pixels[index + 3] = alpha;
  }

  fillRect(x, y, width, height, hex) {
    for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(this.height, Math.ceil(y + height)); yy++) {
      for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(this.width, Math.ceil(x + width)); xx++) this.setPixel(xx, yy, hex);
    }
  }

  strokeRect(x, y, width, height, hex, thickness = 1) {
    this.fillRect(x, y, width, thickness, hex);
    this.fillRect(x, y + height - thickness, width, thickness, hex);
    this.fillRect(x, y, thickness, height, hex);
    this.fillRect(x + width - thickness, y, thickness, height, hex);
  }

  drawText(text, x, y, hex = '#ffffff', scale = 2) {
    const upper = String(text).toUpperCase();
    let cursor = x;
    for (const char of upper) {
      const glyph = FONT[char] ?? FONT[' '];
      for (let gy = 0; gy < glyph.length; gy++) {
        for (let gx = 0; gx < glyph[gy].length; gx++) {
          if (glyph[gy][gx] !== '1') continue;
          this.fillRect(cursor + gx * scale, y + gy * scale, scale, scale, hex);
        }
      }
      cursor += 6 * scale;
    }
  }

  drawBar(x, y, width, height, ratio, bg, fg) {
    this.fillRect(x, y, width, height, bg);
    this.fillRect(x, y, Math.max(0, Math.min(width, width * ratio)), height, fg);
  }

  write(filePath) {
    const raw = Buffer.alloc((this.width * 4 + 1) * this.height);
    for (let y = 0; y < this.height; y++) {
      raw[y * (this.width * 4 + 1)] = 0;
      this.pixels.copy(raw, y * (this.width * 4 + 1) + 1, y * this.width * 4, (y + 1) * this.width * 4);
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(this.width, 0);
    header.writeUInt32BE(this.height, 4);
    header[8] = 8;
    header[9] = 6;
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND'),
    ]);
    writeFileSync(filePath, png);
  }
}
