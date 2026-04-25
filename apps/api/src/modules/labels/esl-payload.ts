function concatBytes(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function encodeUtf8(value: string) {
  return new TextEncoder().encode(value);
}

function encodeUint(value: number) {
  if (value < 0) {
    throw new Error(`Expected unsigned integer, got ${value}`);
  }
  if (value <= 0x7f) return Uint8Array.of(value);
  if (value <= 0xff) return Uint8Array.of(0xcc, value);
  if (value <= 0xffff) return Uint8Array.of(0xcd, (value >> 8) & 0xff, value & 0xff);
  if (value <= 0xffffffff) {
    return Uint8Array.of(
      0xce,
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    );
  }
  throw new Error(`Integer too large for MessagePack encoder: ${value}`);
}

function encodeString(value: string) {
  const bytes = encodeUtf8(value);
  const size = bytes.length;
  if (size <= 31) return concatBytes([Uint8Array.of(0xa0 | size), bytes]);
  if (size <= 0xff) return concatBytes([Uint8Array.of(0xd9, size), bytes]);
  if (size <= 0xffff) return concatBytes([Uint8Array.of(0xda, (size >> 8) & 0xff, size & 0xff), bytes]);
  return concatBytes([
    Uint8Array.of(0xdb, (size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff),
    bytes,
  ]);
}

function encodeBinary(value: Uint8Array) {
  const size = value.length;
  if (size <= 0xff) return concatBytes([Uint8Array.of(0xc4, size), value]);
  if (size <= 0xffff) return concatBytes([Uint8Array.of(0xc5, (size >> 8) & 0xff, size & 0xff), value]);
  return concatBytes([
    Uint8Array.of(0xc6, (size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff),
    value,
  ]);
}

type MsgPackValue = boolean | number | string | Uint8Array | MsgPackValue[];

function encodeArray(values: MsgPackValue[]) {
  const encoded = values.map(encodeMsgPack);
  const size = values.length;
  if (size <= 15) return concatBytes([Uint8Array.of(0x90 | size), ...encoded]);
  if (size <= 0xffff) return concatBytes([Uint8Array.of(0xdc, (size >> 8) & 0xff, size & 0xff), ...encoded]);
  return concatBytes([
    Uint8Array.of(0xdd, (size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff),
    ...encoded,
  ]);
}

function encodeMsgPack(value: MsgPackValue): Uint8Array {
  if (typeof value === 'boolean') return Uint8Array.of(value ? 0xc3 : 0xc2);
  if (typeof value === 'number') return encodeUint(value);
  if (typeof value === 'string') return encodeString(value);
  if (value instanceof Uint8Array) return encodeBinary(value);
  return encodeArray(value);
}

export function buildTaskEsl2Payload({
  tagIds,
  pattern,
  pageIndex,
  imageBytes,
  compress,
  oldKey = '',
  newKey = '',
  ledRed = false,
  ledGreen = false,
  ledBlue = false,
  ledTimes = 0,
  tokenSeed = Date.now(),
}: {
  tagIds: string[];
  pattern: number;
  pageIndex: number;
  imageBytes: Uint8Array;
  compress: boolean;
  oldKey?: string;
  newKey?: string;
  ledRed?: boolean;
  ledGreen?: boolean;
  ledBlue?: boolean;
  ledTimes?: number;
  tokenSeed?: number;
}) {
  const normalizedTags = tagIds.map((tagId) => tagId.trim()).filter(Boolean);
  const tagTokens = Object.fromEntries(normalizedTags.map((tagId, index) => [tagId, (tokenSeed + index) & 0xffff]));
  const entities: MsgPackValue[] = normalizedTags.map((tagId, index) => [
    tagId,
    pattern,
    pageIndex,
    ledRed,
    ledGreen,
    ledBlue,
    ledTimes,
    (tokenSeed + index) & 0xffff,
    oldKey,
    newKey,
    imageBytes,
    compress,
  ]);
  const payloadBytes = encodeMsgPack(entities);
  return {
    entityCount: normalizedTags.length,
    payloadBytes,
    payloadBase64: Buffer.from(payloadBytes).toString('base64'),
    tagIds: normalizedTags,
    tagTokens,
  };
}
