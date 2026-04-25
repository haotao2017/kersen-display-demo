import { Injectable, NotFoundException } from '@nestjs/common';
import { deflateSync, gzipSync } from 'node:zlib';
import { Label } from '../../shared/models';

const WIDTH = 296;
const HEIGHT = 128;

const FONT: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '.': ['0', '0', '0', '0', '1'],
  '-': ['0', '0', '1', '0', '0'],
  ' ': ['0', '0', '0', '0', '0'],
  A: ['111', '101', '111', '101', '101'],
  B: ['110', '101', '110', '101', '110'],
  C: ['111', '100', '100', '100', '111'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'],
  F: ['111', '100', '110', '100', '100'],
  G: ['111', '100', '101', '101', '111'],
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  J: ['111', '001', '001', '101', '111'],
  K: ['101', '101', '110', '101', '101'],
  L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'],
  N: ['101', '111', '111', '111', '101'],
  O: ['111', '101', '101', '101', '111'],
  P: ['111', '101', '111', '100', '100'],
  Q: ['111', '101', '101', '111', '001'],
  R: ['111', '101', '111', '110', '101'],
  S: ['111', '100', '111', '001', '111'],
  T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'],
  V: ['101', '101', '101', '101', '010'],
  W: ['101', '101', '111', '111', '101'],
  X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'],
  Z: ['111', '001', '010', '100', '111'],
};

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatPrice(label: Label) {
  return `${label.currency} ${label.price.toFixed(2)}`;
}

function setPixel(buffer: Uint8Array, x: number, y: number, black = true) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT || !black) {
    return;
  }
  const rowBytes = Math.ceil(WIDTH / 8);
  const byteIndex = y * rowBytes + Math.floor(x / 8);
  const bitIndex = 7 - (x % 8);
  buffer[byteIndex] |= 1 << bitIndex;
}

function drawRect(buffer: Uint8Array, x: number, y: number, width: number, height: number, black = true) {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) {
      setPixel(buffer, xx, yy, black);
    }
  }
}

function drawChar(buffer: Uint8Array, char: string, x: number, y: number, scale: number) {
  const glyph = FONT[char.toUpperCase()] ?? FONT['-'];
  glyph.forEach((row, rowIndex) => {
    [...row].forEach((pixel, colIndex) => {
      if (pixel === '1') {
        drawRect(buffer, x + colIndex * scale, y + rowIndex * scale, scale, scale);
      }
    });
  });
  return (glyph[0]?.length ?? 3) * scale + scale;
}

function drawText(buffer: Uint8Array, text: string, x: number, y: number, scale: number, maxWidth: number) {
  let cursor = x;
  for (const char of text.toUpperCase()) {
    const nextWidth = ((FONT[char]?.[0]?.length ?? 3) + 1) * scale;
    if (cursor + nextWidth > x + maxWidth) {
      break;
    }
    cursor += drawChar(buffer, char, cursor, y, scale);
  }
}

function isBlackPixel(bitmap: Uint8Array, x: number, y: number) {
  const rowBytes = Math.ceil(WIDTH / 8);
  const byteIndex = y * rowBytes + Math.floor(x / 8);
  const bitIndex = 7 - (x % 8);
  return (bitmap[byteIndex] & (1 << bitIndex)) !== 0;
}

function bitmapToBgra(bitmap: Uint8Array) {
  const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
  let offset = 0;
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const color = isBlackPixel(bitmap, x, y) ? 0 : 255;
      bytes[offset] = color;
      bytes[offset + 1] = color;
      bytes[offset + 2] = color;
      bytes[offset + 3] = 255;
      offset += 4;
    }
  }
  return bytes;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function bitmapToPng(bitmap: Uint8Array) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const raw = Buffer.alloc((WIDTH * 4 + 1) * HEIGHT);
  let offset = 0;
  for (let y = 0; y < HEIGHT; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < WIDTH; x += 1) {
      const color = isBlackPixel(bitmap, x, y) ? 0 : 255;
      raw[offset] = color;
      raw[offset + 1] = color;
      raw[offset + 2] = color;
      raw[offset + 3] = 255;
      offset += 4;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeBarcode(labelId: string) {
  return [...labelId].map((char, index) => {
    const code = char.charCodeAt(0) + index;
    return {
      width: code % 3 === 0 ? 3 : code % 2 === 0 ? 2 : 1,
      gap: code % 4 === 0 ? 2 : 1,
    };
  });
}

@Injectable()
export class LabelRendererService {
  render(label?: Label) {
    if (!label) {
      throw new NotFoundException('Label not found');
    }

    const title = label.title || label.sku || label.id;
    const price = formatPrice(label);
    const svg = this.renderSvg(label, title, price);
    const bitmap = this.renderBitmap(label, title, price);
    const bitmapBytes = Buffer.from(bitmap.bitmap_b64, 'base64');
    const png = bitmapToPng(bitmapBytes);
    const bgra = bitmapToBgra(bitmapBytes);
    const bgraGzip = gzipSync(bgra);

    return {
      labelId: label.id,
      width: WIDTH,
      height: HEIGHT,
      colors: ['white', 'black'],
      preview: {
        mime: 'image/svg+xml',
        svg,
        svg_b64: Buffer.from(svg).toString('base64'),
        dataUri: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
      },
      bitmap,
      png: {
        mime: 'image/png',
        format: 'png',
        width: WIDTH,
        height: HEIGHT,
        bytes: png.length,
        png_b64: png.toString('base64'),
        dataUri: `data:image/png;base64,${png.toString('base64')}`,
      },
      bgra: {
        format: 'bgra',
        width: WIDTH,
        height: HEIGHT,
        bytes: bgra.length,
        bgra_b64: Buffer.from(bgra).toString('base64'),
      },
      bgraGzip: {
        format: 'bgra-gzip',
        width: WIDTH,
        height: HEIGHT,
        bytes: bgraGzip.length,
        bgra_gzip_b64: bgraGzip.toString('base64'),
      },
    };
  }

  private renderSvg(label: Label, title: string, price: string) {
    const bars = makeBarcode(label.id);
    let x = 18;
    const barRects = bars.map((bar) => {
      const rect = `<rect x="${x}" y="98" width="${bar.width}" height="18" fill="#172026" />`;
      x += bar.width + bar.gap;
      return rect;
    }).join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="100%" height="100%" fill="#fff"/>
  <rect x="4" y="4" width="${WIDTH - 8}" height="${HEIGHT - 8}" fill="none" stroke="#172026" stroke-width="2"/>
  <text x="18" y="30" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#172026">${escapeXml(title.slice(0, 24))}</text>
  <text x="18" y="72" font-family="Arial, sans-serif" font-size="34" font-weight="800" fill="#172026">${escapeXml(price)}</text>
  <text x="18" y="91" font-family="Arial, sans-serif" font-size="11" fill="#172026">ID ${escapeXml(label.id)}</text>
  ${barRects}
  <text x="190" y="113" font-family="Arial, sans-serif" font-size="11" fill="#172026">${escapeXml(label.sku ?? label.id)}</text>
</svg>`;
  }

  private renderBitmap(label: Label, title: string, price: string) {
    const rowBytes = Math.ceil(WIDTH / 8);
    const bytes = new Uint8Array(rowBytes * HEIGHT);

    drawRect(bytes, 0, 0, WIDTH, 2);
    drawRect(bytes, 0, HEIGHT - 2, WIDTH, 2);
    drawRect(bytes, 0, 0, 2, HEIGHT);
    drawRect(bytes, WIDTH - 2, 0, 2, HEIGHT);
    drawText(bytes, title, 14, 18, 3, WIDTH - 28);
    drawText(bytes, price, 14, 58, 5, WIDTH - 28);
    drawText(bytes, `ID ${label.id}`, 14, 102, 2, 170);

    let x = 210;
    for (const bar of makeBarcode(label.id)) {
      drawRect(bytes, x, 98, bar.width, 20);
      x += bar.width + bar.gap;
      if (x > WIDTH - 12) {
        break;
      }
    }

    return {
      format: '1bpp_msb',
      blackBit: 1,
      width: WIDTH,
      height: HEIGHT,
      rowBytes,
      bytes: bytes.length,
      bitmap_b64: Buffer.from(bytes).toString('base64'),
    };
  }
}
