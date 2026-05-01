import React from 'react';
import ReactDOM from 'react-dom/client';
import { Activity, BadgeDollarSign, ClipboardList, RadioTower, RefreshCcw, Send, Server, ShieldCheck, Store } from 'lucide-react';
import { api, getToken, setToken } from './lib/api';
import './styles.css';

type StoreConfig = {
  code: string;
  name: string;
  serverUrl: string;
  mqttTcpPort: number;
  mqttWsPath: string;
};

type BaseStation = {
  id: string;
  storeCode: string;
  name: string;
  mac?: string;
  ip?: string;
  firmware?: string;
  os?: string;
  hostAddr?: string;
  channels?: Array<Record<string, unknown>>;
  status: 'offline' | 'online' | 'warning';
  lastSeenAt?: string;
  metrics?: {
    rssi?: number;
    labelsOnline?: number;
    labelsTotal?: number;
  };
};

type Label = {
  id: string;
  storeCode: string;
  apId?: string;
  sku?: string;
  title: string;
  price: number;
  currency: string;
  status: string;
  battery?: number;
  rssi?: number;
  updatedAt: string;
};

type DeviceLog = {
  id: string;
  time: string;
  method: string;
  path: string;
  statusCode?: number;
  ip?: string;
  userAgent?: string;
  body?: unknown;
};

type WsStatus = {
  apId: string;
  connected: boolean;
  connectedAt?: string;
  lastMessageAt?: string;
  remoteAddress?: string;
};

type DownlinkTrace = {
  id: string;
  apId: string;
  transport: string;
  status: string;
  bytes?: number;
  commandType?: string;
  labelId?: string;
  queueId?: number;
  topic?: string;
  error?: string;
  reply?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type ReplayTraceInsight = {
  trackingId?: string;
  status?: string;
  commandType?: string;
  labelId?: string;
  queueId?: number;
  apReplyType?: string;
  ackPktNum?: number;
  sendPktNum?: number;
  errno?: number;
  writeTimeMs?: number;
  rwTaskRest?: number;
  masterAvgRxRssi?: number;
  slaveAvgRxRssi?: number;
  executionObserved?: boolean;
  executionSuccess?: boolean;
  executionReason?: string;
  summary: string;
  raw?: DownlinkTrace | Record<string, unknown> | null;
};

type MqttStats = {
  mode: 'embedded' | 'external';
  external: {
    host?: string;
    port: number;
    connected: boolean;
    clientId: string;
  };
};

type LabelCommandResult = {
  id: string;
  status: string;
  transport?: 'websocket' | 'mqtt' | 'taskESL2' | 'ESL_WRITE';
  delivery?: {
    ok?: boolean;
    reason?: string;
    bytes?: number;
    execution?: string;
    mqtt?: Array<{ topic: string; type?: string; ok: boolean; reason?: string }>;
    websocketBinary?: {
      ok?: boolean;
      reason?: string;
      bytes?: number;
    };
    websocketJson?: {
      ok?: boolean;
      reason?: string;
      bytes?: number;
    };
    websocketPsm?: {
      ok?: boolean;
      reason?: string;
      bytes?: number;
    };
  };
  protocol?: {
    topic: string;
    psmTopic?: string;
    alternateTopics?: string[];
    payloadBytes: number;
    imageBytes: number;
    queueId?: number;
    sourceChars?: number;
    tagTokens?: Record<string, number>;
  };
  mqtt?: {
    ok?: boolean;
    reason?: string;
  };
  execution?: {
    confirmed: boolean;
    reason: string;
  };
};

type LabelRender = {
  labelId: string;
  width: number;
  height: number;
  colors: string[];
  preview: {
    dataUri: string;
  };
  bitmap: {
    format: string;
    bytes: number;
    bitmap_b64: string;
  };
};

type DocumentCommandResult = {
  ok: boolean;
  reason?: string;
  commandType?: string;
  delivery?: {
    mqtt?: Array<{ topic: string; type?: string; ok: boolean; reason?: string }>;
    websocketPsm?: { ok?: boolean; reason?: string; bytes?: number };
    websocket?: { ok?: boolean; reason?: string; bytes?: number; text?: string; text_chars?: number };
  };
  protocol?: {
    topic: string;
    alternateTopics?: string[];
    imageFormat?: string;
    payloadBytes: number;
    imageBytes?: number;
    queueId?: number;
    tagTokens?: Record<string, number>;
  };
  command?: Record<string, unknown>;
  subscribe?: string[];
};

type OfficialApiResult = {
  ok: boolean;
  status: number;
  url: string;
  request?: Record<string, unknown>;
  response?: unknown;
  error?: string;
};

type LocalImageTestResult = {
  ok: boolean;
  autoBest?: boolean;
  dryRun?: boolean;
  mode?: string;
  sendMode?: string;
  fitMode?: string;
  dither?: boolean;
  resample?: string;
  generatedService03Bytes?: number;
  generatedService03Sha256?: string;
  autoSelection?: {
    score?: number;
    fitMode?: string;
    resample?: string;
    dither?: boolean;
  };
  replay?: {
    ok?: boolean;
    trackingId?: string;
    reason?: string;
    message?: string;
  };
  reason?: string;
  message?: string;
  [key: string]: unknown;
};

type OfficialDownlinkCapture = {
  id: string;
  apId: string;
  storeCode?: string;
  targetUrl: string;
  createdAt: string;
  kind: 'text' | 'binary';
  bytes: number;
  replayable: boolean;
  text?: string;
  textPreview?: string;
  base64?: string;
  hexPrefix?: string;
  commandType?: string;
  labelId?: string;
  queueId?: number;
  fingerprint: string;
  summary: Record<string, unknown>;
};

type OfficialDownlinkAnalysis = {
  ok: boolean;
  apId: string;
  count: number;
  uniqueService03: number;
  groups: Array<{
    sha256: string;
    count: number;
    service03Bytes: number;
    firstSeenAt: string;
    lastSeenAt: string;
    captureIds: string[];
    headHex?: string;
    tailHex?: string;
  }>;
  rows: Array<Record<string, unknown>>;
  note?: string;
};

type OfficialDownlinkDiff = {
  ok: boolean;
  reason?: string;
  left?: Record<string, unknown>;
  right?: Record<string, unknown>;
  sameCapture?: boolean;
  sameFingerprint?: boolean;
  services?: Array<{
    key: string;
    service?: string;
    left: Record<string, unknown> | null;
    right: Record<string, unknown> | null;
    diff: {
      leftBytes: number;
      rightBytes: number;
      equalBytes: number;
      changedBytes: number;
      firstDiff?: number;
      changedRatio: number;
      ranges: Array<{
        start: number;
        end: number;
        length: number;
        leftHex: string;
        rightHex: string;
        leftAscii: string;
        rightAscii: string;
      }>;
    };
  }>;
};

type TemplateBatchResult = {
  templateId: number;
  productCode: string;
  productName: string;
  price: number;
  fieldOverrides?: Record<string, string>;
  api?: OfficialApiResult;
  capture?: {
    id: string;
    createdAt: string;
    bytes: number;
    fingerprint: string;
    labelId?: string;
    service03Bytes?: number;
    service07Bytes?: number;
  };
  status: 'pending' | 'captured' | 'timeout' | 'api_failed' | 'api_failed_captured';
  message: string;
};

type VariableBatchResult = {
  variant: string;
  templateId: number;
  productCode: string;
  productName: string;
  price: number;
  fieldOverrides?: Record<string, string>;
  api?: OfficialApiResult;
  capture?: TemplateBatchResult['capture'];
  status: TemplateBatchResult['status'];
  message: string;
};

type OfficialBindPipelineResult = {
  variant?: string;
  startedAt: string;
  apId: string;
  eslCode: string;
  templateId: number;
  product: Record<string, unknown>;
  steps: Array<{
    name: string;
    ok: boolean;
    status: number;
    request?: Record<string, unknown>;
    response?: unknown;
    error?: string;
  }>;
  capture?: TemplateBatchResult['capture'];
  message: string;
};

type OfficialDiagnosisResult = {
  startedAt: string;
  eslCode: string;
  productCode: string;
  templateId: number;
  checks: Array<{
    name: string;
    ok: boolean;
    status: number;
    request?: Record<string, unknown>;
    response?: unknown;
    error?: string;
  }>;
  findings: string[];
};

type OfficialAutoTemplateSamplesResult = {
  startedAt: string;
  apId: string;
  eslCode: string;
  templateId: number;
  fieldName: string;
  values: string[];
  results: Array<Record<string, unknown>>;
};

type Service03Sample = {
  id: string;
  capturedAt: string;
  captureId: string;
  labelId?: string;
  templateId?: number;
  textNote: string;
  service03Bytes?: number;
  fingerprint?: string;
};

type Service03SampleSummary = Service03Sample & {
  noteKey: string;
  noteValue: string;
  duplicateCapture: boolean;
  duplicateFingerprint: boolean;
  deltaFromPrevious?: number;
};

type GeneratedCandidateInfo = {
  imageName: string;
  width: number;
  height: number;
  pixelMode: string;
  compression: string;
  envelope: string;
  sourceBytes: number;
  encodedBytes: number;
  service03Bytes: number;
  service03B64Chars: number;
};

type CandidateExperimentStatus = {
  phase: 'idle' | 'generating' | 'generated' | 'replaying' | 'success' | 'error';
  title: string;
  detail?: string;
};

type CandidateSweepResult = {
  index: number;
  total: number;
  pixelMode: string;
  compression: string;
  envelope: string;
  service03Bytes: number;
  ok: boolean;
  detail: string;
  at: string;
};

type OfficialMutationResult = {
  index: number;
  total: number;
  mode: 'byte_xor' | 'splice';
  label: string;
  ok: boolean;
  detail: string;
  at: string;
};

type Service03Insights = {
  summaries: Service03SampleSummary[];
  duplicateCaptureIds: string[];
  duplicateFingerprints: string[];
  lengthBuckets: Array<{
    bytes: number;
    count: number;
      notes: string[];
    }>;
  fingerprintBuckets: Array<{
    fingerprint: string;
    count: number;
    notes: string[];
    captureIds: string[];
  }>;
  noteGroups: Array<{
    group: string;
    count: number;
    bytesMin?: number;
    bytesMax?: number;
    headHexPrefixes: string[];
    notes: string[];
    captureIds: string[];
  }>;
};

function normalizeSampleNote(note: string) {
  return note.trim().replace(/\s+/g, ' ');
}

function extractSampleNoteValue(note: string) {
  const normalized = normalizeSampleNote(note);
  const separatorIndex = normalized.indexOf('=');
  if (separatorIndex < 0) {
    return normalized;
  }
  return normalized.slice(separatorIndex + 1).trim();
}

function classifySampleNote(note: string) {
  const normalized = normalizeSampleNote(note);
  const tags: string[] = [];
  if (/左上/.test(normalized)) {
    tags.push('position:left-top');
  } else if (/右下/.test(normalized)) {
    tags.push('position:right-bottom');
  } else if (/换位置/.test(normalized)) {
    tags.push('position:moved');
  } else {
    tags.push('position:default');
  }

  const fontMatch = normalized.match(/字体\s*([0-9]+)/);
  if (fontMatch) {
    tags.push(`font:${fontMatch[1]}`);
  } else {
    tags.push('font:default');
  }

  const value = extractSampleNoteValue(normalized);
  if (value && value !== '(empty)') {
    tags.push(`value:${value}`);
  }
  return tags.join(' | ');
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

function normalizeImageToLabelImageData(dataUrl: string, width = 296, height = 128) {
  return new Promise<{ pngDataUrl: string; rgbaB64: string; width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('浏览器无法创建图片画布'));
        return;
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      const scale = Math.min(width / img.width, height / img.height);
      const drawWidth = Math.max(1, Math.round(img.width * scale));
      const drawHeight = Math.max(1, Math.round(img.height * scale));
      const x = Math.floor((width - drawWidth) / 2);
      const y = Math.floor((height - drawHeight) / 2);
      ctx.drawImage(img, x, y, drawWidth, drawHeight);
      const imageData = ctx.getImageData(0, 0, width, height);
      let binary = '';
      for (let index = 0; index < imageData.data.length; index += 1) {
        binary += String.fromCharCode(imageData.data[index]);
      }
      resolve({
        pngDataUrl: canvas.toDataURL('image/png'),
        rgbaB64: btoa(binary),
        width,
        height,
      });
    };
    img.onerror = () => reject(new Error('图片解码失败，请换 PNG/JPG 文件重试'));
    img.src = dataUrl;
  });
}

function renderImageToCanvasPixels(dataUrl: string, width = 296, height = 128) {
  return new Promise<{ pngDataUrl: string; rgba: Uint8ClampedArray; width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('浏览器无法创建图片画布'));
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      const scale = Math.min(width / img.width, height / img.height);
      const drawWidth = Math.max(1, Math.round(img.width * scale));
      const drawHeight = Math.max(1, Math.round(img.height * scale));
      const x = Math.floor((width - drawWidth) / 2);
      const y = Math.floor((height - drawHeight) / 2);
      ctx.drawImage(img, x, y, drawWidth, drawHeight);
      const imageData = ctx.getImageData(0, 0, width, height);
      resolve({
        pngDataUrl: canvas.toDataURL('image/png'),
        rgba: imageData.data,
        width,
        height,
      });
    };
    img.onerror = () => reject(new Error('图片解码失败，请换 PNG/JPG 文件重试'));
    img.src = dataUrl;
  });
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(text: string) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function compressBytes(bytes: Uint8Array, format: 'gzip' | 'deflate') {
  if (typeof CompressionStream === 'undefined') {
    throw new Error(`当前浏览器不支持 ${format} CompressionStream`);
  }
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const stream = new Blob([arrayBuffer]).stream().pipeThrough(new CompressionStream(format));
  const response = new Response(stream);
  return new Uint8Array(await response.arrayBuffer());
}

function rgbaToGray8(rgba: Uint8ClampedArray) {
  const output = new Uint8Array(rgba.length / 4);
  for (let index = 0, target = 0; index < rgba.length; index += 4, target += 1) {
    const r = rgba[index];
    const g = rgba[index + 1];
    const b = rgba[index + 2];
    output[target] = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
  }
  return output;
}

function packBits(bits: Uint8Array) {
  const output = new Uint8Array(Math.ceil(bits.length / 8));
  for (let index = 0; index < bits.length; index += 1) {
    if (bits[index]) {
      output[Math.floor(index / 8)] |= 1 << (7 - (index % 8));
    }
  }
  return output;
}

function looksLikeDemoEslCode(value: string) {
  return /^label-demo[-_]/i.test(value.trim());
}

function rgbaToBw1bpp(rgba: Uint8ClampedArray, inverted = false) {
  const bits = new Uint8Array(rgba.length / 4);
  for (let index = 0, target = 0; index < rgba.length; index += 4, target += 1) {
    const r = rgba[index];
    const g = rgba[index + 1];
    const b = rgba[index + 2];
    const gray = r * 0.299 + g * 0.587 + b * 0.114;
    const isBlack = gray < 180 ? 1 : 0;
    bits[target] = inverted ? (isBlack ? 0 : 1) : isBlack;
  }
  return packBits(bits);
}

function rgbaToBwr2Plane(rgba: Uint8ClampedArray) {
  const pixels = rgba.length / 4;
  const blackBits = new Uint8Array(pixels);
  const redBits = new Uint8Array(pixels);
  for (let index = 0, target = 0; index < rgba.length; index += 4, target += 1) {
    const r = rgba[index];
    const g = rgba[index + 1];
    const b = rgba[index + 2];
    const gray = r * 0.299 + g * 0.587 + b * 0.114;
    const isRed = r > 150 && g < 120 && b < 120;
    const isBlack = !isRed && gray < 170;
    blackBits[target] = isBlack ? 1 : 0;
    redBits[target] = isRed ? 1 : 0;
  }
  const blackPlane = packBits(blackBits);
  const redPlane = packBits(redBits);
  const output = new Uint8Array(blackPlane.length + redPlane.length);
  output.set(blackPlane, 0);
  output.set(redPlane, blackPlane.length);
  return output;
}

function buildEnvelopeBytes(payload: Uint8Array, baseline: Uint8Array, mode: string) {
  if (mode === 'payload_only') {
    return payload;
  }
  const [headerLenText, tailLenText] = mode.replace('splice_', '').split('_');
  const headerLen = Number(headerLenText);
  const tailLen = Number(tailLenText);
  if (!Number.isFinite(headerLen) || !Number.isFinite(tailLen) || baseline.length <= headerLen + tailLen) {
    return payload;
  }
  const header = baseline.subarray(0, headerLen);
  const tail = baseline.subarray(baseline.length - tailLen);
  const bodyLen = baseline.length - headerLen - tailLen;
  const body = new Uint8Array(bodyLen);
  body.set(payload.subarray(0, bodyLen));
  const output = new Uint8Array(header.length + body.length + tail.length);
  output.set(header, 0);
  output.set(body, header.length);
  output.set(tail, header.length + body.length);
  return output;
}

const commandTypes = [
  { value: 'task_esl2', label: '价签刷图 taskESL2 二进制' },
  { value: 'image', label: '价签刷图 ESL_WRITE.img' },
  { value: 'image_led', label: '刷图并闪灯 ESL_WRITE.img+led' },
  { value: 'white', label: '刷白屏/解绑 ESL_WRITE.img空图' },
  { value: 'led', label: '闪灯 ESL_WRITE.led' },
  { value: 'stop_led', label: '停止闪灯 ESL_WRITE.led' },
  { value: 'ndef', label: '写入 NDEF ESL_WRITE.ndef' },
  { value: 'ota', label: '价签 OTA ESL_OTA' },
  { value: 'group_change', label: '价签换组 ESL_GROUP_CHANGE' },
  { value: 'refresh', label: '价签刷新数据 refresh_data' },
  { value: 'ap_svc_cfg', label: '基站服务配置 AP_SVC_CFG' },
  { value: 'ap_psm', label: '基站 PSM AP_PSM' },
  { value: 'ap_restart', label: '基站程序重启 AP_RESTART' },
  { value: 'ap_reboot', label: '基站系统重启 AP_REBOOT' },
  { value: 'ap_channels', label: '获取基站通道 AP_CHANNELS' },
  { value: 'ap_ota', label: '基站 OTA AP_OTA' },
  { value: 'raw', label: '原始 JSON' },
];

const IMAGE_TEST_TAG_ACTIONS = [
  { value: 'led', label: '闪灯' },
  { value: 'stop_led', label: '停止闪灯' },
  { value: 'refresh', label: '刷新数据' },
  { value: 'white', label: '刷白屏' },
  { value: 'image_led', label: '刷图并闪灯（上方图片）' },
  { value: 'ndef', label: '写 NDEF' },
  { value: 'ota', label: '价签 OTA' },
  { value: 'group_change', label: '换组' },
] as const;

const IMAGE_TEST_AP_ACTIONS = [
  { value: 'ap_svc_cfg', label: '服务配置' },
  { value: 'ap_psm', label: 'PSM/休眠' },
  { value: 'ap_restart', label: '程序重启' },
  { value: 'ap_reboot', label: '系统重启' },
  { value: 'ap_channels', label: '获取通道' },
  { value: 'ap_ota', label: '基站 OTA' },
] as const;

const DEFAULT_IMAGE_TEST_AP_ID = 'e4:38:19:2a:09:de';
const TAG_SIZE_LABELS: Record<string, string> = {
  '17900170': '0C 800x480',
  '176002f7': '03-04 400x300',
  '1770008e': '03-0A 648x480',
  '17500175': '03-04 240x416',
  '174004d2': '03-03 184x384',
  '173014d6': '03-02 128x296',
  '17200227': '03-02 152x296',
  '15403fca': '03/03-02 128x250',
  '1710408c': '03-01 128x250',
  '1700009f': '03-02 200x200',
};

function labelOptionText(label: Label) {
  const size = TAG_SIZE_LABELS[label.id.toLowerCase()];
  return `${label.id} · ${label.title}${size ? ` · ${size}` : ''}`;
}

const LABEL_SIZE_OPTIONS = [
  { value: '2.13', label: '2.13 英寸（250x122）' },
  { value: '128x250', label: '1.54/2.13 竖屏（128x250，15403FCA/1710408C）' },
  { value: '200x200', label: '1.54 英寸方屏（200x200，1700009F）' },
  { value: '240x416', label: '3.7 竖屏（240x416，17500175）' },
  { value: '256x250', label: '1710408C 误解读候选（256x250）' },
  { value: '184x384', label: '174004d2 竖屏（184x384）' },
  { value: '128x296', label: '2.90 竖屏（128x296，173014D6）' },
  { value: '152x296', label: '2.90/2.66 竖屏（152x296，17200227）' },
  { value: '648x480', label: '5.83 英寸（648x480，1770008E）' },
  { value: '680x480', label: '5.83 候选（680x480，1770008E 易乱码）' },
  { value: '1.54', label: '1.54 英寸（200x200）' },
  { value: '2.90', label: '2.90 英寸（296x128）' },
  { value: '4.2', label: '4.2 英寸（400x300）' },
  { value: '5.83', label: '5.83 英寸（648x480）' },
  { value: '3.7', label: '3.7 英寸（416x240）' },
  { value: '7.5', label: '7.5 英寸（800x480）' },
  { value: '2.6', label: '2.6 英寸（360x184）' },
  { value: '10.2', label: '10.2 英寸（960x640）' },
] as const;

const IMAGE_CANVAS_OPTIONS = [
  { value: '0c:800x480', label: '17900170 0C 800x480（官方匹配）' },
  { value: '03-04:400x300#b0y2r3w1', label: '176002f7 03-04 400x300（实测修正）' },
  { value: '03-0a:648x480#b0y2r3w1', label: '1770008E 03-0A 648x480（实测修正，680x480 会乱码）' },
  { value: '03-04:240x416#b0y2r3w1', label: '17500175 03-04 240x416（实测色码 + 旋转 + 镜像）' },
  { value: '03-03:184x384#b0y2r3w1', label: '174004d2 03-03 184x384（实测 + 旋转）' },
  { value: '03-02:128x296#b0y2r3w1', label: '173014D6 03-02 128x296（实测 + 水平镜像 + 旋转）' },
  { value: '03-02:152x296#b0y2r3w1', label: '17200227 03-02 152x296（实测 + 水平镜像 + 旋转）' },
  { value: '03:128x250', label: '15403FCA 03 128x250（原始黑白 1bpp + 旋转）' },
  { value: '03-01:128x250#b0y2r3w1', label: '1710408C 03-01 128x250（实测 + 旋转）' },
  { value: '03-02:200x200#b0y2r3w1', label: '1700009F 03-02 200x200（实测 + 旋转）' },
] as const;

type ImageRotate = 'none' | 'cw90' | 'ccw90' | '180';
type ImageFlip = 'none' | 'horizontal' | 'vertical' | 'both';

const IMAGE_CANVAS_STRATEGIES: Record<string, { imageRotate: ImageRotate; imageFlip: ImageFlip; note: string }> = {
  '0c:800x480': { imageRotate: 'none', imageFlip: 'none', note: '默认方向' },
  '03-04:400x300#b0y2r3w1': { imageRotate: 'none', imageFlip: 'none', note: '实测色码' },
  '03-0a:648x480#b0y2r3w1': { imageRotate: 'none', imageFlip: 'none', note: '实测色码' },
  '03-04:240x416#b0y2r3w1': { imageRotate: 'cw90', imageFlip: 'horizontal', note: '实测色码 + 顺时针90度 + 水平镜像' },
  '03-03:184x384#b0y2r3w1': { imageRotate: 'cw90', imageFlip: 'none', note: '实测色码 + 顺时针90度' },
  '03-02:128x296#b0y2r3w1': { imageRotate: 'cw90', imageFlip: 'horizontal', note: '实测色码 + 顺时针90度 + 水平镜像' },
  '03-02:152x296#b0y2r3w1': { imageRotate: 'cw90', imageFlip: 'horizontal', note: '实测色码 + 顺时针90度 + 水平镜像' },
  '03:128x250': { imageRotate: 'cw90', imageFlip: 'none', note: '原始黑白 + 顺时针90度' },
  '03-01:128x250#b0y2r3w1': { imageRotate: 'cw90', imageFlip: 'none', note: '实测色码 + 顺时针90度' },
  '03-02:200x200#b0y2r3w1': { imageRotate: 'cw90', imageFlip: 'none', note: '实测色码 + 顺时针90度' },
};

function strategyForCanvasPreset(canvasPreset: string) {
  return IMAGE_CANVAS_STRATEGIES[canvasPreset] ?? { imageRotate: 'none' as ImageRotate, imageFlip: 'none' as ImageFlip, note: '手动策略' };
}

const IMAGE_ROTATE_OPTIONS = [
  { value: 'none', label: '不旋转' },
  { value: 'cw90', label: '顺时针 90°' },
  { value: 'ccw90', label: '逆时针 90°' },
  { value: '180', label: '旋转 180°' },
] as const;

const IMAGE_FLIP_OPTIONS = [
  { value: 'none', label: '不翻转' },
  { value: 'horizontal', label: '水平镜像' },
  { value: 'vertical', label: '垂直镜像' },
  { value: 'both', label: '水平 + 垂直镜像' },
] as const;

function buildCanvasPreset(form: {
  canvasPreset: string;
  customCanvasType: '03' | '03-01' | '03-02' | '03-03' | '03-04' | '03-0a' | '0c';
  customCanvasWidth: string;
  customCanvasHeight: string;
  customCanvasRowBytes: string;
  customCanvasOutputRows: string;
}) {
  if (form.canvasPreset !== 'custom') {
    return form.canvasPreset;
  }
  const width = Math.max(16, Math.trunc(Number(form.customCanvasWidth) || 800));
  const height = Math.max(16, Math.trunc(Number(form.customCanvasHeight) || 480));
  const rowBytes = Math.trunc(Number(form.customCanvasRowBytes) || 0);
  const outputRows = Math.trunc(Number(form.customCanvasOutputRows) || 0);
  const suffix = form.customCanvasType === '03' && rowBytes > 0 && outputRows > 0
    ? `@${rowBytes}x${outputRows}`
    : '';
  return `${form.customCanvasType}:${width}x${height}${suffix}`;
}

function App() {
  const [activeView, setActiveView] = React.useState<'overview' | 'stations' | 'labels' | 'commands' | 'image-test' | 'cloud' | 'logs'>('overview');
  const [tokenReady, setTokenReady] = React.useState(Boolean(getToken()));
  const [storeCode, setStoreCode] = React.useState(localStorage.getItem('storeCode') ?? '20248517');
  const [username, setUsername] = React.useState(localStorage.getItem('username') ?? 'admin');
  const [password, setPassword] = React.useState('admin123456');
  const [store, setStore] = React.useState<StoreConfig | null>(null);
  const [aps, setAps] = React.useState<BaseStation[]>([]);
  const [labels, setLabels] = React.useState<Label[]>([]);
  const [logs, setLogs] = React.useState<DeviceLog[]>([]);
  const [labelRenders, setLabelRenders] = React.useState<Record<string, LabelRender>>({});
  const [wsStatuses, setWsStatuses] = React.useState<Record<string, WsStatus>>({});
  const [downlinkTraces, setDownlinkTraces] = React.useState<DownlinkTrace[]>([]);
  const [mqttStats, setMqttStats] = React.useState<MqttStats | null>(null);
  const [selectedApId, setSelectedApId] = React.useState('');
  const [rawWsCommand, setRawWsCommand] = React.useState('{\n  "type": "DEVICE_RETRIEVE"\n}');
  const [rawCommandStatus, setRawCommandStatus] = React.useState('未发送');
  const [sendingRawCommand, setSendingRawCommand] = React.useState(false);
  const [labelCommandStatus, setLabelCommandStatus] = React.useState<Record<string, string>>({});
  const [sendingLabels, setSendingLabels] = React.useState<Record<string, boolean>>({});
  const [showAllLogs, setShowAllLogs] = React.useState(false);
  const [logsLoadedAt, setLogsLoadedAt] = React.useState<string>('-');
  const [message, setMessage] = React.useState(getToken() ? '已恢复登录状态' : '等待登录');
  const [draftLabel, setDraftLabel] = React.useState({ id: 'label-demo-001', title: 'Demo Product', price: 19.9 });
  const [docCommand, setDocCommand] = React.useState({
    commandType: 'image',
    labelId: '',
    apId: '',
    source: '',
    rgbaB64: '',
    colorMode: 'bwr',
    pattern: 0,
    pageIndex: 0,
    compress: true,
    ledRed: false,
    ledGreen: false,
    ledBlue: false,
    ledTimes: 0,
    sourceName: '',
    mode: 1,
    orientation: 0,
    queue_id: '',
    r: 255,
    g: 0,
    b: 0,
    time_on_ms: 20,
    time_s: 60,
    group: 32,
    b64dat: '',
    url: '',
    md5: '',
    index: 0,
    psmMode: 'fast',
    adv_group: 32,
    duration_ms: 5000,
    act_time_us: 3000,
    slp_cycle_ms: 24000,
    adv_interval_ms: 60000,
    adv_map: 7,
    wait_conn_ch_idx: 10,
    retry_num: 3,
    parallel_num: 3,
    ap_chn_num: 255,
    prePsm: true,
    sendMqtt: true,
    sendWs: true,
    raw: '{\n  "type": "ESL_WRITE",\n  "data": {}\n}',
  });
  const [docResult, setDocResult] = React.useState<DocumentCommandResult | null>(null);
  const [officialDownlinks, setOfficialDownlinks] = React.useState<OfficialDownlinkCapture[]>([]);
  const [selectedCaptureId, setSelectedCaptureId] = React.useState('');
  const [leftDiffCaptureId, setLeftDiffCaptureId] = React.useState('');
  const [rightDiffCaptureId, setRightDiffCaptureId] = React.useState('');
  const [captureDiff, setCaptureDiff] = React.useState<OfficialDownlinkDiff | null>(null);
  const [captureAnalysis, setCaptureAnalysis] = React.useState<OfficialDownlinkAnalysis | null>(null);
  const [replayTargetLabelId, setReplayTargetLabelId] = React.useState('');
  const [replayResult, setReplayResult] = React.useState<unknown>(null);
  const [replayTraceInsight, setReplayTraceInsight] = React.useState<ReplayTraceInsight | null>(null);
  const [candidateService03B64, setCandidateService03B64] = React.useState('');
  const [candidateService07B64, setCandidateService07B64] = React.useState('AGQAZP8sAQ==');
  const [candidatePixelMode, setCandidatePixelMode] = React.useState('bw_1bpp');
  const [candidateCompression, setCandidateCompression] = React.useState('none');
  const [candidateEnvelope, setCandidateEnvelope] = React.useState('splice_5_5540');
  const [generatedCandidate, setGeneratedCandidate] = React.useState<GeneratedCandidateInfo | null>(null);
  const [candidateStatus, setCandidateStatus] = React.useState<CandidateExperimentStatus>({
    phase: 'idle',
    title: '先选中一条官方成功捕获，再上传图片生成候选编码',
  });
  const [candidateSourceImage, setCandidateSourceImage] = React.useState<{ name: string; dataUrl: string } | null>(null);
  const [candidateSweepRunning, setCandidateSweepRunning] = React.useState(false);
  const [candidateSweepResults, setCandidateSweepResults] = React.useState<CandidateSweepResult[]>([]);
  const [officialMutationRunning, setOfficialMutationRunning] = React.useState(false);
  const [officialMutationResults, setOfficialMutationResults] = React.useState<OfficialMutationResult[]>([]);
  const [service03SampleNote, setService03SampleNote] = React.useState('f1=');
  const [service03Samples, setService03Samples] = React.useState<Service03Sample[]>(() => {
    try {
      const raw = localStorage.getItem('service03Samples');
      return raw ? JSON.parse(raw) as Service03Sample[] : [];
    } catch {
      return [];
    }
  });
  const [officialWatch, setOfficialWatch] = React.useState('');
  const [templateBatchIds, setTemplateBatchIds] = React.useState('4678,4513,4510,4512,4518');
  const [templateBatchRunning, setTemplateBatchRunning] = React.useState(false);
  const [templateBatchResults, setTemplateBatchResults] = React.useState<TemplateBatchResult[]>([]);
  const [variableTemplateId, setVariableTemplateId] = React.useState(4513);
  const [variableBatchRunning, setVariableBatchRunning] = React.useState(false);
  const [variableBatchResults, setVariableBatchResults] = React.useState<VariableBatchResult[]>([]);
  const [bindPipelineRunning, setBindPipelineRunning] = React.useState(false);
  const [bindPipelineResult, setBindPipelineResult] = React.useState<OfficialBindPipelineResult | null>(null);
  const [associationResults, setAssociationResults] = React.useState<OfficialBindPipelineResult[]>([]);
  const [officialDiagnosis, setOfficialDiagnosis] = React.useState<OfficialDiagnosisResult | null>(null);
  const [autoTemplateSamplesRunning, setAutoTemplateSamplesRunning] = React.useState(false);
  const [autoTemplateSamplesResult, setAutoTemplateSamplesResult] = React.useState<OfficialAutoTemplateSamplesResult | null>(null);
  const [officialApi, setOfficialApi] = React.useState({
    apiName: 'default',
    resource: 'esl',
    action: 'direct',
    sign: '80805d794841f1b4',
    eslCode: '17900170',
    productCode: 'SKU-001',
    productName: 'Demo Product',
    price: 19.9,
    templateId: 4515,
    led: false,
    customFieldsText: 'f1=F1-DEMO\nf1=F2-DEMO',
  });
  const [officialApiResult, setOfficialApiResult] = React.useState<OfficialApiResult | null>(null);
  const [imageTestForm, setImageTestForm] = React.useState({
    apId: '',
    eslCode: '',
    fourColor: true,
    sendMode: 'direct' as 'direct' | 'replay',
    renderMode: 'service0c_local' as 'full' | 'f2slot' | 'official' | 'service0c_replay' | 'service0c_local',
    fullVariant: 'stacked_rows' as 'single_chunk' | 'stacked_rows' | 'stacked_rows_triple' | 'first_quartet' | 'legacy',
    fullQuartet: '1',
    localImageName: '111111.jpg',
    fastMode: true,
    renderPreset: '2.13',
    canvasPreset: '0c:800x480',
    customCanvasType: '03-0a' as '03' | '03-01' | '03-02' | '03-03' | '03-04' | '03-0a' | '0c',
    customCanvasWidth: '648',
    customCanvasHeight: '480',
    customCanvasRowBytes: '',
    customCanvasOutputRows: '',
    renderScale: '1',
    imageRotate: 'none' as ImageRotate,
    imageFlip: 'none' as ImageFlip,
    imageLed: false,
    ledB64dat: 'AGQAZP8sAQ==',
    dryRun: false,
    topN: 8,
  });
  const [imageTestFile, setImageTestFile] = React.useState<File | null>(null);
  const [imageTestRunning, setImageTestRunning] = React.useState(false);
  const [imageTestStatus, setImageTestStatus] = React.useState('未执行');
  const [imageTestResult, setImageTestResult] = React.useState<LocalImageTestResult | null>(null);
  const [imageActionRunning, setImageActionRunning] = React.useState('');
  const [imageActionStatus, setImageActionStatus] = React.useState('未执行');
  const [imageActionResult, setImageActionResult] = React.useState<DocumentCommandResult | null>(null);

  const commandLogs = React.useMemo(() => {
    const interesting = [
      'POST /api/websocket/auth',
      'WS-UPGRADE',
      'WS ',
      'WS-OUT',
      'WS-SEND-CALLBACK',
      'DOWNLINK-TRACE',
      'AP-QUEUE-STATUS',
      'MQTT',
      'OFFICIAL',
    ];
    return logs
      .filter((log) => interesting.some((item) => `${log.method} ${log.path}`.startsWith(item) || log.method.startsWith(item)))
      .slice(0, 18);
  }, [logs]);

  const latestApQueueStatus = React.useMemo(() => {
    for (const log of commandLogs) {
      if (log.method !== 'AP-QUEUE-STATUS') {
        continue;
      }
      const body = asObject(log.body);
      if (!body || (body.apId && body.apId !== imageTestForm.apId)) {
        continue;
      }
      const rest = Number(body.rw_task_rest);
      return {
        rest: Number.isFinite(rest) ? rest : undefined,
        time: log.time,
        recentDownlinks: Array.isArray(body.recentDownlinks) ? body.recentDownlinks.length : undefined,
      };
    }
    return undefined;
  }, [commandLogs, imageTestForm.apId]);

  const latestImageTraceInsight = React.useMemo(() => {
    const latest = downlinkTraces.find((trace) => (
      trace.apId === imageTestForm.apId
      && (!trace.labelId || !imageTestForm.eslCode || trace.labelId === imageTestForm.eslCode)
    ));
    return latest ? summarizeTraceInsight(latest) : null;
  }, [downlinkTraces, imageTestForm.apId, imageTestForm.eslCode]);

  const service03Insights = React.useMemo<Service03Insights>(() => {
    const ordered = [...service03Samples]
      .map((sample) => ({
        ...sample,
        noteKey: normalizeSampleNote(sample.textNote) || '(empty)',
        noteValue: extractSampleNoteValue(sample.textNote) || '(empty)',
      }))
      .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));

    const captureCounts = new Map<string, number>();
    const fingerprintCounts = new Map<string, number>();
    const lengthBuckets = new Map<number, { bytes: number; count: number; notes: Set<string> }>();
    const fingerprintBuckets = new Map<string, { fingerprint: string; count: number; notes: Set<string>; captureIds: Set<string> }>();
    const analysisRows = new Map<string, Record<string, unknown>>();

    for (const sample of ordered) {
      captureCounts.set(sample.captureId, (captureCounts.get(sample.captureId) ?? 0) + 1);
      if (sample.fingerprint) {
        fingerprintCounts.set(sample.fingerprint, (fingerprintCounts.get(sample.fingerprint) ?? 0) + 1);
        const existingFingerprint = fingerprintBuckets.get(sample.fingerprint) ?? {
          fingerprint: sample.fingerprint,
          count: 0,
          notes: new Set<string>(),
          captureIds: new Set<string>(),
        };
        existingFingerprint.count += 1;
        existingFingerprint.notes.add(sample.noteKey);
        existingFingerprint.captureIds.add(sample.captureId);
        fingerprintBuckets.set(sample.fingerprint, existingFingerprint);
      }
      if (sample.service03Bytes !== undefined) {
        const existingLength = lengthBuckets.get(sample.service03Bytes) ?? {
          bytes: sample.service03Bytes,
          count: 0,
          notes: new Set<string>(),
        };
        existingLength.count += 1;
        existingLength.notes.add(sample.noteKey);
        lengthBuckets.set(sample.service03Bytes, existingLength);
      }
    }

    const summaries = ordered.map((sample, index) => ({
      ...sample,
      duplicateCapture: (captureCounts.get(sample.captureId) ?? 0) > 1,
      duplicateFingerprint: sample.fingerprint ? (fingerprintCounts.get(sample.fingerprint) ?? 0) > 1 : false,
      deltaFromPrevious:
        index > 0
          && sample.service03Bytes !== undefined
          && ordered[index - 1].service03Bytes !== undefined
          ? sample.service03Bytes - Number(ordered[index - 1].service03Bytes)
          : undefined,
    }));

    for (const row of captureAnalysis?.rows ?? []) {
      const captureId = typeof row.id === 'string' ? row.id : '';
      if (captureId) {
        analysisRows.set(captureId, row);
      }
    }

    const noteGroups = new Map<string, {
      group: string;
      count: number;
      bytesMin?: number;
      bytesMax?: number;
      headHexPrefixes: Set<string>;
      notes: Set<string>;
      captureIds: Set<string>;
    }>();

    for (const sample of summaries) {
      const group = classifySampleNote(sample.noteKey);
      const existing = noteGroups.get(group) ?? {
        group,
        count: 0,
        bytesMin: undefined,
        bytesMax: undefined,
        headHexPrefixes: new Set<string>(),
        notes: new Set<string>(),
        captureIds: new Set<string>(),
      };
      existing.count += 1;
      existing.notes.add(sample.noteKey);
      existing.captureIds.add(sample.captureId);
      if (sample.service03Bytes !== undefined) {
        existing.bytesMin = existing.bytesMin === undefined ? sample.service03Bytes : Math.min(existing.bytesMin, sample.service03Bytes);
        existing.bytesMax = existing.bytesMax === undefined ? sample.service03Bytes : Math.max(existing.bytesMax, sample.service03Bytes);
      }
      const analysisRow = analysisRows.get(sample.captureId);
      const headHex = typeof analysisRow?.service03 === 'object' && analysisRow?.service03 && 'headHex' in analysisRow.service03
        ? String((analysisRow.service03 as { headHex?: string }).headHex ?? '')
        : '';
      if (headHex) {
        existing.headHexPrefixes.add(headHex.slice(0, 24));
      }
      noteGroups.set(group, existing);
    }

    return {
      summaries,
      duplicateCaptureIds: [...captureCounts.entries()].filter(([, count]) => count > 1).map(([captureId]) => captureId),
      duplicateFingerprints: [...fingerprintCounts.entries()].filter(([, count]) => count > 1).map(([fingerprint]) => fingerprint),
      lengthBuckets: [...lengthBuckets.values()]
        .map((bucket) => ({
          bytes: bucket.bytes,
          count: bucket.count,
          notes: [...bucket.notes],
        }))
        .sort((left, right) => left.bytes - right.bytes),
      fingerprintBuckets: [...fingerprintBuckets.values()]
        .map((bucket) => ({
          fingerprint: bucket.fingerprint,
          count: bucket.count,
          notes: [...bucket.notes],
          captureIds: [...bucket.captureIds],
        }))
        .sort((left, right) => right.count - left.count || left.fingerprint.localeCompare(right.fingerprint)),
      noteGroups: [...noteGroups.values()]
        .map((group) => ({
          group: group.group,
          count: group.count,
          bytesMin: group.bytesMin,
          bytesMax: group.bytesMax,
          headHexPrefixes: [...group.headHexPrefixes],
          notes: [...group.notes],
          captureIds: [...group.captureIds],
        }))
        .sort((left, right) => right.count - left.count || left.group.localeCompare(right.group)),
    };
  }, [captureAnalysis, service03Samples]);

  React.useEffect(() => {
    localStorage.setItem('service03Samples', JSON.stringify(service03Samples));
  }, [service03Samples]);

  const selectedCommandAp = aps.find((ap) => ap.id === docCommand.apId) ?? aps.find((ap) => ap.status === 'online') ?? aps[0];
  const selectedCapture = officialDownlinks.find((item) => item.id === selectedCaptureId) ?? officialDownlinks.find((item) => item.replayable) ?? officialDownlinks[0];

  async function login() {
    const result = await api<{ accessToken: string; store: StoreConfig }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ storeCode, username, password }),
    });
    setToken(result.accessToken);
    localStorage.setItem('storeCode', storeCode);
    localStorage.setItem('username', username);
    setStore(result.store);
    setTokenReady(true);
    setMessage('已连接到自建云平台');
  }

  async function refresh() {
    const [storeResult, apsResult, labelsResult, mqttResult] = await Promise.all([
      api<StoreConfig>(`/api/stores/${storeCode}`),
      api<BaseStation[]>('/api/base-stations'),
      api<Label[]>('/api/labels'),
      api<MqttStats>('/api/mqtt/stats'),
    ]);
    setStore(storeResult);
    setAps(apsResult);
    setLabels(labelsResult);
    setMqttStats(mqttResult);
    const firstRealLabel = labelsResult.find((label) => !looksLikeDemoEslCode(label.id));
    setSelectedApId((current) => current || apsResult.find((ap) => ap.status === 'online')?.id || apsResult[0]?.id || '');
    setDocCommand((current) => ({
      ...current,
      apId: current.apId || apsResult.find((ap) => ap.status === 'online')?.id || apsResult[0]?.id || '',
      labelId: current.labelId && !looksLikeDemoEslCode(current.labelId) ? current.labelId : firstRealLabel?.id || '',
    }));
    setMessage(`刷新完成：${new Date().toLocaleTimeString()}`);
    void refreshLabelRenders(labelsResult);
  }

  async function refreshLabelRenders(nextLabels = labels) {
    const results = await Promise.allSettled(
      nextLabels.map(async (label) => api<LabelRender>(`/api/labels/${encodeURIComponent(label.id)}/render`)),
    );
    const rendered = Object.fromEntries(
      results
        .filter((result): result is PromiseFulfilledResult<LabelRender> => result.status === 'fulfilled')
        .map((result) => [result.value.labelId, result.value]),
    );
    setLabelRenders(rendered);
  }

  async function refreshWsStatus(apIds = aps.map((ap) => ap.id)) {
    const statuses = await Promise.all(
      apIds.map(async (apId) => api<WsStatus>(`/api/base-stations/${encodeURIComponent(apId)}/ws-status`)),
    );
    setWsStatuses(Object.fromEntries(statuses.map((status) => [status.apId, status])));
  }

  async function refreshDownlinkTraces(apId = selectedApId || aps[0]?.id || '') {
    if (!apId) {
      setDownlinkTraces([]);
      return;
    }
    const traces = await api<DownlinkTrace[]>(`/api/base-stations/${encodeURIComponent(apId)}/downlink-traces`);
    setDownlinkTraces(traces);
  }

  async function refreshOfficialDownlinks(apId = docCommand.apId || selectedCommandAp?.id || selectedApId || aps[0]?.id || '') {
    if (!apId) {
      setOfficialDownlinks([]);
      return;
    }
    const captures = await loadOfficialDownlinks(apId);
    setOfficialDownlinks(captures);
    setSelectedCaptureId((current) => current || captures.find((item) => item.replayable)?.id || captures[0]?.id || '');
    setLeftDiffCaptureId((current) => current || captures.find((item) => item.commandType === 'READ_WRITE_SVC')?.id || captures[0]?.id || '');
    setRightDiffCaptureId((current) => current || captures.filter((item) => item.commandType === 'READ_WRITE_SVC')[1]?.id || captures[1]?.id || captures[0]?.id || '');
  }

  async function loadOfficialDownlinks(apId: string) {
    return api<OfficialDownlinkCapture[]>(`/api/base-stations/${encodeURIComponent(apId)}/official-downlinks`);
  }

  async function refreshOfficialAnalysis(apId = docCommand.apId || selectedCommandAp?.id || selectedApId || aps[0]?.id || '') {
    if (!apId) {
      setMessage('没有目标 AP，无法分析官方捕获包');
      return;
    }
    const result = await api<OfficialDownlinkAnalysis>(`/api/base-stations/${encodeURIComponent(apId)}/official-downlinks/analysis`);
    setCaptureAnalysis(result);
    setMessage(`service03 分析完成：${result.count} 个捕获包，${result.uniqueService03} 种主图 payload`);
  }

  function sleep(ms: number) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  const candidateComboCatalog = React.useMemo(
    () => [
      { pixelMode: 'bw_1bpp', compression: 'deflate', envelope: 'splice_5_5540', label: '推荐 · 黑白 deflate 5/5540（观察到官方 service03 常见结构）' },
      { pixelMode: 'bwr_2plane', compression: 'deflate', envelope: 'splice_5_5540', label: '推荐 · 双平面 deflate 5/5540（观察到官方 service03 常见结构）' },
      { pixelMode: 'bw_1bpp', compression: 'none', envelope: 'splice_5_5540', label: '黑白直发 5/5540' },
      { pixelMode: 'bw_1bpp_inverted', compression: 'none', envelope: 'splice_5_5540', label: '黑白反色直发 5/5540' },
      { pixelMode: 'bw_1bpp', compression: 'none', envelope: 'splice_12_24', label: '黑白直发 12/24' },
      { pixelMode: 'bw_1bpp', compression: 'deflate', envelope: 'splice_12_24', label: '黑白 deflate 12/24' },
      { pixelMode: 'bw_1bpp', compression: 'gzip', envelope: 'splice_12_24', label: '黑白 gzip 12/24' },
      { pixelMode: 'bw_1bpp_inverted', compression: 'none', envelope: 'splice_12_24', label: '黑白反色直发 12/24' },
      { pixelMode: 'bwr_2plane', compression: 'none', envelope: 'splice_12_24', label: '双平面直发 12/24' },
      { pixelMode: 'bwr_2plane', compression: 'deflate', envelope: 'splice_12_24', label: '双平面 deflate 12/24' },
      { pixelMode: 'gray8', compression: 'deflate', envelope: 'splice_12_24', label: '灰度 deflate 12/24' },
      { pixelMode: 'raw_rgba', compression: 'deflate', envelope: 'splice_12_24', label: 'RGBA deflate 12/24' },
      { pixelMode: 'bw_1bpp', compression: 'none', envelope: 'splice_16_24', label: '黑白直发 16/24' },
      { pixelMode: 'bw_1bpp', compression: 'deflate', envelope: 'splice_16_24', label: '黑白 deflate 16/24' },
      { pixelMode: 'bwr_2plane', compression: 'none', envelope: 'splice_16_24', label: '双平面直发 16/24' },
      { pixelMode: 'bwr_2plane', compression: 'deflate', envelope: 'splice_16_24', label: '双平面 deflate 16/24' },
    ],
    [],
  );

  function readWriteServiceBytes(capture: OfficialDownlinkCapture, service: string) {
    const opas = (capture.summary?.payload as { opas?: Array<{ cmds?: Array<{ service?: string; bytes?: number }> }> } | undefined)?.opas ?? [];
    for (const opa of opas) {
      const match = opa.cmds?.find((cmd) => cmd.service === service);
      if (match?.bytes !== undefined) {
        return match.bytes;
      }
    }
    return undefined;
  }

  function summarizeCaptureForBatch(capture: OfficialDownlinkCapture) {
    return {
      id: capture.id,
      createdAt: capture.createdAt,
      bytes: capture.bytes,
      fingerprint: capture.fingerprint,
      labelId: capture.labelId,
      service03Bytes: readWriteServiceBytes(capture, '01-00-00-03'),
      service07Bytes: readWriteServiceBytes(capture, '01-00-00-07'),
    };
  }

  function readWriteServiceBase64(capture: OfficialDownlinkCapture, service: string) {
    const opas = (capture.summary?.payload as { opas?: Array<{ cmds?: Array<{ service?: string; b64Prefix?: string }> }> } | undefined)?.opas ?? [];
    if (capture.text) {
      try {
        const parsed = JSON.parse(capture.text) as { opas?: Array<{ cmds?: Array<{ service?: string; b64dat?: string }> }> };
        for (const opa of parsed.opas ?? []) {
          const match = opa.cmds?.find((cmd) => cmd.service === service && typeof cmd.b64dat === 'string');
          if (match?.b64dat) {
            return match.b64dat;
          }
        }
      } catch {
        // ignore
      }
    }
    for (const opa of opas) {
      const match = opa.cmds?.find((cmd) => cmd.service === service);
      if (match?.b64Prefix) {
        return match.b64Prefix;
      }
    }
    return '';
  }

  function saveSelectedCaptureAsSample() {
    if (!selectedCapture) {
      setMessage('没有选中的捕获包');
      return;
    }
    const summary = summarizeCaptureForBatch(selectedCapture);
    const next: Service03Sample = {
      id: `${selectedCapture.id}-${Date.now()}`,
      capturedAt: new Date().toISOString(),
      captureId: selectedCapture.id,
      labelId: selectedCapture.labelId,
      templateId: Number(variableTemplateId || officialApi.templateId),
      textNote: service03SampleNote,
      service03Bytes: summary.service03Bytes,
      fingerprint: summary.fingerprint,
    };
    setService03Samples((current) => [next, ...current].slice(0, 40));
    setMessage(`已归档样本：${next.textNote}`);
  }

  function exportService03Samples() {
    const payload = {
      exportedAt: new Date().toISOString(),
      apId: docCommand.apId || selectedCommandAp?.id || '',
      selectedCaptureId,
      samples: service03Samples,
      analysis: captureAnalysis,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `service03-samples-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage('样本 JSON 已导出');
  }

  async function importService03Samples(file?: File) {
    if (!file) {
      return;
    }
    const text = await file.text();
    const payload = JSON.parse(text) as { samples?: Service03Sample[]; analysis?: OfficialDownlinkAnalysis };
    const importedSamples = Array.isArray(payload.samples) ? payload.samples : [];
    if (importedSamples.length === 0) {
      setMessage('导入文件里没有 samples');
      return;
    }
    setService03Samples(importedSamples);
    if (payload.analysis) {
      setCaptureAnalysis(payload.analysis);
    }
    setMessage(`已导入 ${importedSamples.length} 条样本`);
  }

  function clearService03Samples() {
    setService03Samples([]);
    setMessage('已清空本地归档样本');
  }

  function summarizeTraceInsight(trace: DownlinkTrace | Record<string, unknown> | null | undefined): ReplayTraceInsight {
    if (!trace || typeof trace !== 'object') {
      return {
        summary: '还没有拿到 trace 结果。',
        raw: trace ?? null,
      };
    }
    const row = trace as Record<string, unknown>;
    const reply = row.reply && typeof row.reply === 'object' ? row.reply as Record<string, unknown> : undefined;
    const payload = reply?.payload && typeof reply.payload === 'object' ? reply.payload as Record<string, unknown> : undefined;
    const res = payload?.res && typeof payload.res === 'object' ? payload.res as Record<string, unknown> : undefined;
    const cmd = payload?.cmd && typeof payload.cmd === 'object' ? payload.cmd as Record<string, unknown> : undefined;
    const cmdType = typeof cmd?.type === 'string' ? cmd.type : undefined;
    const apReplyType = typeof payload?.type === 'string' ? payload.type : typeof reply?.type === 'string' ? reply.type : undefined;
    const rwTaskRest = typeof payload?.rw_task_rest === 'number' ? payload.rw_task_rest : undefined;
    const sendPktNum = typeof res?.send_pkt_num === 'number' ? res.send_pkt_num : undefined;
    const ackPktNum = typeof res?.ack_pkt_num === 'number' ? res.ack_pkt_num : undefined;
    const errno = typeof res?.errno === 'number' ? res.errno : undefined;
    const writeTimeMs = typeof res?.write_time_ms === 'number' ? res.write_time_ms : undefined;
    const masterAvgRxRssi = typeof res?.master_avg_rx_rssi === 'number' ? res.master_avg_rx_rssi : undefined;
    const slaveAvgRxRssi = typeof res?.slave_avg_rx_rssi === 'number' ? res.slave_avg_rx_rssi : undefined;
    const hasStrongExecutionMetrics = (
      typeof ackPktNum === 'number'
      || typeof sendPktNum === 'number'
      || typeof writeTimeMs === 'number'
    );
    const hasErrnoOnly = typeof errno === 'number' && !hasStrongExecutionMetrics;
    const statusText = typeof row.status === 'string' ? row.status : '';
    let executionObserved = false;
    let executionSuccess: boolean | undefined;
    let executionReason = '';
    if (statusText === 'socket_write_error' || statusText === 'socket_missing') {
      executionObserved = true;
      executionSuccess = false;
      executionReason = statusText === 'socket_missing' ? 'AP WebSocket 未连接' : 'WebSocket 写入失败';
    } else if (hasStrongExecutionMetrics) {
      executionObserved = true;
      if (typeof errno === 'number') {
        executionSuccess = errno === 0;
        executionReason = errno === 0 ? '已收到设备执行结果（errno=0）' : `已收到设备执行结果（errno=${errno}）`;
      } else if (typeof ackPktNum === 'number' && typeof sendPktNum === 'number') {
        executionSuccess = ackPktNum > 0 && sendPktNum > 0;
        executionReason = `已收到设备执行计数（ack/send=${ackPktNum}/${sendPktNum}）`;
      } else {
        executionSuccess = true;
        executionReason = '已收到设备执行回包';
      }
    } else if (hasErrnoOnly) {
      if (apReplyType === 'READ_WRITE_SVC' && cmdType && cmdType !== 'WRITE_SVC') {
        executionReason = `收到 ${cmdType} 回包，等待 WRITE_SVC 执行结果`;
      } else
      if (errno !== 0) {
        executionObserved = true;
        executionSuccess = false;
        executionReason = `设备执行失败（errno=${errno}，且缺少 ack/send/write_time）`;
      } else {
        executionReason = '仅收到 errno=0，缺少 ack/send/write_time，暂不能确认已刷屏';
      }
    } else if (statusText === 'ap_reply_seen') {
      if (apReplyType === 'AP_REPORT_STATUS' && typeof rwTaskRest === 'number') {
        executionReason = rwTaskRest > 0
          ? `AP 队列仍有 ${rwTaskRest} 个读写任务，等待价签连接/执行`
          : 'AP 队列已清空，但本次 trace 尚未看到 WRITE_SVC 执行结果';
      } else {
        executionReason = '仅收到 AP 状态回包，尚未看到设备执行结果';
      }
    } else {
      executionReason = '尚未收到 AP/设备执行回包';
    }
    let summary = `trace 状态：${String(row.status ?? '-')}`;
    if (apReplyType) {
      summary += ` · AP 回包：${apReplyType}`;
    }
    if (cmdType) {
      summary += ` · cmd=${cmdType}`;
    }
    if (typeof ackPktNum === 'number' || typeof sendPktNum === 'number') {
      summary += ` · ack/send=${ackPktNum ?? '-'} / ${sendPktNum ?? '-'}`;
    }
    if (typeof errno === 'number') {
      summary += ` · errno=${errno}`;
    }
    if (typeof writeTimeMs === 'number') {
      summary += ` · write=${writeTimeMs}ms`;
    }
    if (typeof rwTaskRest === 'number') {
      summary += ` · rw_task_rest=${rwTaskRest}`;
    }
    if (executionObserved) {
      summary += ` · 执行${executionSuccess ? '确认成功' : '确认失败'}`;
      if (executionReason) {
        summary += `（${executionReason}）`;
      }
    } else if (executionReason) {
      summary += ` · ${executionReason}`;
    }
    return {
      trackingId: typeof row.id === 'string' ? row.id : undefined,
      status: typeof row.status === 'string' ? row.status : undefined,
      commandType: typeof row.commandType === 'string' ? row.commandType : undefined,
      labelId: typeof row.labelId === 'string' ? row.labelId : undefined,
      queueId: typeof row.queueId === 'number' ? row.queueId : undefined,
      apReplyType,
      ackPktNum,
      sendPktNum,
      errno,
      writeTimeMs,
      rwTaskRest,
      masterAvgRxRssi,
      slaveAvgRxRssi,
      executionObserved,
      executionSuccess,
      executionReason,
      summary,
      raw: trace,
    };
  }

  async function waitForReplayTrace(apId: string, trackingId?: string, timeoutMs = 6000) {
    if (!trackingId) {
      return null;
    }
    const started = Date.now();
    let latest: DownlinkTrace | Record<string, unknown> | null = null;
    while (Date.now() - started < timeoutMs) {
      latest = await api<DownlinkTrace | Record<string, unknown>>(`/api/base-stations/${encodeURIComponent(apId)}/downlink-traces/${encodeURIComponent(trackingId)}`);
      const status = latest && typeof latest === 'object' ? (latest as Record<string, unknown>).status : undefined;
      if (status === 'ap_reply_seen' || status === 'socket_write_error' || status === 'socket_missing') {
        return latest;
      }
      await sleep(500);
    }
    return latest;
  }

  async function waitForTraceExecution(apId: string, trackingId?: string, timeoutMs = 15000) {
    if (!trackingId) {
      return { trace: null as DownlinkTrace | Record<string, unknown> | null, insight: summarizeTraceInsight(null) };
    }
    const started = Date.now();
    let latest: DownlinkTrace | Record<string, unknown> | null = null;
    let latestInsight = summarizeTraceInsight(null);
    while (Date.now() - started < timeoutMs) {
      latest = await api<DownlinkTrace | Record<string, unknown>>(`/api/base-stations/${encodeURIComponent(apId)}/downlink-traces/${encodeURIComponent(trackingId)}`);
      latestInsight = summarizeTraceInsight(latest);
      if (latestInsight.executionObserved) {
        return { trace: latest, insight: latestInsight, timedOut: false };
      }
      await sleep(700);
    }
    return { trace: latest, insight: latestInsight, timedOut: true };
  }

  async function replayWithCandidateService03() {
    const apId = docCommand.apId || selectedCommandAp?.id || '';
    const captureId = selectedCapture?.id || '';
    if (!apId || !captureId || !candidateService03B64.trim()) {
      setCandidateStatus({
        phase: 'error',
        title: '还不能发送',
        detail: '需要先选中一条官方捕获包，并生成或填写候选 service03 base64。',
      });
      setMessage('需要选中一个官方捕获包，并填写候选 service03 base64');
      return;
    }
    setCandidateStatus({
      phase: 'replaying',
      title: '正在注入并重放',
      detail: `基线捕获 ${captureId}，目标 AP ${apId}。发送后请观察标签和日志。`,
    });
    const result = await api<unknown>(`/api/base-stations/${encodeURIComponent(apId)}/official-downlinks/${encodeURIComponent(captureId)}/replay`, {
      method: 'POST',
      body: JSON.stringify({
        targetLabelId: replayTargetLabelId || undefined,
        replacementService03B64: candidateService03B64.trim(),
        replacementService07B64: candidateService07B64.trim() || undefined,
      }),
    });
    setReplayResult(result);
    const trackingId = (result as { replay?: { trackingId?: string } } | null)?.replay?.trackingId;
    const trace = await waitForReplayTrace(apId, trackingId);
    const insight = summarizeTraceInsight(trace);
    setReplayTraceInsight(insight);
    setCandidateStatus({
      phase: 'success',
      title: '候选编码已发送到基站',
      detail: insight.summary,
    });
    setMessage('候选 service03 已注入并重放，观察标签和 AP 回包');
  }

  async function generateCandidateFromDataUrl(imageName: string, sourceDataUrl: string, options?: {
    pixelMode?: string;
    compression?: string;
    envelope?: string;
  }) {
    if (!selectedCapture) {
      setCandidateStatus({
        phase: 'error',
        title: '缺少基线捕获',
        detail: '请先在上方捕获列表里选中一条官方成功的 READ_WRITE_SVC，再上传图片。',
      });
      setMessage('请先选中一条官方 READ_WRITE_SVC 捕获包，作为候选封套基线');
      throw new Error('缺少基线捕获');
    }
    const pixelMode = options?.pixelMode ?? candidatePixelMode;
    const compression = options?.compression ?? candidateCompression;
    const envelope = options?.envelope ?? candidateEnvelope;
    setCandidateStatus({
      phase: 'generating',
      title: '正在生成候选编码',
      detail: `${imageName} · ${pixelMode} · ${compression} · ${envelope}`,
    });
    const rendered = await renderImageToCanvasPixels(sourceDataUrl);
    let sourceBytes: Uint8Array;
    if (pixelMode === 'raw_rgba') {
      sourceBytes = new Uint8Array(rendered.rgba);
    } else if (pixelMode === 'gray8') {
      sourceBytes = rgbaToGray8(rendered.rgba);
    } else if (pixelMode === 'bw_1bpp_inverted') {
      sourceBytes = rgbaToBw1bpp(rendered.rgba, true);
    } else if (pixelMode === 'bwr_2plane') {
      sourceBytes = rgbaToBwr2Plane(rendered.rgba);
    } else {
      sourceBytes = rgbaToBw1bpp(rendered.rgba, false);
    }

    let encodedBytes = sourceBytes;
    if (compression === 'gzip' || compression === 'deflate') {
      encodedBytes = await compressBytes(sourceBytes, compression as 'gzip' | 'deflate');
    }

    const baselineB64 = readWriteServiceBase64(selectedCapture, '01-00-00-03');
    const baselineBytes = baselineB64 ? base64ToBytes(baselineB64) : new Uint8Array();
    const service03Bytes = buildEnvelopeBytes(encodedBytes, baselineBytes, envelope);
    const service03B64 = bytesToBase64(service03Bytes);
    setCandidateService03B64(service03B64);
    setGeneratedCandidate({
      imageName,
      width: rendered.width,
      height: rendered.height,
      pixelMode,
      compression,
      envelope,
      sourceBytes: sourceBytes.length,
      encodedBytes: encodedBytes.length,
      service03Bytes: service03Bytes.length,
      service03B64Chars: service03B64.length,
    });
    setCandidateStatus({
      phase: 'generated',
      title: '候选编码已生成',
      detail: `${imageName} -> ${service03Bytes.length} bytes。现在可以直接点“注入并重放”。`,
    });
    setMessage(`候选 service03 已生成：${imageName} · ${service03Bytes.length} bytes`);
    return {
      service03B64,
      info: {
        imageName,
        width: rendered.width,
        height: rendered.height,
        pixelMode,
        compression,
        envelope,
        sourceBytes: sourceBytes.length,
        encodedBytes: encodedBytes.length,
        service03Bytes: service03Bytes.length,
        service03B64Chars: service03B64.length,
      } satisfies GeneratedCandidateInfo,
    };
  }

  async function generateCandidateService03(file?: File) {
    if (!file) {
      return;
    }
    const sourceDataUrl = await readFileAsDataUrl(file);
    setCandidateSourceImage({
      name: file.name,
      dataUrl: sourceDataUrl,
    });
    await generateCandidateFromDataUrl(file.name, sourceDataUrl);
  }

  async function deriveCandidateEnvelopeFromSelectedCapture() {
    const apId = docCommand.apId || selectedCommandAp?.id || '';
    const captureId = selectedCapture?.id || '';
    if (!apId || !captureId) {
      setMessage('缺少目标 AP 或基线捕获，无法推导封套');
      return;
    }
    const result = await api<{ ok: boolean; commonPrefixBytes?: number; commonSuffixBytes?: number; reason?: string }>(
      `/api/base-stations/${encodeURIComponent(apId)}/official-downlinks/structure`,
      {
        method: 'POST',
        body: JSON.stringify({ captureIds: [captureId] }),
      },
    );
    if (!result?.ok) {
      setMessage(`封套推导失败：${String((result as { reason?: string } | null)?.reason ?? 'unknown')}`);
      return;
    }
    const header = Number(result.commonPrefixBytes ?? 0);
    const tail = Number(result.commonSuffixBytes ?? 0);
    if (!Number.isFinite(header) || !Number.isFinite(tail) || header <= 0 || tail <= 0) {
      setMessage(`封套推导结果不可信：header=${header}, tail=${tail}`);
      return;
    }
    const envelope = `splice_${header}_${tail}`;
    setCandidateEnvelope(envelope);
    setCandidateStatus({
      phase: 'idle',
      title: '已推导封套',
      detail: `基线 ${captureId} -> ${envelope}。建议重新生成候选后再重放。`,
    });
    setMessage(`已推导 service03 封套：${envelope}`);
  }

  function applyCandidatePreset(preset: { pixelMode: string; compression: string; envelope: string; label: string }) {
    setCandidatePixelMode(preset.pixelMode);
    setCandidateCompression(preset.compression);
    setCandidateEnvelope(preset.envelope);
    setCandidateStatus({
      phase: 'idle',
      title: `已切换到 ${preset.label}`,
      detail: '上传图片后会按这组猜测生成候选编码。',
    });
    setMessage(`已切换候选方案：${preset.label}`);
  }

  async function sweepCandidateCombinations() {
    const apId = docCommand.apId || selectedCommandAp?.id || '';
    const captureId = selectedCapture?.id || '';
    if (!candidateSourceImage) {
      setCandidateStatus({
        phase: 'error',
        title: '还没有实验图片',
        detail: '请先上传一张图片，然后再点“一键遍历重发”。',
      });
      setMessage('请先上传实验图片');
      return;
    }
    if (!apId || !captureId) {
      setCandidateStatus({
        phase: 'error',
        title: '缺少基线捕获',
        detail: '请先在上方捕获列表选中一条官方成功包。',
      });
      setMessage('请先选中一条官方成功捕获');
      return;
    }
    setCandidateSweepRunning(true);
    setCandidateSweepResults([]);
    const total = candidateComboCatalog.length;
    try {
      for (let index = 0; index < candidateComboCatalog.length; index += 1) {
        const combo = candidateComboCatalog[index];
        setCandidatePixelMode(combo.pixelMode);
        setCandidateCompression(combo.compression);
        setCandidateEnvelope(combo.envelope);
        setCandidateStatus({
          phase: 'generating',
          title: `正在生成第 ${index + 1}/${total} 组候选`,
          detail: combo.label,
        });
        const generated = await generateCandidateFromDataUrl(candidateSourceImage.name, candidateSourceImage.dataUrl, combo);
        setCandidateStatus({
          phase: 'replaying',
          title: `正在发送第 ${index + 1}/${total} 组`,
          detail: `${combo.label} · ${generated.info.service03Bytes} bytes`,
        });
        const result = await api<unknown>(`/api/base-stations/${encodeURIComponent(apId)}/official-downlinks/${encodeURIComponent(captureId)}/replay`, {
          method: 'POST',
          body: JSON.stringify({
            targetLabelId: replayTargetLabelId || undefined,
            replacementService03B64: generated.service03B64,
            replacementService07B64: candidateService07B64.trim() || undefined,
          }),
        });
        setReplayResult(result);
        const trackingId = (result as { replay?: { trackingId?: string } } | null)?.replay?.trackingId;
        const trace = await waitForReplayTrace(apId, trackingId);
        const insight = summarizeTraceInsight(trace);
        setReplayTraceInsight(insight);
        setCandidateSweepResults((current) => [
          {
            index: index + 1,
            total,
            pixelMode: combo.pixelMode,
            compression: combo.compression,
            envelope: combo.envelope,
            service03Bytes: generated.info.service03Bytes,
            ok: true,
            detail: `${combo.label} · ${insight.summary}`,
            at: new Date().toISOString(),
          },
          ...current,
        ]);
        setCandidateStatus({
          phase: 'success',
          title: `第 ${index + 1}/${total} 组已发送`,
          detail: `${combo.label} · ${insight.summary}。等待 10 秒再发下一组。`,
        });
        if (index < candidateComboCatalog.length - 1) {
          await sleep(10000);
        }
      }
      setMessage(`一键遍历已完成，共发送 ${total} 组候选`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知错误';
      setCandidateSweepResults((current) => [
        {
          index: current.length + 1,
          total,
          pixelMode: candidatePixelMode,
          compression: candidateCompression,
          envelope: candidateEnvelope,
          service03Bytes: generatedCandidate?.service03Bytes ?? 0,
          ok: false,
          detail,
          at: new Date().toISOString(),
        },
        ...current,
      ]);
      setCandidateStatus({
        phase: 'error',
        title: '一键遍历中断',
        detail,
      });
      setMessage(detail);
    } finally {
      setCandidateSweepRunning(false);
    }
  }

  async function sweepOfficialByteXor() {
    const apId = docCommand.apId || selectedCommandAp?.id || '';
    const captureId = selectedCapture?.id || '';
    if (!apId || !captureId || !selectedCapture) {
      setCandidateStatus({
        phase: 'error',
        title: '缺少基线捕获',
        detail: '请先选中一条官方成功包。',
      });
      return;
    }
    const baselineB64 = readWriteServiceBase64(selectedCapture, '01-00-00-03');
    if (!baselineB64) {
      setCandidateStatus({
        phase: 'error',
        title: '基线包没有 service03',
        detail: '当前捕获里没有找到 01-00-00-03。',
      });
      return;
    }
    const bytes = base64ToBytes(baselineB64);
    const offsets = [...new Set([
      0,
      8,
      16,
      Math.max(0, Math.floor(bytes.length * 0.1)),
      Math.max(0, Math.floor(bytes.length * 0.25)),
      Math.max(0, Math.floor(bytes.length * 0.5)),
      Math.max(0, Math.floor(bytes.length * 0.75)),
      Math.max(0, bytes.length - 32),
      Math.max(0, bytes.length - 8),
    ].filter((value) => value >= 0 && value < bytes.length))];
    const regionLabel = (offset: number) => {
      if (offset < 32) return '头部区';
      if (offset < bytes.length * 0.25) return '前段区';
      if (offset < bytes.length * 0.75) return '中段区';
      return '尾部区';
    };
    setOfficialMutationRunning(true);
    setOfficialMutationResults([]);
    try {
      for (let index = 0; index < offsets.length; index += 1) {
        const offset = offsets[index];
        setCandidateStatus({
          phase: 'replaying',
          title: `单字节扰动 ${index + 1}/${offsets.length}`,
          detail: `offset=${offset} xor=0x01`,
        });
        const result = await api<unknown>(`/api/base-stations/${encodeURIComponent(apId)}/official-downlinks/${encodeURIComponent(captureId)}/replay`, {
          method: 'POST',
          body: JSON.stringify({
            targetLabelId: replayTargetLabelId || undefined,
            service03ByteOffset: offset,
            service03ByteXor: 1,
          }),
        });
        setReplayResult(result);
        const trackingId = (result as { replay?: { trackingId?: string } } | null)?.replay?.trackingId;
        const trace = await waitForReplayTrace(apId, trackingId);
        const insight = summarizeTraceInsight(trace);
        setReplayTraceInsight(insight);
        setOfficialMutationResults((current) => [
          {
            index: index + 1,
            total: offsets.length,
            mode: 'byte_xor',
            label: `${regionLabel(offset)} offset=${offset} xor=0x01`,
            ok: true,
            detail: insight.summary,
            at: new Date().toISOString(),
          },
          ...current,
        ]);
        if (index < offsets.length - 1) {
          await sleep(10000);
        }
      }
      setCandidateStatus({
        phase: 'success',
        title: '官方包分区扰动遍历完成',
        detail: `共发送 ${offsets.length} 组；本轮 offset 基于完整 service03 的真实长度 ${bytes.length} bytes 计算。`,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知错误';
      setCandidateStatus({
        phase: 'error',
        title: '官方包单字节扰动中断',
        detail,
      });
      setMessage(detail);
    } finally {
      setOfficialMutationRunning(false);
    }
  }

  async function sweepOfficialSplice() {
    const apId = docCommand.apId || selectedCommandAp?.id || '';
    const leftId = selectedCapture?.id || '';
    const rightId = rightDiffCaptureId || '';
    if (!apId || !leftId || !rightId) {
      setCandidateStatus({
        phase: 'error',
        title: '缺少 A/B 捕获包',
        detail: '请先选中当前基线捕获，并在下方差分区选择捕获 B。',
      });
      return;
    }
    const leftCapture = officialDownlinks.find((item) => item.id === leftId);
    const leftB64 = leftCapture ? readWriteServiceBase64(leftCapture, '01-00-00-03') : '';
    if (!leftB64) {
      setCandidateStatus({
        phase: 'error',
        title: '基线包没有 service03',
        detail: '当前捕获里没有找到 01-00-00-03。',
      });
      return;
    }
    const leftBytes = base64ToBytes(leftB64);
    const cuts = [...new Set([Math.floor(leftBytes.length * 0.25), Math.floor(leftBytes.length * 0.5), Math.floor(leftBytes.length * 0.75)].filter((value) => value > 0 && value < leftBytes.length))];
    setOfficialMutationRunning(true);
    setOfficialMutationResults([]);
    try {
      for (let index = 0; index < cuts.length; index += 1) {
        const cut = cuts[index];
        setCandidateStatus({
          phase: 'replaying',
          title: `A/B 分段拼接 ${index + 1}/${cuts.length}`,
          detail: `cut=${cut}，前段取 A，后段取 B`,
        });
        const result = await api<unknown>(`/api/base-stations/${encodeURIComponent(apId)}/official-downlinks/${encodeURIComponent(leftId)}/replay`, {
          method: 'POST',
          body: JSON.stringify({
            targetLabelId: replayTargetLabelId || undefined,
            spliceSourceCaptureId: rightId,
            spliceOffset: cut,
          }),
        });
        setReplayResult(result);
        const trackingId = (result as { replay?: { trackingId?: string } } | null)?.replay?.trackingId;
        const trace = await waitForReplayTrace(apId, trackingId);
        const insight = summarizeTraceInsight(trace);
        setReplayTraceInsight(insight);
        setOfficialMutationResults((current) => [
          {
            index: index + 1,
            total: cuts.length,
            mode: 'splice',
            label: `A[:${cut}] + B[${cut}:]`,
            ok: true,
            detail: insight.summary,
            at: new Date().toISOString(),
          },
          ...current,
        ]);
        if (index < cuts.length - 1) {
          await sleep(10000);
        }
      }
      setCandidateStatus({
        phase: 'success',
        title: 'A/B 分段拼接遍历完成',
        detail: `共发送 ${cuts.length} 组；本轮 cut 基于完整 service03 的真实长度 ${leftBytes.length} bytes 计算。`,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知错误';
      setCandidateStatus({
        phase: 'error',
        title: 'A/B 分段拼接中断',
        detail,
      });
      setMessage(detail);
    } finally {
      setOfficialMutationRunning(false);
    }
  }

  async function refreshLogs() {
    const logsResult = await api<DeviceLog[]>(`/api/device-logs${showAllLogs ? '?all=1' : ''}`);
    setLogs(Array.isArray(logsResult) ? logsResult : []);
    setLogsLoadedAt(new Date().toLocaleTimeString());
  }

  async function refreshCommandExperiment() {
    const targetApId = docCommand.apId || selectedCommandAp?.id || '';
    await Promise.all([
      refreshLogs(),
      targetApId ? refreshDownlinkTraces(targetApId) : Promise.resolve(),
      targetApId ? refreshWsStatus([targetApId]) : Promise.resolve(),
      targetApId ? refreshOfficialDownlinks(targetApId) : Promise.resolve(),
    ]);
  }

  async function saveLabel() {
    const label = await api<Label>('/api/labels', {
      method: 'POST',
      body: JSON.stringify({
        id: draftLabel.id,
        storeCode,
        title: draftLabel.title,
        price: Number(draftLabel.price),
        currency: 'CNY',
        apId: aps[0]?.id,
      }),
    });
    setLabels((current) => [label, ...current.filter((item) => item.id !== label.id)]);
    setMessage(`价签 ${label.id} 已保存`);
  }

  async function publish(label: Label) {
    setSendingLabels((current) => ({ ...current, [label.id]: true }));
    setLabelCommandStatus((current) => ({ ...current, [label.id]: '下发中...' }));
    setMessage(`正在下发：${label.id}`);

    try {
      const result = await api<LabelCommandResult>(`/api/labels/${label.id}/commands`, {
        method: 'POST',
        body: JSON.stringify({
          storeCode: label.storeCode,
          type: 'refresh_label',
          payload: {
            title: label.title,
            price: label.price,
            currency: label.currency,
          },
        }),
      });
      const statusText = result.transport === 'ESL_WRITE'
        ? `PSM + ESL_WRITE 已下发，MQTT ${result.delivery?.mqtt?.filter((item) => item.ok).length ?? 0}/${result.delivery?.mqtt?.length ?? 0}，WS PSM ${result.delivery?.websocketPsm?.bytes ?? 0} bytes / 图像 ${result.delivery?.websocketJson?.bytes ?? 0} bytes，topic ${result.protocol?.topic ?? '-'}`
        : result.transport === 'taskESL2'
          ? `taskESL2 已下发，MQTT ${result.delivery?.mqtt?.filter((item) => item.ok).length ?? 0}/${result.delivery?.mqtt?.length ?? 0}，WS ${result.delivery?.websocketBinary?.bytes ?? 0} bytes，topic ${result.protocol?.topic ?? '-'}`
          : result.transport === 'websocket'
          ? `图像已送达基站连接，${result.delivery?.bytes ?? 0} bytes；未收到刷屏确认`
          : `图像已发布到 EMQX：${result.status}`;
      setLabelCommandStatus((current) => ({ ...current, [label.id]: statusText }));
      setMessage(`${label.id}：${statusText}${result.execution?.reason ? `。${result.execution.reason}` : ''}`);
      await Promise.all([refreshLogs(), refresh()]);
    } catch (error) {
      const text = error instanceof Error ? error.message : '未知错误';
      setLabelCommandStatus((current) => ({ ...current, [label.id]: text }));
      setMessage(`${label.id} 下发失败：${text}`);
    } finally {
      setSendingLabels((current) => ({ ...current, [label.id]: false }));
    }
  }

  async function sendRawWsCommand() {
    if (!selectedApId) {
      setRawCommandStatus('没有选择目标基站');
      setMessage('没有选择目标基站');
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawWsCommand) as Record<string, unknown>;
    } catch {
      setRawCommandStatus('JSON 格式错误');
      setMessage('原始命令不是合法 JSON');
      return;
    }

    setSendingRawCommand(true);
    setRawCommandStatus('发送中...');
    try {
      const result = await api<{ ok: boolean; reason?: string; bytes?: number }>(
        `/api/base-stations/${encodeURIComponent(selectedApId)}/ws-command`,
        {
          method: 'POST',
          body: JSON.stringify({ payload }),
        },
      );
      const nextStatus = result.ok ? `已发送，${result.bytes ?? 0} bytes` : `未发送：${result.reason ?? '未知原因'}`;
      setRawCommandStatus(nextStatus);
      setMessage(result.ok ? `WS 命令已发送，${result.bytes ?? 0} bytes` : `WS 命令未发送：${result.reason ?? '未知原因'}`);
      await Promise.all([refreshLogs(), refreshWsStatus()]);
    } catch (error) {
      const text = error instanceof Error ? error.message : '未知错误';
      setRawCommandStatus(text);
      setMessage(text);
    } finally {
      setSendingRawCommand(false);
    }
  }

  async function loadCommandImage(file?: File) {
    if (!file) {
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    const normalized = await normalizeImageToLabelImageData(dataUrl);
    const pngDataUrl = normalized.pngDataUrl;
    setDocCommand((current) => ({
      ...current,
      source: pngDataUrl.includes(',') ? pngDataUrl.split(',')[1] : pngDataUrl,
      rgbaB64: normalized.rgbaB64,
      sourceName: `${file.name} -> 296x128 PNG`,
      mode: 1,
    }));
    setMessage(`图片已转换为 296x128 PNG：${file.name}`);
  }

  function documentParams(commandType = docCommand.commandType, overrides: Record<string, unknown> = {}) {
    const params: Record<string, unknown> = {
      esl_code: docCommand.labelId,
      queue_id: docCommand.queue_id ? Number(docCommand.queue_id) : undefined,
      source: docCommand.source,
      rgba_b64: docCommand.rgbaB64,
      width: 296,
      height: 128,
      color_mode: docCommand.colorMode,
      pattern: Number(docCommand.pattern),
      page_index: Number(docCommand.pageIndex),
      compress: docCommand.compress,
      led_red: docCommand.ledRed,
      led_green: docCommand.ledGreen,
      led_blue: docCommand.ledBlue,
      led_times: Number(docCommand.ledTimes),
      mode: Number(docCommand.mode),
      orientation: Number(docCommand.orientation),
      r: Number(docCommand.r),
      g: Number(docCommand.g),
      b: Number(docCommand.b),
      time_on_ms: Number(docCommand.time_on_ms),
      time_s: Number(docCommand.time_s),
      group: Number(docCommand.group),
      b64dat: docCommand.b64dat,
      url: docCommand.url,
      md5: docCommand.md5,
      index: Number(docCommand.index),
      psm_mode: docCommand.psmMode,
      adv_group: Number(docCommand.adv_group),
      duration_ms: Number(docCommand.duration_ms),
      act_time_us: Number(docCommand.act_time_us),
      slp_cycle_ms: Number(docCommand.slp_cycle_ms),
      adv_interval_ms: Number(docCommand.adv_interval_ms),
      adv_map: Number(docCommand.adv_map),
      wait_conn_ch_idx: Number(docCommand.wait_conn_ch_idx),
      retry_num: Number(docCommand.retry_num),
      parallel_num: Number(docCommand.parallel_num),
      ap_chn_num: Number(docCommand.ap_chn_num),
      pre_psm: docCommand.prePsm,
      ...overrides,
    };

    if (commandType === 'raw') {
      try {
        params.raw = JSON.parse(docCommand.raw);
      } catch {
        params.raw = {};
      }
    }
    return params;
  }

  async function sendDocumentCommandRequest(options: {
    commandType: string;
    labelId: string;
    apId: string;
    params?: Record<string, unknown>;
    delivery?: { mqtt?: boolean; websocket?: boolean };
  }) {
    return api<DocumentCommandResult>(`/api/labels/${encodeURIComponent(options.labelId)}/document-command`, {
      method: 'POST',
      body: JSON.stringify({
        storeCode,
        commandType: options.commandType,
        apId: options.apId,
        params: options.params ?? documentParams(options.commandType),
        delivery: {
          mqtt: options.delivery?.mqtt ?? docCommand.sendMqtt,
          websocket: options.delivery?.websocket ?? docCommand.sendWs,
        },
      }),
    });
  }

  async function sendDocumentCommand() {
    const labelId = docCommand.labelId || labels[0]?.id;
    if (!labelId) {
      setMessage('没有可用价签');
      return;
    }
    setMessage('正在发送文档指令...');
    try {
      const result = await sendDocumentCommandRequest({
        commandType: docCommand.commandType,
        labelId,
        apId: docCommand.apId,
        params: documentParams(docCommand.commandType),
      });
      setDocResult(result);
      setMessage(`${result.ok ? '已发送' : '未发送'}：${result.protocol?.topic ?? result.reason ?? '-'}`);
      await Promise.all([refresh(), refreshCommandExperiment()]);
    } catch (error) {
      const text = error instanceof Error ? error.message : '未知错误';
      setMessage(text);
      setDocResult({ ok: false, reason: text });
    }
  }

  function imageActionNeedsConfirmation(commandType: string) {
    return commandType === 'ap_restart'
      || commandType === 'ap_reboot'
      || commandType === 'ap_ota'
      || (commandType === 'ap_psm' && docCommand.psmMode === 'sleep');
  }

  function imageActionParams(commandType: string) {
    return documentParams(commandType, {
      esl_code: imageTestForm.eslCode,
      source: commandType === 'image_led' || commandType === 'refresh' ? docCommand.source : '',
      pre_psm: commandType === 'white' || commandType === 'image_led' ? docCommand.prePsm : false,
    });
  }

  async function sendImageTestDocumentCommand(commandType: string, label: string) {
    if (commandType === 'image_led') {
      setImageActionRunning(commandType);
      try {
        await runLocalImageRenderTest({ imageLed: true });
      } finally {
        setImageActionRunning('');
      }
      return;
    }
    if (!imageTestForm.apId) {
      setImageActionStatus('请先选择目标基站');
      setMessage('请先选择目标基站');
      return;
    }
    if (!imageTestForm.eslCode) {
      setImageActionStatus('请先选择目标价签');
      setMessage('请先选择目标价签');
      return;
    }
    if (imageActionNeedsConfirmation(commandType)) {
      const ok = window.confirm(`确认执行 ${label}？这个操作会影响基站或连接窗口。`);
      if (!ok) {
        return;
      }
    }

    setImageActionRunning(commandType);
    setImageActionStatus(`正在发送 ${label}...`);
    setMessage(`正在发送 ${label}`);
    try {
      const result = await sendDocumentCommandRequest({
        commandType,
        labelId: imageTestForm.eslCode,
        apId: imageTestForm.apId,
        params: imageActionParams(commandType),
      });
      setImageActionResult(result);
      const queuePart = result.protocol?.queueId ? `，queue_id=${result.protocol.queueId}` : '';
      const nextStatus = result.ok
        ? `${label} 已发送${queuePart}`
        : `${label} 未发送：${result.reason ?? '未知原因'}`;
      setImageActionStatus(nextStatus);
      setMessage(nextStatus);
      await Promise.all([refreshLogs(), refreshDownlinkTraces(imageTestForm.apId), refreshWsStatus()]);
    } catch (error) {
      const text = error instanceof Error ? error.message : '未知错误';
      setImageActionStatus(text);
      setMessage(text);
      setImageActionResult({ ok: false, reason: text, commandType });
    } finally {
      setImageActionRunning('');
    }
  }

  async function runLocalImageRenderTest(options?: { imageLed?: boolean }) {
    if (!imageTestForm.apId) {
      setImageTestStatus('请先选择目标基站');
      setMessage('请先选择目标基站');
      return;
    }
    if (!imageTestForm.eslCode) {
      setImageTestStatus('请先选择目标价签');
      setMessage('请先选择目标价签');
      return;
    }
    if (!imageTestFile && !imageTestForm.localImageName.trim()) {
      setImageTestStatus('请先选择图片文件，或填写服务器本地图片名');
      setMessage('请先选择图片文件，或填写服务器本地图片名');
      return;
    }

    setImageTestRunning(true);
    const imageLed = options?.imageLed ?? imageTestForm.imageLed;
    setImageTestStatus(imageTestForm.dryRun ? '正在自动筛选最佳参数（dryRun）...' : imageLed ? '正在生成图片并追加 LED 闪灯...' : '正在自动筛选并下发...');
    setMessage(`正在执行本地图片渲染测试：${imageTestFile?.name ?? imageTestForm.localImageName}`);
    try {
      const formData = new FormData();
      formData.append('apId', imageTestForm.apId);
      formData.append('eslCode', imageTestForm.eslCode);
      formData.append('fourColor', imageTestForm.fourColor ? 'true' : 'false');
      formData.append('sendMode', imageTestForm.sendMode);
      formData.append('renderMode', imageTestForm.renderMode);
      formData.append('fullVariant', imageTestForm.fullVariant);
      formData.append('fullQuartet', imageTestForm.fullQuartet);
      formData.append('localImageName', imageTestForm.localImageName.trim());
      formData.append('fastMode', imageTestForm.fastMode ? 'true' : 'false');
      formData.append('renderPreset', imageTestForm.renderPreset);
      const canvasPreset = buildCanvasPreset(imageTestForm);
      const canvasStrategy = strategyForCanvasPreset(canvasPreset);
      formData.append('canvasPreset', canvasPreset);
      formData.append('renderScale', imageTestForm.renderScale);
      formData.append('imageRotate', canvasStrategy.imageRotate);
      formData.append('imageFlip', canvasStrategy.imageFlip);
      formData.append('imageLed', imageLed ? 'true' : 'false');
      formData.append('ledB64dat', imageTestForm.ledB64dat);
      formData.append('dryRun', imageTestForm.dryRun ? 'true' : 'false');
      formData.append('topN', String(Math.max(1, Number(imageTestForm.topN) || 8)));
      if (imageTestFile) {
        formData.append('file', imageTestFile);
      }
      const result = await api<LocalImageTestResult>('/api/official-api/send-image-4515-file-local-generated-auto-best', {
        method: 'POST',
        body: formData,
      });
      const trackingId = result.replay?.trackingId;
      const statusText = result.ok
        ? imageTestForm.dryRun
          ? `已生成 dryRun 结果，参数：${result.fitMode ?? '-'} / ${result.resample ?? '-'} / dither=${String(result.dither)}`
          : `已下发${imageLed ? '（含 LED 闪灯）' : ''}（待执行确认），tracking=${result.replay?.trackingId ?? '-'}，参数：${result.fitMode ?? '-'} / ${result.resample ?? '-'} / dither=${String(result.dither)}`
        : `执行失败：${result.reason ?? result.message ?? '未知错误'}`;
      setImageTestStatus(statusText);
      setMessage(statusText);
      setImageTestResult(result);
      if (!imageTestForm.dryRun) {
        const executionTimeoutMs = imageTestForm.renderMode === 'service0c_local' ? 130_000 : 20_000;
        setImageTestStatus(`已下发，正在等待 AP/价签执行确认（最多 ${Math.round(executionTimeoutMs / 1000)} 秒）...`);
        const execution = await waitForTraceExecution(imageTestForm.apId, trackingId, executionTimeoutMs);
        const executionStatus = execution.insight.executionObserved
          ? execution.insight.executionSuccess
            ? `执行确认成功：${execution.insight.summary}`
            : `执行确认失败：${execution.insight.summary}`
          : `执行确认超时：${execution.insight.summary}`;
        setImageTestStatus(executionStatus);
        setMessage(executionStatus);
        setImageTestResult({
          ...result,
          executionInsight: execution.insight,
          executionTimedOut: execution.timedOut,
        });
        await Promise.all([refreshLogs(), refreshDownlinkTraces(imageTestForm.apId), refreshWsStatus([imageTestForm.apId])]);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : '未知错误';
      setImageTestStatus(text);
      setMessage(text);
      setImageTestResult({ ok: false, reason: text });
    } finally {
      setImageTestRunning(false);
    }
  }

  async function callOfficialApiExperiment() {
    const eslCode = officialApi.eslCode || docCommand.labelId || labels[0]?.id || '';
    const terminalResources = ['esl', 'esl_ble', 'esl_wifi', 'nfc', 'pad'];
    const needsEslCode = terminalResources.includes(officialApi.resource)
      && ['direct', 'bind', 'bind_multiple', 'unbind', 'search', 'query_status', 'del'].includes(officialApi.action);
    if (needsEslCode && !eslCode) {
      setMessage('没有目标价签，无法调用官方 API 实验');
      return;
    }
    if (needsEslCode && looksLikeDemoEslCode(eslCode)) {
      setMessage(`当前官方 API 动作已拦截：esl_code=${eslCode} 看起来是演示值，请换成真实价签码，例如 17900170。`);
      return;
    }
    const product = officialProductFromInputs();
    const bindItem = {
      esl_code: eslCode,
      product_code: officialApi.productCode,
      product_inner: officialApi.productCode,
      template_id: String(officialApi.templateId),
      esltemplate_id: Number(officialApi.templateId),
    };
    const directCodeKey = officialApi.resource === 'nfc' ? 'nfc_code' : officialApi.resource === 'pad' ? 'pad_code' : 'esl_code';
    const directItem = {
      [directCodeKey]: eslCode,
      template_id: Number(officialApi.templateId),
      product,
      ...(officialApi.led ? { led: [{ r: 0, g: 100, b: 0, time_on: 100, time: 5 }] } : {}),
    };
    const payload: Record<string, unknown> = {
      store_code: storeCode,
      is_base64: '0',
      sign: officialApi.sign,
    };
    if (officialApi.resource === 'product' && officialApi.action === 'create') {
      Object.assign(payload, {
        pi: officialApi.productCode,
        pc: officialApi.productCode,
        pn: officialApi.productName,
        pp: Number(officialApi.price),
        ...officialCustomFields(),
      });
    } else if (officialApi.resource === 'product' && officialApi.action === 'create_multiple') {
      payload.f1 = [product];
    } else if (officialApi.resource === 'product' && officialApi.action === 'del_multiple') {
      payload.f1 = [officialApi.productCode];
    } else if (officialApi.resource === 'product' && officialApi.action === 'query_with_code') {
      payload.f1 = [officialApi.productCode];
    } else if (officialApi.resource === 'productadjust' && officialApi.action === 'create_order') {
      payload.f1 = `${officialApi.productCode || 'ADJ'}-${Date.now().toString(36)}`;
      payload.f2 = `${officialApi.productName || 'adjust'} 调价单`;
      payload.f3 = storeCode;
      payload.f4 = '1,2,3,4,5,6,7';
      payload.f5 = '00:00';
      payload.f6 = '23:59';
      payload.f7 = [{ pc: officialApi.productCode, pp: Number(officialApi.price) }];
    } else if (officialApi.resource === 'productadjust' && (officialApi.action === 'del_order' || officialApi.action === 'adjust_task')) {
      payload.f1 = officialApi.productCode;
    } else if (officialApi.resource === 'store' && officialApi.action === 'create') {
      payload.f1 = storeCode;
      payload.f2 = `STORE-${storeCode}`;
      payload.f3 = 'API experiment store address';
    } else if (officialApi.resource === 'store' && officialApi.action === 'set') {
      payload.store_name = `STORE-${storeCode}`;
      payload.store_address = 'API experiment store address';
      payload.store_api = { api_enabled: 1, api_code: officialApi.apiName };
      payload.store_filter = { method: 'b', list: [{ d: eslCode, pid: '0000' }] };
    } else if (officialApi.resource === 'user' && officialApi.action === 'create') {
      payload.user_account = officialApi.productCode || 'user001';
      payload.user_password = officialApi.productCode || 'user001';
      payload.user_name = officialApi.productName || 'API User';
      payload.user_mobile = '12345678';
    } else if (officialApi.resource === 'user' && officialApi.action === 'delete') {
      payload.user_account = officialApi.productCode || 'user001';
    } else if (officialApi.action === 'direct') {
      payload.f1 = [directItem];
    } else if (officialApi.action === 'bind') {
      payload.f1 = eslCode;
      payload.f2 = officialApi.productCode;
      payload.f3 = String(officialApi.templateId);
    } else if (officialApi.action === 'bind_multiple') {
      payload.f1 = [bindItem];
    } else if (officialApi.action === 'unbind') {
      payload.f1 = officialApi.resource === 'esl_ble' || officialApi.resource === 'esl_wifi' || officialApi.resource === 'pad' ? eslCode : [eslCode];
    } else if (officialApi.action === 'del') {
      payload.f1 = [eslCode];
    } else if (officialApi.action === 'bind_task' || officialApi.action === 'sync') {
      // No extra fields.
    } else if (officialApi.action === 'search') {
      payload.f1 = [eslCode];
    } else if (officialApi.action === 'query_status') {
      payload.f1 = '1';
      payload.f2 = '10';
      payload.f3 = [eslCode];
    } else if (officialApi.action === 'query') {
      payload.f1 = '1';
      payload.f2 = '20';
    } else if (officialApi.action === 'query_count') {
      // query_count only needs store_code/is_base64/sign.
    } else if (officialApi.resource === 'query' && officialApi.action === 'env') {
      delete payload.store_code;
      delete payload.is_base64;
      delete payload.sign;
    } else {
      payload.f1 = [directItem];
    }

    const targetApId = docCommand.apId || selectedCommandAp?.id || selectedApId || aps[0]?.id || '';
    const shouldWatchDownlink = ['esl', 'esl_ble', 'esl_wifi'].includes(officialApi.resource)
      && ['direct', 'bind_task', 'search', 'sync'].includes(officialApi.action);
    const beforeCaptures = targetApId && shouldWatchDownlink ? await loadOfficialDownlinks(targetApId).catch(() => []) : [];
    const beforeIds = new Set(beforeCaptures.map((capture) => capture.id));

    setOfficialWatch('');
    setMessage(`正在调用官方 API：${officialApi.resource}/${officialApi.action}`);
    try {
      const result = await api<OfficialApiResult>('/api/official-api/call', {
        method: 'POST',
        body: JSON.stringify({
          apiName: officialApi.apiName,
          resource: officialApi.resource,
          action: officialApi.action,
          method: officialApi.resource === 'query' || officialApi.action === 'query' || officialApi.action === 'query_count' ? 'GET' : 'POST',
          payload,
          query: payload,
        }),
      });
      setOfficialApiResult(result);
      setMessage(`官方 API ${result.ok ? '已返回' : '失败'}：${result.status}`);
      await refreshCommandExperiment();
      if (targetApId && shouldWatchDownlink && result.ok) {
        await watchOfficialDownlink(targetApId, beforeIds);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : '未知错误';
      setOfficialApiResult({ ok: false, status: 0, url: '', error: text });
      setMessage(text);
    }
  }

  async function callOfficialApi(resource: string, action: string, payload: Record<string, unknown>, method: 'GET' | 'POST' = 'POST') {
    return api<OfficialApiResult>('/api/official-api/call', {
      method: 'POST',
      body: JSON.stringify({
        apiName: officialApi.apiName,
        resource,
        action,
        method,
        payload,
        query: payload,
      }),
    });
  }

  function officialCommonPayload() {
    return {
      store_code: storeCode,
      is_base64: '0',
      sign: officialApi.sign,
    };
  }

  function officialCustomFields(overrides: Record<string, string> = {}) {
    const fields: Record<string, unknown> = {};
    officialApi.customFieldsText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const separatorIndex = line.includes('=') ? line.indexOf('=') : line.indexOf(':');
        if (separatorIndex < 0) {
          return;
        }
        const rawKey = line.slice(0, separatorIndex).trim().replace(/^#/, '');
        const value = line.slice(separatorIndex + 1).trim();
        const match = rawKey.match(/^(?:field)?(\d{1,2})$/i) ?? rawKey.match(/^f(\d{1,2})$/i);
        if (!match) {
          fields[rawKey] = value;
          return;
        }
        const index = Number(match[1]);
        if (index >= 1 && index <= 20) {
          fields[`f${index}`] = value;
          fields[`field${index}`] = value;
        }
      });

    Object.entries(overrides).forEach(([key, value]) => {
      const normalizedKey = key.replace(/^#/, '');
      const match = normalizedKey.match(/^f?(\d{1,2})$/i) ?? normalizedKey.match(/^field(\d{1,2})$/i);
      if (match) {
        const index = Number(match[1]);
        fields[`f${index}`] = value;
        fields[`field${index}`] = value;
        return;
      }
      fields[normalizedKey] = value;
    });
    return fields;
  }

  function officialProductFromInputs(fieldOverrides: Record<string, string> = {}) {
    return {
      pc: officialApi.productCode,
      pn: officialApi.productName,
      pp: Number(officialApi.price),
      ...officialCustomFields(fieldOverrides),
    };
  }

  function buildOfficialProduct(prefix: string, suffix: string, priceOffset = 0) {
    const price = Number((Number(officialApi.price || 1) + priceOffset).toFixed(2));
    const product: Record<string, unknown> = {
      pi: `${prefix}-INNER-${suffix}`,
      pc: `${prefix}-CODE-${suffix}`,
      pn: `${prefix} 商品 ${suffix}`,
      ps: `${prefix} SPEC ${suffix}`,
      pg: `${prefix} GRADE`,
      pu: '盒',
      pp: price,
      vp: Number((price + 1).toFixed(2)),
      pop: Number((price + 10).toFixed(2)),
      po: 'China',
      pm: `${prefix} Maker`,
      promotion: '1',
      pqr: `https://example.com/${prefix}/${suffix}`,
      extend: {
        e001: `${prefix}-E001-${suffix}`,
        e002: `${prefix}-E002-${suffix}`,
        e003: `${prefix}-E003-${suffix}`,
        e004: `${prefix}-E004-${suffix}`,
        e005: `${prefix}-E005-${suffix}`,
        e006: `${prefix}-E006-${suffix}`,
        e007: `${prefix}-E007-${suffix}`,
        e008: `${prefix}-E008-${suffix}`,
      },
    };
    for (let index = 1; index <= 20; index += 1) {
      product[`f${index}`] = `${prefix}-F${index}-${suffix}`;
      product[`field${index}`] = `${prefix}-F${index}-${suffix}`;
    }
    return product;
  }

  function asObject(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  }

  function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  function firstObject(value: unknown) {
    const direct = asObject(value);
    if (direct) return direct;
    const first = asArray(value)[0];
    return asObject(first);
  }

  function findTemplateInResponse(value: unknown, templateId: number) {
    return asArray(value).find((item) => asObject(item)?.id === templateId || Number(asObject(item)?.id) === templateId);
  }

  async function runOfficialStateDiagnosis(productCodeOverride?: string, templateIdOverride?: number) {
    const eslCode = officialApi.eslCode || docCommand.labelId || labels[0]?.id || '';
    const productCode = productCodeOverride || officialApi.productCode || '';
    const templateId = Number(templateIdOverride || variableTemplateId || officialApi.templateId);
    if (!eslCode) {
      setMessage('状态诊断需要 esl_code');
      return undefined;
    }
    const common = officialCommonPayload();
    const diagnosis: OfficialDiagnosisResult = {
      startedAt: new Date().toISOString(),
      eslCode,
      productCode,
      templateId,
      checks: [],
      findings: [],
    };
    const runCheck = async (name: string, resource: string, action: string, payload: Record<string, unknown>, method: 'GET' | 'POST' = 'POST') => {
      setOfficialWatch(`状态诊断：${name}...`);
      const check = await callOfficialApi(resource, action, payload, method);
      diagnosis.checks.push({
        name,
        ok: check.ok,
        status: check.status,
        request: check.request,
        response: check.response,
        error: check.error,
      });
      setOfficialDiagnosis({ ...diagnosis, checks: [...diagnosis.checks], findings: [...diagnosis.findings] });
      return check;
    };

    setOfficialDiagnosis(diagnosis);
    setMessage('开始官方状态诊断');
    const count = await runCheck('1 esl/query_count 在线统计', 'esl', 'query_count', common, 'GET');
    const status = await runCheck('2 esl/query_status 指定价签', 'esl', 'query_status', {
      ...common,
      f1: '1',
      f2: '20',
      f3: [eslCode],
    });
    const product = productCode
      ? await runCheck('3 product/query_with_code 商品确认', 'product', 'query_with_code', { ...common, f1: [productCode] })
      : undefined;
    const templates = await runCheck('4 template/query 模板列表', 'template', 'query', { ...common, f1: '1', f2: '100' }, 'GET');

    const countObject = asObject(count.response);
    const onlineCount = countObject?.online_count;
    if (onlineCount !== undefined) {
      diagnosis.findings.push(`官方 esl 在线数：${String(onlineCount)}`);
    }

    const statusItem = firstObject(status.response);
    if (statusItem) {
      const nestedProduct = asObject(statusItem.product);
      const rawProduct = statusItem.product_code ?? statusItem.product_inner ?? nestedProduct?.pc ?? statusItem.pc;
      const rawTemplate = statusItem.esltemplate_id ?? statusItem.template_id ?? statusItem.esl_template_id;
      diagnosis.findings.push(`价签状态字段：product=${String(rawProduct ?? '-')}，template=${String(rawTemplate ?? '-')}，online=${String(statusItem.online ?? statusItem.status ?? '-')}`);
    } else {
      diagnosis.findings.push('query_status 没返回可识别的价签行；可能该接口分页/字段规则和文档不同。');
    }

    const productItem = product ? firstObject(product.response) : undefined;
    if (productItem) {
      diagnosis.findings.push(`商品字段：pc=${String(productItem.product_code ?? productItem.pc ?? '-')}，pn=${String(productItem.product_name ?? productItem.pn ?? '-')}，pp=${String(productItem.product_price ?? productItem.pp ?? '-')}`);
    } else if (productCode) {
      diagnosis.findings.push(`商品 ${productCode} 没有被 product/query_with_code 查到。`);
    }

    const templateItem = findTemplateInResponse(templates.response, templateId);
    if (templateItem) {
      const template = asObject(templateItem);
      diagnosis.findings.push(`模板字段：id=${String(template?.id)}，name=${String(template?.esltemplate_name ?? '-')}，type=${String(template?.esltype_code ?? '-')}，preview=${String(template?.image ?? '-')}`);
    } else {
      diagnosis.findings.push(`template/query 没在前 100 条里找到 template_id=${templateId}。`);
    }

    setOfficialDiagnosis({ ...diagnosis, checks: [...diagnosis.checks], findings: [...diagnosis.findings] });
    setOfficialWatch('状态诊断完成。重点看价签状态里的 product/template 是否真的变了。');
    setMessage('官方状态诊断完成');
    return diagnosis;
  }

  async function runOfficialBindPipeline() {
    const apId = docCommand.apId || selectedCommandAp?.id || selectedApId || aps[0]?.id || '';
    const eslCode = officialApi.eslCode || docCommand.labelId || labels[0]?.id || '';
    const templateId = Number(variableTemplateId || officialApi.templateId);
    if (!apId || !eslCode || !Number.isFinite(templateId)) {
      setMessage('绑定链路实验需要 AP、价签编号和有效 template_id');
      return;
    }

    const suffix = Date.now().toString(36);
    const product = buildOfficialProduct('BIND', suffix, 7.77);
    const result: OfficialBindPipelineResult = {
      startedAt: new Date().toISOString(),
      apId,
      eslCode,
      templateId,
      product,
      steps: [],
      message: '准备执行 product/create -> query_with_code -> esl/bind -> esl/bind_task',
    };
    const updateResult = (message: string) => {
      result.message = message;
      setBindPipelineResult({ ...result, steps: [...result.steps] });
      setOfficialWatch(message);
    };
    const runStep = async (name: string, resource: string, action: string, payload: Record<string, unknown>, method: 'GET' | 'POST' = 'POST') => {
      updateResult(`${name}：调用 ${resource}/${action}...`);
      const stepResult = await callOfficialApi(resource, action, payload, method);
      result.steps.push({
        name,
        ok: stepResult.ok,
        status: stepResult.status,
        request: stepResult.request,
        response: stepResult.response,
        error: stepResult.error,
      });
      updateResult(`${name}：${stepResult.ok ? '成功' : '失败'} ${stepResult.status}`);
      return stepResult;
    };

    setBindPipelineRunning(true);
    setBindPipelineResult(result);
    setCaptureDiff(null);
    setMessage('开始官方绑定链路实验');
    try {
      const before = await loadOfficialDownlinks(apId).catch(() => []);
      const beforeIds = new Set(before.map((capture) => capture.id));
      const common = officialCommonPayload();

      await runStep('1 商品创建/更新', 'product', 'create', {
        ...common,
        ...product,
      });

      await runStep('2 商品查询确认', 'product', 'query_with_code', {
        ...common,
        f1: [product.pc],
      });

      await runStep('3 价签绑定商品', 'esl', 'bind', {
        ...common,
        f1: eslCode,
        f2: product.pc,
        f3: String(templateId),
      });

      await runStep('4 触发绑定任务', 'esl', 'bind_task', common);

      updateResult('绑定任务已触发，等待 READ_WRITE_SVC 下行包...');
      const capture = await waitForReadWriteCapture(apId, beforeIds, 240_000, (elapsedSeconds, freshAny) => {
        updateResult(freshAny
          ? `等待 ${elapsedSeconds}/240 秒：看到 ${freshAny.commandType ?? freshAny.kind}，还不是 READ_WRITE_SVC`
          : `等待 ${elapsedSeconds}/240 秒：暂无新的 READ_WRITE_SVC`);
      });

      result.capture = capture ? summarizeCaptureForBatch(capture) : undefined;
      updateResult(capture
        ? `绑定链路已捕获 ${capture.id}，fp ${capture.fingerprint}`
        : '绑定链路 240 秒内没有捕获到 READ_WRITE_SVC');

      if (capture) {
        setSelectedCaptureId(capture.id);
        setRightDiffCaptureId(capture.id);
      }
      await runOfficialStateDiagnosis(String(product.pc), templateId);
      setOfficialApiResult({
        ok: Boolean(capture),
        status: capture ? 200 : 202,
        url: 'official-bind-pipeline',
        request: { product, eslCode, templateId },
        response: result,
      });
      await refreshCommandExperiment();
      setMessage(result.message);
    } catch (error) {
      const text = error instanceof Error ? error.message : '官方绑定链路实验失败';
      updateResult(text);
      setMessage(text);
    } finally {
      setBindPipelineRunning(false);
    }
  }

  async function runOfficialAssociationExperiments() {
    const apId = docCommand.apId || selectedCommandAp?.id || selectedApId || aps[0]?.id || '';
    const eslCode = officialApi.eslCode || docCommand.labelId || labels[0]?.id || '';
    const templateId = Number(variableTemplateId || officialApi.templateId);
    if (!apId || !eslCode || !Number.isFinite(templateId)) {
      setMessage('关联规则实验需要 AP、价签编号和有效 template_id');
      return;
    }

    const common = officialCommonPayload();
    const variants = [
      {
        variant: 'direct + extend',
        product: buildOfficialProduct('DIRECT', Date.now().toString(36), 31.01),
        steps: [
          (product: Record<string, unknown>) => ({
            name: 'direct 携带完整 product/extend',
            resource: 'esl',
            action: 'direct',
            payload: {
              ...common,
              f1: [{
                esl_code: eslCode,
                template_id: templateId,
                product,
              }],
            },
          }),
        ],
      },
      {
        variant: 'bind 单条 + 完整商品字段',
        product: buildOfficialProduct('BINDONE', Date.now().toString(36), 41.01),
        steps: [
          (product: Record<string, unknown>) => ({
            name: 'product/create 完整字段',
            resource: 'product',
            action: 'create',
            payload: { ...common, ...product },
          }),
          (product: Record<string, unknown>) => ({
            name: 'product/query_with_code',
            resource: 'product',
            action: 'query_with_code',
            payload: { ...common, f1: [product.pc] },
          }),
          (product: Record<string, unknown>) => ({
            name: 'esl/bind 单条',
            resource: 'esl',
            action: 'bind',
            payload: { ...common, f1: eslCode, f2: product.pc, f3: String(templateId) },
          }),
          () => ({
            name: 'esl/bind_task',
            resource: 'esl',
            action: 'bind_task',
            payload: common,
          }),
        ],
      },
      {
        variant: 'bind_multiple + esltemplate_id',
        product: buildOfficialProduct('BINDMULTI', Date.now().toString(36), 51.01),
        steps: [
          (product: Record<string, unknown>) => ({
            name: 'product/create 完整字段',
            resource: 'product',
            action: 'create',
            payload: { ...common, ...product },
          }),
          (product: Record<string, unknown>) => ({
            name: 'product/query_with_code',
            resource: 'product',
            action: 'query_with_code',
            payload: { ...common, f1: [product.pc] },
          }),
          (product: Record<string, unknown>) => ({
            name: 'esl/bind_multiple',
            resource: 'esl',
            action: 'bind_multiple',
            payload: {
              ...common,
              f1: [{
                esl_code: eslCode,
                product_code: product.pc,
                esltemplate_id: templateId,
              }],
            },
          }),
          () => ({
            name: 'esl/bind_task',
            resource: 'esl',
            action: 'bind_task',
            payload: common,
          }),
        ],
      },
    ];

    setBindPipelineRunning(true);
    setAssociationResults([]);
    setCaptureDiff(null);
    setMessage('开始关联规则批量实验');
    try {
      const results: OfficialBindPipelineResult[] = [];
      for (const variant of variants) {
        const result: OfficialBindPipelineResult = {
          variant: variant.variant,
          startedAt: new Date().toISOString(),
          apId,
          eslCode,
          templateId,
          product: variant.product,
          steps: [],
          message: `${variant.variant} 准备开始`,
        };
        const update = (message: string) => {
          result.message = message;
          setAssociationResults([...results, { ...result, steps: [...result.steps] }]);
          setOfficialWatch(message);
        };
        update(`${variant.variant}：开始`);
        const before = await loadOfficialDownlinks(apId).catch(() => []);
        const beforeIds = new Set(before.map((capture) => capture.id));

        for (const buildStep of variant.steps) {
          const step = buildStep(variant.product);
          update(`${variant.variant}：调用 ${step.name}`);
          const stepResult = await callOfficialApi(step.resource, step.action, step.payload);
          result.steps.push({
            name: step.name,
            ok: stepResult.ok,
            status: stepResult.status,
            request: stepResult.request,
            response: stepResult.response,
            error: stepResult.error,
          });
          update(`${variant.variant}：${step.name} ${stepResult.ok ? '成功' : '失败'} ${stepResult.status}`);
        }

        update(`${variant.variant}：等待 READ_WRITE_SVC`);
        const capture = await waitForReadWriteCapture(apId, beforeIds, 180_000, (elapsedSeconds, freshAny) => {
          update(freshAny
            ? `${variant.variant}：等待 ${elapsedSeconds}/180 秒，看到 ${freshAny.commandType ?? freshAny.kind}，还不是 READ_WRITE_SVC`
            : `${variant.variant}：等待 ${elapsedSeconds}/180 秒，暂无新的 READ_WRITE_SVC`);
        });
        result.capture = capture ? summarizeCaptureForBatch(capture) : undefined;
        update(capture
          ? `${variant.variant}：捕获 ${capture.id}，fp ${capture.fingerprint}`
          : `${variant.variant}：180 秒内没有捕获 READ_WRITE_SVC`);
        if (capture) {
          setSelectedCaptureId(capture.id);
          setRightDiffCaptureId(capture.id);
        }
        results.push({ ...result, steps: [...result.steps] });
        setAssociationResults([...results]);
        await sleep(5000);
      }
      await refreshCommandExperiment();
      setMessage('关联规则批量实验完成');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '关联规则批量实验失败');
    } finally {
      setBindPipelineRunning(false);
    }
  }

  async function runAutoTemplateSamples() {
    const apId = docCommand.apId || selectedCommandAp?.id || selectedApId || aps[0]?.id || '';
    const eslCode = officialApi.eslCode || docCommand.labelId || labels[0]?.id || '';
    const templateId = Number(variableTemplateId || officialApi.templateId);
    if (!apId || !eslCode || !Number.isFinite(templateId)) {
      setMessage('自动样本实验需要 AP、价签编号和有效 template_id');
      return;
    }
    if (looksLikeDemoEslCode(eslCode)) {
      setMessage(`自动样本实验已拦截：当前 esl_code=${eslCode} 看起来是演示值，请换成真实价签码，例如 17900170。`);
      return;
    }
    setAutoTemplateSamplesRunning(true);
    setAutoTemplateSamplesResult(null);
    setMessage(`开始自动样本实验：AP=${apId}，esl=${eslCode}，template=${templateId}，程序会自己调官方接口并等待抓包`);
    try {
      const values = officialApi.customFieldsText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const separatorIndex = line.includes('=') ? line.indexOf('=') : line.indexOf(':');
          return separatorIndex >= 0 ? line.slice(separatorIndex + 1).trim() : line;
        })
        .filter(Boolean);
      const result = await api<OfficialAutoTemplateSamplesResult>('/api/official-api/auto-template-samples', {
        method: 'POST',
        body: JSON.stringify({
          apiName: officialApi.apiName,
          apId,
          eslCode,
          templateId,
          sign: officialApi.sign,
          storeCode,
          fieldName: 'f1',
          values: values.length > 0 ? values : ['AAAAA', 'AAAAB', 'AAAAC'],
          productCodePrefix: officialApi.productCode || 'AUTO',
          productNamePrefix: officialApi.productName || 'AUTO',
          basePrice: Number(officialApi.price || 19.9),
          timeoutMs: 180000,
        }),
      });
      setAutoTemplateSamplesResult(result);
      const lastCaptureId = result.results
        .map((row) => (row.capture && typeof row.capture === 'object' ? (row.capture as Record<string, unknown>).id : undefined))
        .filter((value): value is string => Boolean(value))
        .at(-1);
      if (lastCaptureId) {
        setSelectedCaptureId(lastCaptureId);
        setRightDiffCaptureId(lastCaptureId);
      }
      await refreshCommandExperiment();
      setMessage(`自动样本实验完成，共处理 ${result.results.length} 条值`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '自动样本实验失败');
    } finally {
      setAutoTemplateSamplesRunning(false);
    }
  }

  async function watchOfficialDownlink(apId: string, beforeIds: Set<string>) {
    const startedAt = Date.now();
    setOfficialWatch('官方 API 已返回，开始监听 180 秒：等待新的 READ_WRITE_SVC 下行包...');
    for (let index = 1; index <= 36; index += 1) {
      await sleep(5000);
      const captures = await loadOfficialDownlinks(apId).catch(() => []);
      setOfficialDownlinks(captures);
      const freshReadWrite = captures.find((capture) => !beforeIds.has(capture.id) && capture.commandType === 'READ_WRITE_SVC');
      if (freshReadWrite) {
        setSelectedCaptureId(freshReadWrite.id);
        setLeftDiffCaptureId((current) => current || freshReadWrite.id);
        setOfficialWatch(`已捕获新的 READ_WRITE_SVC：${freshReadWrite.id}，${freshReadWrite.bytes} bytes，延迟 ${Math.round((Date.now() - startedAt) / 1000)} 秒。`);
        await refreshCommandExperiment();
        return;
      }
      const freshAny = captures.find((capture) => !beforeIds.has(capture.id));
      const suffix = freshAny ? `已看到新 ${freshAny.commandType ?? freshAny.kind}，但还不是 READ_WRITE_SVC。` : '暂未看到新官方下行包。';
      setOfficialWatch(`监听中 ${index * 5}/180 秒：${suffix}`);
      await refreshLogs();
    }
    setOfficialWatch('180 秒内没有捕获到新的 READ_WRITE_SVC。说明官方 API 返回成功，但没有通过当前这条代理 WebSocket 下发刷屏包；检查基站是否还连着本机地址，或官方是否把任务发到了另一条连接。');
  }

  async function waitForReadWriteCapture(
    apId: string,
    beforeIds: Set<string>,
    timeoutMs = 180_000,
    onProgress?: (elapsedSeconds: number, freshAny?: OfficialDownlinkCapture) => void,
  ) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      await sleep(5000);
      const captures = await loadOfficialDownlinks(apId).catch(() => []);
      setOfficialDownlinks(captures);
      const freshReadWrite = captures.find((capture) => !beforeIds.has(capture.id) && capture.commandType === 'READ_WRITE_SVC');
      if (freshReadWrite) {
        return freshReadWrite;
      }
      const freshAny = captures.find((capture) => !beforeIds.has(capture.id));
      onProgress?.(Math.round((Date.now() - startedAt) / 1000), freshAny);
      await refreshLogs();
    }
    return undefined;
  }

  async function callOfficialDirectForTemplate(
    templateId: number,
    productCode: string,
    productName: string,
    price: number,
    fieldOverrides: Record<string, string> = {},
  ) {
    const eslCode = officialApi.eslCode || docCommand.labelId || labels[0]?.id || '';
    const payload = {
      store_code: storeCode,
      is_base64: '0',
      sign: officialApi.sign,
      f1: [{
        esl_code: eslCode,
        template_id: templateId,
        product: {
          pc: productCode,
          pn: productName,
          pp: price,
          ...officialCustomFields(fieldOverrides),
        },
        ...(officialApi.led ? { led: [{ r: 0, g: 100, b: 0, time_on: 100, time: 5 }] } : {}),
      }],
    };
    return api<OfficialApiResult>('/api/official-api/call', {
      method: 'POST',
      body: JSON.stringify({
        apiName: officialApi.apiName,
        resource: 'esl',
        action: 'direct',
        method: 'POST',
        payload,
        query: payload,
      }),
    });
  }

  async function callOfficialDirectForTemplateWithRetry(
    templateId: number,
    productCode: string,
    productName: string,
    price: number,
    fieldOverrides: Record<string, string>,
    onProgress: (message: string, result?: OfficialApiResult) => void,
  ) {
    let lastResult: OfficialApiResult | undefined;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      onProgress(`第 ${attempt}/3 次调用官方 esl/direct...`, lastResult);
      try {
        const result = await callOfficialDirectForTemplate(templateId, productCode, productName, price, fieldOverrides);
        lastResult = result;
        onProgress(
          result.ok
            ? `官方 API 第 ${attempt}/3 次返回 ${result.status}，等待 READ_WRITE_SVC 下行包`
            : `官方 API 第 ${attempt}/3 次失败：${result.status}${attempt < 3 ? '，8 秒后重试' : ''}`,
          result,
        );
        if (result.ok) {
          return result;
        }
      } catch (error) {
        lastResult = {
          ok: false,
          status: 0,
          url: '',
          error: error instanceof Error ? error.message : String(error),
        };
        onProgress(`官方 API 第 ${attempt}/3 次异常：${lastResult.error}${attempt < 3 ? '，8 秒后重试' : ''}`, lastResult);
      }
      if (attempt < 3) {
        await sleep(8000);
      }
    }
    return lastResult ?? {
      ok: false,
      status: 0,
      url: '',
      error: '官方 API 没有返回结果',
    };
  }

  async function runTemplateBatchTest() {
    const apId = docCommand.apId || selectedCommandAp?.id || selectedApId || aps[0]?.id || '';
    const eslCode = officialApi.eslCode || docCommand.labelId || labels[0]?.id || '';
    const templateIds = templateBatchIds
      .split(/[,\s，]+/)
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item) && item > 0);
    if (!apId || !eslCode || templateIds.length === 0) {
      setMessage('模板批量测试需要 AP、价签编号和 template_id 列表');
      return;
    }

    setTemplateBatchRunning(true);
    setTemplateBatchResults([]);
    setMessage(`开始模板 A/B 批量测试：${templateIds.join(', ')}`);
    try {
      const rows: TemplateBatchResult[] = [];
      for (const [index, templateId] of templateIds.entries()) {
        const productCode = `${officialApi.productCode || 'DIFF'}-T${templateId}-${Date.now().toString(36)}`;
        const productName = `${officialApi.productName || 'Template Test'} T${templateId} ${index + 1}`;
        const price = Number((Number(officialApi.price || 1) + index + 0.11).toFixed(2));
        const before = await loadOfficialDownlinks(apId).catch(() => []);
        const beforeIds = new Set(before.map((capture) => capture.id));
        rows.push({
          templateId,
          productCode,
          productName,
          price,
          fieldOverrides: { f1: `T${templateId}-F1-${index + 1}`, f2: `T${templateId}-F2-${index + 1}` },
          status: 'pending',
          message: '官方 API 已发送，等待 READ_WRITE_SVC',
        });
        setTemplateBatchResults([...rows]);
        setOfficialWatch(`模板 ${templateId}：调用 esl/direct 并等待 READ_WRITE_SVC...`);
        const apiResult = await callOfficialDirectForTemplateWithRetry(
          templateId,
          productCode,
          productName,
          price,
          rows[rows.length - 1].fieldOverrides ?? {},
          (progressMessage, progressResult) => {
            rows[rows.length - 1] = {
              ...rows[rows.length - 1],
              api: progressResult,
              message: progressMessage,
            };
            setTemplateBatchResults([...rows]);
            setOfficialWatch(`模板 ${templateId}：${progressMessage}`);
          },
        );
        if (!apiResult.ok) {
          rows[rows.length - 1] = {
            ...rows[rows.length - 1],
            api: apiResult,
            message: `官方 API 三次失败：${apiResult.status || apiResult.error || 'unknown'}，仍继续监听 180 秒，排查是否已被官方接收并延迟下发`,
          };
          setTemplateBatchResults([...rows]);
        }
        const capture = await waitForReadWriteCapture(apId, beforeIds, 180_000, (elapsedSeconds, freshAny) => {
          rows[rows.length - 1] = {
            ...rows[rows.length - 1],
            api: apiResult,
            message: freshAny
              ? `等待 ${elapsedSeconds}/180 秒：看到 ${freshAny.commandType ?? freshAny.kind}，还不是 READ_WRITE_SVC`
              : `等待 ${elapsedSeconds}/180 秒：暂无新的 READ_WRITE_SVC`,
          };
          setTemplateBatchResults([...rows]);
          setOfficialWatch(`模板 ${templateId}：${rows[rows.length - 1].message}`);
        });
        rows[rows.length - 1] = {
          ...rows[rows.length - 1],
          api: apiResult,
          capture: capture ? summarizeCaptureForBatch(capture) : undefined,
          status: capture ? (apiResult.ok ? 'captured' : 'api_failed_captured') : (apiResult.ok ? 'timeout' : 'api_failed'),
          message: capture
            ? `${apiResult.ok ? '捕获' : 'API 失败但仍捕获'} ${capture.id}，fp ${capture.fingerprint}`
            : `${apiResult.ok ? '' : 'API 三次失败，且'}180 秒内没有捕获到 READ_WRITE_SVC`,
        };
        setTemplateBatchResults([...rows]);
        await sleep(3000);
      }
      await refreshCommandExperiment();
      setMessage('模板 A/B 批量测试完成');
      setOfficialWatch('模板 A/B 批量测试完成。重点看 fingerprint 是否随 template_id 改变。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '模板批量测试失败');
    } finally {
      setTemplateBatchRunning(false);
    }
  }

  async function runVariableBatchTest() {
    const apId = docCommand.apId || selectedCommandAp?.id || selectedApId || aps[0]?.id || '';
    const eslCode = officialApi.eslCode || docCommand.labelId || labels[0]?.id || '';
    const templateId = Number(variableTemplateId || officialApi.templateId);
    if (!apId || !eslCode || !Number.isFinite(templateId)) {
      setMessage('变量 A/B 测试需要 AP、价签编号和有效 template_id');
      return;
    }

    const suffix = Date.now().toString(36);
    const variants = [
      {
        variant: 'A 基准',
        productCode: `A-${suffix}`,
        productName: 'APPLE',
        price: 11.11,
        fieldOverrides: { f1: `A-F1-${suffix}`, f2: `A-F2-${suffix}` },
      },
      {
        variant: 'B 长名称高价',
        productCode: `B-${suffix}`,
        productName: 'BBBBBBBBBBBBBBBB',
        price: 88.88,
        fieldOverrides: { f1: `B-F1-CHANGED-${suffix}`, f2: `B-F2-CHANGED-${suffix}` },
      },
    ];

    setVariableBatchRunning(true);
    setVariableBatchResults([]);
    setCaptureDiff(null);
    setMessage(`开始同模板变量 A/B 测试：template ${templateId}`);
    try {
      const rows: VariableBatchResult[] = [];
      for (const item of variants) {
        const before = await loadOfficialDownlinks(apId).catch(() => []);
        const beforeIds = new Set(before.map((capture) => capture.id));
        rows.push({
          templateId,
          ...item,
          status: 'pending',
          message: '官方 API 已发送，等待 READ_WRITE_SVC',
        });
        setVariableBatchResults([...rows]);
        setOfficialWatch(`${item.variant}：调用 template ${templateId} 并等待 READ_WRITE_SVC...`);
        const apiResult = await callOfficialDirectForTemplateWithRetry(
          templateId,
          item.productCode,
          item.productName,
          item.price,
          item.fieldOverrides,
          (progressMessage, progressResult) => {
            rows[rows.length - 1] = {
              ...rows[rows.length - 1],
              api: progressResult,
              message: progressMessage,
            };
            setVariableBatchResults([...rows]);
            setOfficialWatch(`${item.variant}：${progressMessage}`);
          },
        );
        if (!apiResult.ok) {
          rows[rows.length - 1] = {
            ...rows[rows.length - 1],
            api: apiResult,
            message: `官方 API 三次失败：${apiResult.status || apiResult.error || 'unknown'}，仍继续监听 180 秒，排查是否已被官方接收并延迟下发`,
          };
          setVariableBatchResults([...rows]);
        }
        const capture = await waitForReadWriteCapture(apId, beforeIds, 180_000, (elapsedSeconds, freshAny) => {
          rows[rows.length - 1] = {
            ...rows[rows.length - 1],
            api: apiResult,
            message: freshAny
              ? `等待 ${elapsedSeconds}/180 秒：看到 ${freshAny.commandType ?? freshAny.kind}，还不是 READ_WRITE_SVC`
              : `等待 ${elapsedSeconds}/180 秒：暂无新的 READ_WRITE_SVC`,
          };
          setVariableBatchResults([...rows]);
          setOfficialWatch(`${item.variant}：${rows[rows.length - 1].message}`);
        });
        rows[rows.length - 1] = {
          ...rows[rows.length - 1],
          api: apiResult,
          capture: capture ? summarizeCaptureForBatch(capture) : undefined,
          status: capture ? (apiResult.ok ? 'captured' : 'api_failed_captured') : (apiResult.ok ? 'timeout' : 'api_failed'),
          message: capture
            ? `${apiResult.ok ? '捕获' : 'API 失败但仍捕获'} ${capture.id}，fp ${capture.fingerprint}`
            : `${apiResult.ok ? '' : 'API 三次失败，且'}180 秒内没有捕获到 READ_WRITE_SVC`,
        };
        setVariableBatchResults([...rows]);
        await sleep(3000);
      }

      const [left, right] = rows.map((row) => row.capture?.id);
      if (left && right) {
        setLeftDiffCaptureId(left);
        setRightDiffCaptureId(right);
        const diff = await api<OfficialDownlinkDiff>(`/api/base-stations/${encodeURIComponent(apId)}/official-downlinks/diff`, {
          method: 'POST',
          body: JSON.stringify({ leftId: left, rightId: right }),
        });
        setCaptureDiff(diff);
        setOfficialWatch(diff.sameFingerprint
          ? `变量 A/B 完成：两个捕获包 fingerprint 一样（${rows[0]?.capture?.fingerprint ?? '-'}），商品字段没有影响图像。`
          : `变量 A/B 完成：fingerprint 已变化，A=${rows[0]?.capture?.fingerprint ?? '-'}，B=${rows[1]?.capture?.fingerprint ?? '-'}。`);
      }
      await refreshCommandExperiment();
      setMessage('同模板变量 A/B 测试完成');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '同模板变量 A/B 测试失败');
    } finally {
      setVariableBatchRunning(false);
    }
  }

  async function runVariableSingleTest(kind: 'A' | 'B') {
    const apId = docCommand.apId || selectedCommandAp?.id || selectedApId || aps[0]?.id || '';
    const eslCode = officialApi.eslCode || docCommand.labelId || labels[0]?.id || '';
    const templateId = Number(variableTemplateId || officialApi.templateId);
    if (!apId || !eslCode || !Number.isFinite(templateId)) {
      setMessage('单独变量捕获需要 AP、价签编号和有效 template_id');
      return;
    }

    const suffix = Date.now().toString(36);
    const item = kind === 'A'
      ? {
        variant: 'A 单独捕获',
        productCode: `A-${suffix}`,
        productName: 'APPLE',
        price: 11.11,
        fieldOverrides: { f1: `A-F1-${suffix}`, f2: `A-F2-${suffix}` },
      }
      : {
        variant: 'B 单独捕获',
        productCode: `B-${suffix}`,
        productName: 'BBBBBBBBBBBBBBBB',
        price: 88.88,
        fieldOverrides: { f1: `B-F1-CHANGED-${suffix}`, f2: `B-F2-CHANGED-${suffix}` },
      };

    const upsertRow = (row: VariableBatchResult) => {
      setVariableBatchResults((current) => {
        const index = current.findIndex((candidate) => candidate.productCode === row.productCode);
        if (index < 0) {
          return [...current, row];
        }
        return current.map((candidate, candidateIndex) => candidateIndex === index ? row : candidate);
      });
    };

    setVariableBatchRunning(true);
    setMessage(`开始${item.variant}：template ${templateId}`);
    try {
      const before = await loadOfficialDownlinks(apId).catch(() => []);
      const beforeIds = new Set(before.map((capture) => capture.id));
      let row: VariableBatchResult = {
        templateId,
        ...item,
        status: 'pending',
        message: '官方 API 已发送，等待 READ_WRITE_SVC',
      };
      upsertRow(row);
      setOfficialWatch(`${item.variant}：调用 template ${templateId} 并等待 READ_WRITE_SVC...`);

      const apiResult = await callOfficialDirectForTemplateWithRetry(
        templateId,
        item.productCode,
        item.productName,
        item.price,
        item.fieldOverrides,
        (progressMessage, progressResult) => {
          row = {
            ...row,
            api: progressResult,
            message: progressMessage,
          };
          upsertRow(row);
          setOfficialWatch(`${item.variant}：${progressMessage}`);
        },
      );

      if (!apiResult.ok) {
        row = {
          ...row,
          api: apiResult,
          message: `官方 API 三次失败：${apiResult.status || apiResult.error || 'unknown'}，仍继续监听 180 秒`,
        };
        upsertRow(row);
      }

      const capture = await waitForReadWriteCapture(apId, beforeIds, 180_000, (elapsedSeconds, freshAny) => {
        row = {
          ...row,
          api: apiResult,
          message: freshAny
            ? `等待 ${elapsedSeconds}/180 秒：看到 ${freshAny.commandType ?? freshAny.kind}，还不是 READ_WRITE_SVC`
            : `等待 ${elapsedSeconds}/180 秒：暂无新的 READ_WRITE_SVC`,
        };
        upsertRow(row);
        setOfficialWatch(`${item.variant}：${row.message}`);
      });

      row = {
        ...row,
        api: apiResult,
        capture: capture ? summarizeCaptureForBatch(capture) : undefined,
        status: capture ? (apiResult.ok ? 'captured' : 'api_failed_captured') : (apiResult.ok ? 'timeout' : 'api_failed'),
        message: capture
          ? `${apiResult.ok ? '捕获' : 'API 失败但仍捕获'} ${capture.id}，fp ${capture.fingerprint}`
          : `${apiResult.ok ? '' : 'API 三次失败，且'}180 秒内没有捕获到 READ_WRITE_SVC`,
      };
      upsertRow(row);

      if (capture) {
        setSelectedCaptureId(capture.id);
        if (kind === 'A') {
          setLeftDiffCaptureId(capture.id);
        } else {
          setRightDiffCaptureId(capture.id);
        }
      }

      await refreshCommandExperiment();
      setMessage(`${item.variant}完成：${row.message}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${item.variant}失败`);
    } finally {
      setVariableBatchRunning(false);
    }
  }

  async function replayOfficialDownlink(captureId = selectedCapture?.id || '') {
    const apId = docCommand.apId || selectedCommandAp?.id || '';
    if (!apId || !captureId) {
      setMessage('没有可重放的官方下行包');
      return;
    }
    setMessage(`正在重放官方下行包：${captureId}`);
    try {
      const result = await api<unknown>(`/api/base-stations/${encodeURIComponent(apId)}/official-downlinks/${encodeURIComponent(captureId)}/replay`, {
        method: 'POST',
        body: JSON.stringify({ targetLabelId: replayTargetLabelId || undefined }),
      });
      setReplayResult(result);
      setMessage('重放请求已发送，观察下发追踪和 AP_REPORT_STATUS');
      await refreshCommandExperiment();
    } catch (error) {
      const text = error instanceof Error ? error.message : '未知错误';
      setReplayResult({ ok: false, error: text });
      setMessage(text);
    }
  }

  async function diffOfficialDownlinks() {
    const apId = docCommand.apId || selectedCommandAp?.id || '';
    if (!apId || !leftDiffCaptureId || !rightDiffCaptureId) {
      setMessage('请选择两个捕获包再对比');
      return;
    }
    setMessage('正在对比两个官方下行包...');
    try {
      const result = await api<OfficialDownlinkDiff>(`/api/base-stations/${encodeURIComponent(apId)}/official-downlinks/diff`, {
        method: 'POST',
        body: JSON.stringify({ leftId: leftDiffCaptureId, rightId: rightDiffCaptureId }),
      });
      setCaptureDiff(result);
      setMessage(result.ok ? '差分完成' : `差分失败：${result.reason ?? '-'}`);
      await refreshLogs();
    } catch (error) {
      const text = error instanceof Error ? error.message : '未知错误';
      setCaptureDiff({ ok: false, reason: text });
      setMessage(text);
    }
  }

  React.useEffect(() => {
    if (tokenReady) {
      Promise.all([refresh(), refreshLogs()]).catch((error: Error) => setMessage(error.message));
    }
  }, [tokenReady]);

  React.useEffect(() => {
    if (tokenReady && aps.length > 0) {
      refreshWsStatus(aps.map((ap) => ap.id)).catch((error: Error) => setMessage(error.message));
    }
  }, [tokenReady, aps.length]);

  React.useEffect(() => {
    if (tokenReady && activeView === 'logs') {
      refreshLogs().catch((error: Error) => setMessage(error.message));
    }
  }, [showAllLogs, activeView]);

  React.useEffect(() => {
    const preferredAp = aps.find((item) => item.id.toLowerCase() === DEFAULT_IMAGE_TEST_AP_ID)
      ?? aps.find((item) => item.status === 'online')
      ?? aps[0];
    const firstRealLabel = labels.find((label) => !looksLikeDemoEslCode(label.id));
    setImageTestForm((current) => ({
      ...current,
      apId: current.apId || preferredAp?.id || '',
      eslCode: current.eslCode && !looksLikeDemoEslCode(current.eslCode) ? current.eslCode : firstRealLabel?.id || '',
    }));
  }, [aps, labels]);

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <RadioTower size={28} />
          <div>
            <strong>Kersen ESL</strong>
            <span>Cloud Console</span>
          </div>
        </div>
        <nav>
          <button className={activeView === 'overview' ? 'active' : ''} onClick={() => setActiveView('overview')}><Activity size={18} /> 总览</button>
          <button className={activeView === 'stations' ? 'active' : ''} onClick={() => setActiveView('stations')}><RadioTower size={18} /> 基站</button>
          <button className={activeView === 'labels' ? 'active' : ''} onClick={() => setActiveView('labels')}><BadgeDollarSign size={18} /> 价签</button>
          <button className={activeView === 'commands' ? 'active' : ''} onClick={() => setActiveView('commands')}><Send size={18} /> 文档指令</button>
          <button className={activeView === 'image-test' ? 'active' : ''} onClick={() => setActiveView('image-test')}><Send size={18} /> 图片测试</button>
          <button className={activeView === 'cloud' ? 'active' : ''} onClick={() => setActiveView('cloud')}><Server size={18} /> 云配置</button>
          <button className={activeView === 'logs' ? 'active' : ''} onClick={() => setActiveView('logs')}><ClipboardList size={18} /> 接入日志</button>
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p>电子价签云平台</p>
            <h1>基站、价签与 MQTT 链路控制台</h1>
            <span className="globalStatus">{message}</span>
          </div>
          <button className="iconButton" onClick={() => refresh()} disabled={!tokenReady} title="刷新">
            <RefreshCcw size={18} />
          </button>
        </header>

        {activeView === 'overview' && (
          <>
            <section className="metrics">
              <article>
                <Store size={20} />
                <span>门店</span>
                <strong>{store?.code ?? storeCode}</strong>
              </article>
              <article>
                <RadioTower size={20} />
                <span>在线基站</span>
                <strong>{aps.filter((ap) => ap.status === 'online').length}/{aps.length}</strong>
              </article>
              <article>
                <BadgeDollarSign size={20} />
                <span>价签</span>
                <strong>{labels.length}</strong>
              </article>
              <article>
                <ShieldCheck size={20} />
                <span>状态</span>
                <strong>{tokenReady ? '已认证' : '未登录'}</strong>
              </article>
            </section>

            <section className="grid">
              <div className="panel loginPanel">
                <h2>平台登录</h2>
                <div className="formGrid">
                  <label>门店编号<input value={storeCode} onChange={(event) => setStoreCode(event.target.value)} /></label>
                  <label>用户名<input value={username} onChange={(event) => setUsername(event.target.value)} /></label>
                  <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
                </div>
                <button className="primary" onClick={() => login().catch((error: Error) => setMessage(error.message))}>
                  <ShieldCheck size={18} /> 登录控制台
                </button>
                <p className="statusLine">{message}</p>
              </div>

              <CloudConfig store={store} storeCode={storeCode} mqttStats={mqttStats} />
            </section>
          </>
        )}

        {activeView === 'cloud' && <CloudConfig store={store} storeCode={storeCode} mqttStats={mqttStats} detailed />}

        {activeView === 'stations' && (
          <>
            <section className="panel">
              <div className="sectionHead">
                <h2>基站</h2>
                <div className="toolbar">
                  <button className="smallButton" onClick={() => refreshWsStatus().catch((error: Error) => setMessage(error.message))}>刷新 WS 状态</button>
                  <button className="smallButton" onClick={() => refreshDownlinkTraces().catch((error: Error) => setMessage(error.message))}>刷新下发追踪</button>
                </div>
              </div>
              <div className="table">
                <span>名称</span><span>状态</span><span>IP</span><span>固件/通道</span><span>最后心跳</span>
                {aps.map((ap) => (
                  <React.Fragment key={ap.id}>
                    <b>{ap.name}</b>
                    <i className={ap.status}>{ap.status} · {wsStatuses[ap.id]?.connected ? 'WS在线' : 'WS离线'}</i>
                    <span>{ap.ip ?? '-'}</span>
                    <span>{ap.firmware ?? '-'} · {ap.channels?.length ?? 0} 通道 · {ap.metrics?.labelsOnline ?? 0} 价签</span>
                    <span>{ap.lastSeenAt ? new Date(ap.lastSeenAt).toLocaleString() : '-'}</span>
                  </React.Fragment>
                ))}
              </div>
            </section>

            <section className="panel">
              <h2>下发追踪</h2>
              <p className="statusLine">`socket_write_ok` 只代表数据已写入 WebSocket socket；只有 `ap_reply_seen` 才代表基站有相关回包。</p>
              <div className="table traceTable">
                <span>时间</span><span>状态</span><span>类型</span><span>价签</span><span>字节/队列</span>
                {downlinkTraces.map((trace) => (
                  <React.Fragment key={trace.id}>
                    <span>{new Date(trace.updatedAt).toLocaleTimeString()}</span>
                    <i className={trace.status.includes('error') || trace.status.includes('missing') ? 'offline' : trace.status === 'ap_reply_seen' ? 'online' : ''}>{trace.status}</i>
                    <span>{trace.commandType ?? trace.transport}</span>
                    <span>{trace.labelId ?? '-'}</span>
                    <span>{trace.bytes ?? '-'} / {trace.queueId ?? '-'}</span>
                  </React.Fragment>
                ))}
              </div>
            </section>

            <section className="panel">
              <h2>WebSocket 原始命令</h2>
              <div className="commandGrid">
                <label>目标基站
                  <select value={selectedApId} onChange={(event) => setSelectedApId(event.target.value)}>
                    {aps.map((ap) => <option key={ap.id} value={ap.id}>{ap.name} · {ap.id}</option>)}
                  </select>
                </label>
                <label>JSON 命令
                  <textarea value={rawWsCommand} onChange={(event) => setRawWsCommand(event.target.value)} />
                </label>
                <button className="primary" disabled={!selectedApId || sendingRawCommand} onClick={() => sendRawWsCommand()}>
                  <Send size={18} /> {sendingRawCommand ? '发送中' : '发送到基站 WS'}
                </button>
              </div>
              <p className="statusLine">发送状态：{rawCommandStatus}</p>
              <p className="statusLine">这块用于逆向验证云端下发格式。发送后去“接入日志”看 `WS-OUT /ws` 和基站后续返回。</p>
            </section>
          </>
        )}

        {activeView === 'labels' && (
          <section className="panel">
            <div className="sectionHead">
              <h2>价签</h2>
              <div className="inlineForm">
                <input value={draftLabel.id} onChange={(event) => setDraftLabel({ ...draftLabel, id: event.target.value })} />
                <input value={draftLabel.title} onChange={(event) => setDraftLabel({ ...draftLabel, title: event.target.value })} />
                <input type="number" value={draftLabel.price} onChange={(event) => setDraftLabel({ ...draftLabel, price: Number(event.target.value) })} />
                <button onClick={() => saveLabel().catch((error: Error) => setMessage(error.message))}>保存</button>
              </div>
            </div>
            <div className="labelGrid">
              {labels.map((label) => (
                <article className="labelCard" key={label.id}>
                  {labelRenders[label.id] && (
                    <img
                      className="labelPreview"
                      src={labelRenders[label.id].preview.dataUri}
                      alt={`${label.id} preview`}
                    />
                  )}
                  <span>{label.sku ?? label.id}</span>
                  <h3>{label.title}</h3>
                  <strong>{label.currency} {label.price.toFixed(2)}</strong>
                  <p>
                    {label.status} · 电量 {label.battery ?? '-'}% · RSSI {label.rssi ?? '-'}
                    {labelRenders[label.id] ? ` · ${labelRenders[label.id].width}x${labelRenders[label.id].height} · ${labelRenders[label.id].bitmap.format}` : ''}
                  </p>
                  <button disabled={Boolean(sendingLabels[label.id])} onClick={() => publish(label)}>
                    <Send size={16} /> {sendingLabels[label.id] ? '下发中' : '下发'}
                  </button>
                  <small>{labelCommandStatus[label.id] ?? '未下发'}</small>
                </article>
              ))}
            </div>
          </section>
        )}

        {activeView === 'commands' && (
          <section className="panel">
            <div className="sectionHead">
              <h2>ESL MQTT V2.0.2 指令</h2>
              <button className="smallButton" onClick={() => sendDocumentCommand()}>
                <Send size={16} /> 发送
              </button>
            </div>

            <div className="commandWorkbench">
              <label>目标基站
                <select value={docCommand.apId} onChange={(event) => setDocCommand({ ...docCommand, apId: event.target.value })}>
                  {aps.map((ap) => <option key={ap.id} value={ap.id}>{ap.name} · {ap.id} · {ap.status}</option>)}
                </select>
              </label>
              <label>目标价签
                <select value={docCommand.labelId} onChange={(event) => setDocCommand({ ...docCommand, labelId: event.target.value })}>
                  {labels
                    .filter((label) => !looksLikeDemoEslCode(label.id))
                    .map((label) => <option key={label.id} value={label.id}>{labelOptionText(label)}</option>)}
                </select>
              </label>
              <label>指令
                <select value={docCommand.commandType} onChange={(event) => setDocCommand({ ...docCommand, commandType: event.target.value })}>
                  {commandTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label>queue_id
                <input value={docCommand.queue_id} placeholder="自动生成" onChange={(event) => setDocCommand({ ...docCommand, queue_id: event.target.value })} />
              </label>
            </div>

            {['task_esl2', 'image', 'image_led', 'white'].includes(docCommand.commandType) && (
              <div className="commandWorkbench">
                <label>图片文件
                  <input type="file" accept="image/*" onChange={(event) => loadCommandImage(event.target.files?.[0]).catch((error: Error) => setMessage(error.message))} />
                </label>
                <label>source / URL / hex / PNG base64
                  <textarea value={docCommand.source} onChange={(event) => setDocCommand({ ...docCommand, source: event.target.value })} />
                </label>
                {docCommand.commandType === 'task_esl2' ? (
                  <>
                    <label>color_mode
                      <select value={docCommand.colorMode} onChange={(event) => setDocCommand({ ...docCommand, colorMode: event.target.value })}>
                        <option value="bwr">黑白红</option>
                        <option value="bw">黑白</option>
                        <option value="bwy">黑白黄</option>
                        <option value="bwry">黑白红黄</option>
                      </select>
                    </label>
                    <label>pattern<input type="number" value={docCommand.pattern} onChange={(event) => setDocCommand({ ...docCommand, pattern: Number(event.target.value) })} /></label>
                    <label>page_index<input type="number" value={docCommand.pageIndex} onChange={(event) => setDocCommand({ ...docCommand, pageIndex: Number(event.target.value) })} /></label>
                  </>
                ) : (
                  <>
                    <label>mode
                      <select value={docCommand.mode} onChange={(event) => setDocCommand({ ...docCommand, mode: Number(event.target.value) })}>
                        <option value={1}>1 · 图片 base64 数据</option>
                        <option value={0}>0 · zlib.deflate 后 hexString</option>
                        <option value={2}>2 · 图片 URL 地址</option>
                      </select>
                    </label>
                    <label>orientation
                      <select value={docCommand.orientation} onChange={(event) => setDocCommand({ ...docCommand, orientation: Number(event.target.value) })}>
                        <option value={0}>0 · 横屏</option>
                        <option value={1}>1 · 竖屏</option>
                      </select>
                    </label>
                  </>
                )}
                <span className="statusLine">图片：{docCommand.sourceName || '未选择'} · taskESL2 使用 RGBA→BGRA gzip，ESL_WRITE 使用 PNG base64 · source {docCommand.source.length} chars</span>
              </div>
            )}

            {['led', 'stop_led', 'image_led', 'task_esl2'].includes(docCommand.commandType) && (
              <div className="commandWorkbench fiveCols">
                <label>R<input type="number" value={docCommand.r} onChange={(event) => setDocCommand({ ...docCommand, r: Number(event.target.value) })} /></label>
                <label>G<input type="number" value={docCommand.g} onChange={(event) => setDocCommand({ ...docCommand, g: Number(event.target.value) })} /></label>
                <label>B<input type="number" value={docCommand.b} onChange={(event) => setDocCommand({ ...docCommand, b: Number(event.target.value) })} /></label>
                <label>time_on_ms<input type="number" value={docCommand.time_on_ms} onChange={(event) => setDocCommand({ ...docCommand, time_on_ms: Number(event.target.value) })} /></label>
                <label>time_s<input type="number" value={docCommand.time_s} onChange={(event) => setDocCommand({ ...docCommand, time_s: Number(event.target.value) })} /></label>
                {docCommand.commandType === 'task_esl2' && (
                  <>
                    <label className="checkLabel"><input type="checkbox" checked={docCommand.ledRed} onChange={(event) => setDocCommand({ ...docCommand, ledRed: event.target.checked })} /> led_red</label>
                    <label className="checkLabel"><input type="checkbox" checked={docCommand.ledGreen} onChange={(event) => setDocCommand({ ...docCommand, ledGreen: event.target.checked })} /> led_green</label>
                    <label className="checkLabel"><input type="checkbox" checked={docCommand.ledBlue} onChange={(event) => setDocCommand({ ...docCommand, ledBlue: event.target.checked })} /> led_blue</label>
                    <label>led_times<input type="number" value={docCommand.ledTimes} onChange={(event) => setDocCommand({ ...docCommand, ledTimes: Number(event.target.value) })} /></label>
                  </>
                )}
              </div>
            )}

            {(docCommand.commandType === 'ap_psm' || docCommand.commandType === 'ap_svc_cfg' || ['image', 'image_led', 'white'].includes(docCommand.commandType)) && (
              <div className="commandWorkbench fourCols">
                <label>mode<select value={docCommand.psmMode} onChange={(event) => setDocCommand({ ...docCommand, psmMode: event.target.value })}><option value="fast">fast</option><option value="default">default</option><option value="slow">slow</option><option value="sleep">sleep</option><option value="disable">disable</option></select></label>
                <label>adv_group<input type="number" value={docCommand.adv_group} onChange={(event) => setDocCommand({ ...docCommand, adv_group: Number(event.target.value) })} /></label>
                <label>duration_ms<input type="number" value={docCommand.duration_ms} onChange={(event) => setDocCommand({ ...docCommand, duration_ms: Number(event.target.value) })} /></label>
                <label>act_time_us<input type="number" value={docCommand.act_time_us} onChange={(event) => setDocCommand({ ...docCommand, act_time_us: Number(event.target.value) })} /></label>
                <label>slp_cycle_ms<input type="number" value={docCommand.slp_cycle_ms} onChange={(event) => setDocCommand({ ...docCommand, slp_cycle_ms: Number(event.target.value) })} /></label>
                <label>adv_interval_ms<input type="number" value={docCommand.adv_interval_ms} onChange={(event) => setDocCommand({ ...docCommand, adv_interval_ms: Number(event.target.value) })} /></label>
                <label>adv_map<input type="number" value={docCommand.adv_map} onChange={(event) => setDocCommand({ ...docCommand, adv_map: Number(event.target.value) })} /></label>
                <label>wait_conn_ch_idx<input type="number" value={docCommand.wait_conn_ch_idx} onChange={(event) => setDocCommand({ ...docCommand, wait_conn_ch_idx: Number(event.target.value) })} /></label>
                <label>retry_num<input type="number" value={docCommand.retry_num} onChange={(event) => setDocCommand({ ...docCommand, retry_num: Number(event.target.value) })} /></label>
                <label>parallel_num<input type="number" value={docCommand.parallel_num} onChange={(event) => setDocCommand({ ...docCommand, parallel_num: Number(event.target.value) })} /></label>
                <label>ap_chn_num<input type="number" value={docCommand.ap_chn_num} onChange={(event) => setDocCommand({ ...docCommand, ap_chn_num: Number(event.target.value) })} /></label>
              </div>
            )}

            {['ndef', 'ota'].includes(docCommand.commandType) && (
              <label>NDEF/OTA b64dat<textarea value={docCommand.b64dat} onChange={(event) => setDocCommand({ ...docCommand, b64dat: event.target.value })} /></label>
            )}

            {docCommand.commandType === 'group_change' && (
              <label>目标 group<input type="number" value={docCommand.group} onChange={(event) => setDocCommand({ ...docCommand, group: Number(event.target.value) })} /></label>
            )}

            {docCommand.commandType === 'ap_ota' && (
              <div className="commandWorkbench">
                <label>url<input value={docCommand.url} onChange={(event) => setDocCommand({ ...docCommand, url: event.target.value })} /></label>
                <label>md5<input value={docCommand.md5} onChange={(event) => setDocCommand({ ...docCommand, md5: event.target.value })} /></label>
              </div>
            )}

            {docCommand.commandType === 'raw' && (
              <label>raw JSON<textarea value={docCommand.raw} onChange={(event) => setDocCommand({ ...docCommand, raw: event.target.value })} /></label>
            )}

            <div className="toolbar commandToggles">
              {['image', 'image_led', 'white'].includes(docCommand.commandType) && (
                <label className="checkLabel"><input type="checkbox" checked={docCommand.prePsm} onChange={(event) => setDocCommand({ ...docCommand, prePsm: event.target.checked })} /> 刷图前先发 AP_PSM</label>
              )}
              <label className="checkLabel"><input type="checkbox" checked={docCommand.sendMqtt} onChange={(event) => setDocCommand({ ...docCommand, sendMqtt: event.target.checked })} /> MQTT</label>
              <label className="checkLabel"><input type="checkbox" checked={docCommand.sendWs} onChange={(event) => setDocCommand({ ...docCommand, sendWs: event.target.checked })} /> WebSocket</label>
              <button className="smallButton" onClick={() => refreshCommandExperiment().catch((error: Error) => setMessage(error.message))}>刷新实验日志</button>
            </div>

            <div className="experimentGrid">
              <section>
                <div className="sectionHead compact">
                  <h3>接入链路</h3>
                  <span className={selectedCommandAp?.status === 'online' ? 'pill online' : 'pill offline'}>
                    {selectedCommandAp?.status ?? 'unknown'}
                  </span>
                </div>
                <dl className="miniList">
                  <dt>AP</dt><dd>{selectedCommandAp?.id ?? '-'}</dd>
                  <dt>IP</dt><dd>{selectedCommandAp?.ip ?? '-'}</dd>
                  <dt>WS</dt><dd>{wsStatuses[selectedCommandAp?.id ?? '']?.connected ? '已连接' : '未确认'}</dd>
                  <dt>最后消息</dt><dd>{wsStatuses[selectedCommandAp?.id ?? '']?.lastMessageAt ? new Date(wsStatuses[selectedCommandAp?.id ?? ''].lastMessageAt as string).toLocaleTimeString() : '-'}</dd>
                  <dt>EMQX</dt><dd>{mqttStats?.external.connected ? '已连接' : '未连接'}</dd>
                </dl>
              </section>

              <section>
                <div className="sectionHead compact">
                  <h3>下发追踪</h3>
                  <button className="linkButton" onClick={() => refreshDownlinkTraces(docCommand.apId || selectedCommandAp?.id || '').catch((error: Error) => setMessage(error.message))}>刷新</button>
                </div>
                <div className="traceList">
                  {downlinkTraces.length === 0 && <p className="statusLine">还没有下发追踪。点击本页发送后会出现 WS-SEND-CALLBACK 与 AP 队列状态。</p>}
                  {downlinkTraces.slice(0, 8).map((trace) => (
                    <article key={trace.id}>
                      <b>{trace.status}</b>
                      <span>{trace.commandType ?? trace.transport} · {trace.labelId ?? '-'} · {trace.bytes ?? '-'} bytes · queue {trace.queueId ?? '-'}</span>
                      {trace.error && <code>{trace.error}</code>}
                    </article>
                  ))}
                </div>
              </section>
            </div>

            <section className="embeddedLogs">
              <div className="sectionHead compact">
                <div>
                  <h3>官方下行包捕获与重放</h3>
                  <p className="statusLine">先用官方 API 成功刷新一次，本区会捕获 OFFICIAL-WS-DOWN 的完整帧；点重放可直接发回当前基站。</p>
                </div>
                <div className="toolbar">
                  <input
                    className="compactInput"
                    value={replayTargetLabelId}
                    placeholder="可选：替换目标价签"
                    onChange={(event) => setReplayTargetLabelId(event.target.value)}
                  />
                  <button className="smallButton" onClick={() => refreshOfficialDownlinks().catch((error: Error) => setMessage(error.message))}>刷新捕获</button>
                  <button className="smallButton" onClick={() => refreshOfficialAnalysis().catch((error: Error) => setMessage(error.message))}>分析 service03</button>
                  <button className="smallButton" disabled={!selectedCapture} onClick={() => {
                    setCandidateService03B64(readWriteServiceBase64(selectedCapture!, '01-00-00-03'));
                    setCandidateService07B64(readWriteServiceBase64(selectedCapture!, '01-00-00-07') || 'AGQAZP8sAQ==');
                    setMessage('已载入当前捕获包的 service03/service07，可在下方修改后重放');
                  }}>载入当前 service03</button>
                  <button className="smallButton" disabled={!selectedCapture} onClick={() => saveSelectedCaptureAsSample()}>归档样本</button>
                  <button className="smallButton" disabled={service03Samples.length === 0} onClick={() => exportService03Samples()}>导出样本</button>
                  <label className="smallButton" style={{ cursor: 'pointer' }}>
                    导入样本
                    <input
                      type="file"
                      accept="application/json"
                      style={{ display: 'none' }}
                      onChange={(event) => importService03Samples(event.target.files?.[0]).catch((error: Error) => setMessage(error.message))}
                    />
                  </label>
                  <button className="smallButton" disabled={service03Samples.length === 0} onClick={() => clearService03Samples()}>清空样本</button>
                  <button className="smallButton" disabled={!selectedCapture?.replayable} onClick={() => replayOfficialDownlink()}>
                    重放选中包
                  </button>
                </div>
              </div>
              <div className="captureGrid">
                <div className="captureList">
                  {officialDownlinks.length === 0 && <p className="statusLine">暂无捕获。调用官方 esl/direct 成功刷新后，等待 OFFICIAL-WS-DOWN 出现再刷新。</p>}
                  {officialDownlinks.map((capture) => (
                    <button
                      key={capture.id}
                      className={selectedCapture?.id === capture.id ? 'captureItem active' : 'captureItem'}
                      onClick={() => setSelectedCaptureId(capture.id)}
                    >
                      <b>{capture.commandType ?? capture.kind}</b>
                      <span>{new Date(capture.createdAt).toLocaleTimeString()} · {capture.bytes} bytes · {capture.replayable ? '可重放' : '不可重放'}</span>
                      <small>{capture.labelId ?? '-'} · queue {capture.queueId ?? '-'} · fp {capture.fingerprint}</small>
                    </button>
                  ))}
                </div>
                <div className="capturePreview">
                  <h3>捕获内容</h3>
                  <pre>{selectedCapture ? JSON.stringify({
                    id: selectedCapture.id,
                    kind: selectedCapture.kind,
                    bytes: selectedCapture.bytes,
                    replayable: selectedCapture.replayable,
                    commandType: selectedCapture.commandType,
                    labelId: selectedCapture.labelId,
                    queueId: selectedCapture.queueId,
                    fingerprint: selectedCapture.fingerprint,
                    text: selectedCapture.textPreview ?? selectedCapture.text,
                    textChars: selectedCapture.text?.length,
                    base64: selectedCapture.base64,
                    hexPrefix: selectedCapture.hexPrefix,
                    summary: selectedCapture.summary,
                  }, null, 2) : '未选择捕获包'}</pre>
                </div>
                <div className="capturePreview">
                  <h3>重放结果</h3>
                  <pre>{replayResult ? JSON.stringify(replayResult, null, 2) : '未重放'}</pre>
                </div>
                <div className="capturePreview">
                  <h3>回包级结果</h3>
                  <pre>{replayTraceInsight ? JSON.stringify(replayTraceInsight, null, 2) : '还没有 trace 结果。重放一次后，这里会显示 trackingId、状态、ack/send、errno、write_time_ms。'}</pre>
                </div>
                <div className="capturePreview">
                  <h3>service03 分组</h3>
                  <pre>{captureAnalysis ? JSON.stringify({
                    count: captureAnalysis.count,
                    uniqueService03: captureAnalysis.uniqueService03,
                    groups: captureAnalysis.groups.map((group) => ({
                      sha256: group.sha256.slice(0, 12),
                      count: group.count,
                      service03Bytes: group.service03Bytes,
                      firstSeenAt: group.firstSeenAt,
                      lastSeenAt: group.lastSeenAt,
                      captureIds: group.captureIds.slice(0, 6),
                      headHex: group.headHex,
                      tailHex: group.tailHex,
                    })),
                  }, null, 2) : '未分析'}</pre>
                </div>
              </div>
            </section>

            <section className="embeddedLogs">
              <div className="sectionHead compact">
                <div>
                  <h3>service03 实验台</h3>
                  <p className="statusLine">这里不是直接生成正确编码，而是把候选 `01-00-00-03` base64 注入到官方捕获包里重放，快速验证候选编码有没有被价签接受。</p>
                </div>
                <div className="toolbar">
                  <button className="smallButton" disabled={!selectedCapture || candidateStatus.phase === 'replaying' || candidateSweepRunning} onClick={() => replayWithCandidateService03().catch((error: Error) => {
                    setCandidateStatus({
                      phase: 'error',
                      title: '注入并重放失败',
                      detail: error.message,
                    });
                    setMessage(error.message);
                  })}>
                    {candidateStatus.phase === 'replaying' ? '发送中...' : '注入并重放'}
                  </button>
                  <button className="smallButton" disabled={!selectedCapture || !candidateSourceImage || candidateSweepRunning} onClick={() => sweepCandidateCombinations().catch((error: Error) => {
                    setCandidateStatus({
                      phase: 'error',
                      title: '一键遍历失败',
                      detail: error.message,
                    });
                    setMessage(error.message);
                  })}>
                    {candidateSweepRunning ? '遍历中...' : '一键遍历重发'}
                  </button>
                  <button className="smallButton" disabled={!selectedCapture || officialMutationRunning || candidateSweepRunning} onClick={() => sweepOfficialByteXor().catch((error: Error) => {
                    setCandidateStatus({
                      phase: 'error',
                      title: '官方包分区扰动失败',
                      detail: error.message,
                    });
                    setMessage(error.message);
                  })}>
                    {officialMutationRunning ? '扰动中...' : '官方包分区扰动'}
                  </button>
                  <button className="smallButton" disabled={!selectedCapture || !rightDiffCaptureId || officialMutationRunning || candidateSweepRunning} onClick={() => sweepOfficialSplice().catch((error: Error) => {
                    setCandidateStatus({
                      phase: 'error',
                      title: 'A/B 分段拼接失败',
                      detail: error.message,
                    });
                    setMessage(error.message);
                  })}>
                    {officialMutationRunning ? '拼接中...' : '官方包 A/B 分段拼接'}
                  </button>
                </div>
              </div>
              <div className={`candidateStatusCard ${candidateStatus.phase}`}>
                <strong>{candidateStatus.title}</strong>
                {candidateStatus.detail && <span>{candidateStatus.detail}</span>}
              </div>
              <div className="candidateSteps">
                <article className={selectedCapture ? 'done' : ''}>
                  <b>1. 选基线包</b>
                  <span>{selectedCapture ? `${selectedCapture.commandType ?? selectedCapture.kind} · ${selectedCapture.id}` : '先在上方捕获列表选一条官方成功包'}</span>
                </article>
                <article className={generatedCandidate ? 'done' : ''}>
                  <b>2. 生成候选</b>
                  <span>{generatedCandidate ? `${generatedCandidate.pixelMode} · ${generatedCandidate.compression} · ${generatedCandidate.envelope}` : '上传图片并选一种编码猜测'}</span>
                </article>
                <article className={candidateStatus.phase === 'success' ? 'done' : ''}>
                  <b>3. 注入重放</b>
                  <span>{candidateStatus.phase === 'success' ? '已发送到基站链路' : '生成候选后点右上角按钮'}</span>
                </article>
              </div>
              <div className="candidatePresets">
                {[
                  { label: '推荐 1 · 黑白 deflate 5/5540', pixelMode: 'bw_1bpp', compression: 'deflate', envelope: 'splice_5_5540' },
                  { label: '推荐 2 · 双平面 deflate 5/5540', pixelMode: 'bwr_2plane', compression: 'deflate', envelope: 'splice_5_5540' },
                  { label: '推荐 3 · 黑白直发 5/5540', pixelMode: 'bw_1bpp', compression: 'none', envelope: 'splice_5_5540' },
                  { label: '推荐 4 · payload only（极端）', pixelMode: 'bw_1bpp', compression: 'deflate', envelope: 'payload_only' },
                ].map((preset) => (
                  <button key={preset.label} className="smallButton ghostButton" onClick={() => applyCandidatePreset(preset)}>
                    {preset.label}
                  </button>
                ))}
                <button
                  className="smallButton ghostButton"
                  disabled={!selectedCapture}
                  onClick={() => deriveCandidateEnvelopeFromSelectedCapture().catch((error: Error) => setMessage(error.message))}
                >
                  自动推导封套
                </button>
              </div>
              <p className="statusLine">一键遍历会基于当前图片自动尝试 {candidateComboCatalog.length} 组编码组合，每组间隔 10 秒。</p>
              <div className="commandWorkbench">
                <label>样本备注
                  <input value={service03SampleNote} onChange={(event) => setService03SampleNote(event.target.value)} placeholder="例如：template4513 f1=AAAAA" />
                </label>
                <label>候选 service07 base64
                  <input value={candidateService07B64} onChange={(event) => setCandidateService07B64(event.target.value)} placeholder="通常可沿用官方的 AGQAZP8sAQ==" />
                </label>
                <label>像素编码猜测
                  <select value={candidatePixelMode} onChange={(event) => setCandidatePixelMode(event.target.value)}>
                    <option value="bw_1bpp">黑白 1bpp</option>
                    <option value="bw_1bpp_inverted">黑白 1bpp 反色</option>
                    <option value="bwr_2plane">黑/红 双平面 1bpp</option>
                    <option value="gray8">灰度 8bit</option>
                    <option value="raw_rgba">原始 RGBA</option>
                  </select>
                </label>
                <label>压缩包装猜测
                  <select value={candidateCompression} onChange={(event) => setCandidateCompression(event.target.value)}>
                    <option value="none">不压缩</option>
                    <option value="gzip">gzip</option>
                    <option value="deflate">deflate</option>
                  </select>
                </label>
                <label>service03 封套猜测
                  <select value={candidateEnvelope} onChange={(event) => setCandidateEnvelope(event.target.value)}>
                    <option value="splice_5_5540">沿用选中包头5 + 尾5540（统计中位数）</option>
                    <option value="splice_12_24">沿用选中包头12 + 尾24</option>
                    <option value="splice_12_32">沿用选中包头12 + 尾32</option>
                    <option value="splice_16_24">沿用选中包头16 + 尾24</option>
                    <option value="splice_16_32">沿用选中包头16 + 尾32</option>
                    <option value="payload_only">仅上传候选 payload</option>
                  </select>
                </label>
                <label>上传图片生成候选
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) => generateCandidateService03(event.target.files?.[0]).catch((error: Error) => {
                      setCandidateStatus({
                        phase: 'error',
                        title: '生成候选失败',
                        detail: error.message,
                      });
                      setMessage(error.message);
                    })}
                  />
                </label>
                <label className="wideField">候选 service03 base64
                  <textarea
                    rows={8}
                    value={candidateService03B64}
                    onChange={(event) => setCandidateService03B64(event.target.value)}
                    placeholder="把自己的候选 01-00-00-03 base64 放到这里，再点“注入并重放”"
                  />
                </label>
              </div>
              <div className="resultGrid">
                <div>
                  <h3>候选编码摘要</h3>
                  <pre>{generatedCandidate ? JSON.stringify(generatedCandidate, null, 2) : '还没有生成候选。先选中一条官方捕获包，再上传图片。'}</pre>
                </div>
                <div>
                  <h3>遍历发送记录</h3>
                  <pre>{candidateSweepResults.length > 0 ? JSON.stringify(candidateSweepResults, null, 2) : '还没有遍历记录。上传图片后点“一键遍历重发”。'}</pre>
                </div>
                <div>
                  <h3>官方包破坏实验记录</h3>
                  <pre>{officialMutationResults.length > 0 ? JSON.stringify(officialMutationResults, null, 2) : '还没有官方包破坏实验记录。现在会按完整 service03 真长度做分区扰动和拼接，并在 detail 里显示 ack/send/errno/write_time_ms。'}</pre>
                </div>
                <div>
                  <h3>样本对照摘要</h3>
                  <pre>{service03Insights.summaries.length > 0 ? JSON.stringify(service03Insights.summaries.map((sample, index) => ({
                    index: index + 1,
                    note: sample.noteKey,
                    value: sample.noteValue,
                    templateId: sample.templateId,
                    bytes: sample.service03Bytes,
                    deltaFromPrevious: sample.deltaFromPrevious,
                    fingerprint: sample.fingerprint,
                    duplicateCapture: sample.duplicateCapture,
                    duplicateFingerprint: sample.duplicateFingerprint,
                    captureId: sample.captureId,
                    capturedAt: sample.capturedAt,
                  })), null, 2) : '还没有样本摘要'}</pre>
                </div>
                <div>
                  <h3>规律分析</h3>
                  <pre>{service03Insights.summaries.length > 0 ? JSON.stringify({
                    sampleCount: service03Insights.summaries.length,
                    duplicateCaptureIds: service03Insights.duplicateCaptureIds,
                    duplicateFingerprints: service03Insights.duplicateFingerprints,
                    lengthBuckets: service03Insights.lengthBuckets,
                    fingerprintBuckets: service03Insights.fingerprintBuckets.slice(0, 8),
                    noteGroups: service03Insights.noteGroups,
                    readingHints: [
                      'duplicateCaptureIds 非空时，说明同一条捕获被归档了多次，属于脏样本。',
                      'lengthBuckets 能看字符密度对 service03 长度的影响。',
                      '同一 fingerprint 对应多个 note，通常说明结果完全一致，适合找“哪组改动没有真正影响渲染”。',
                      'noteGroups 会按备注里的位置/字号/值自动归类，方便判断“位置影响头部、字号影响长度”这种规律。',
                    ],
                  }, null, 2) : '还没有规律分析'}</pre>
                </div>
                <div>
                  <h3>已归档样本</h3>
                  <pre>{service03Samples.length > 0 ? JSON.stringify(service03Samples, null, 2) : '还没有样本，选中一个捕获包后点“归档样本”'}</pre>
                </div>
                <div>
                  <h3>实验提示</h3>
                  <pre>{[
                    '1. 先选中一条能成功刷新的官方 READ_WRITE_SVC 捕获包',
                    '2. 点“载入当前 service03”作为基线',
                    '3. 替换候选 service03 base64',
                    '4. 点“注入并重放”',
                    '5. 观察标签是否刷新、AP 是否回包、下发追踪是否正常',
                  ].join('\n')}</pre>
                </div>
              </div>
            </section>

            <section className="embeddedLogs">
              <div className="sectionHead compact">
                <div>
                  <h3>READ_WRITE_SVC 差分分析</h3>
                  <p className="statusLine">选择两次官方刷新捕获包，对比每个 service 的 base64 解码字节差异，判断是图片压缩数据还是模板变量协议。</p>
                </div>
                <button className="smallButton" onClick={() => diffOfficialDownlinks()}>
                  对比 A/B
                </button>
              </div>
              <div className="commandWorkbench">
                <label>捕获 A
                  <select value={leftDiffCaptureId} onChange={(event) => setLeftDiffCaptureId(event.target.value)}>
                    {officialDownlinks.map((capture) => (
                      <option key={capture.id} value={capture.id}>
                        {new Date(capture.createdAt).toLocaleTimeString()} · {capture.commandType ?? capture.kind} · {capture.bytes} bytes · {capture.labelId ?? '-'}
                      </option>
                    ))}
                  </select>
                </label>
                <label>捕获 B
                  <select value={rightDiffCaptureId} onChange={(event) => setRightDiffCaptureId(event.target.value)}>
                    {officialDownlinks.map((capture) => (
                      <option key={capture.id} value={capture.id}>
                        {new Date(capture.createdAt).toLocaleTimeString()} · {capture.commandType ?? capture.kind} · {capture.bytes} bytes · {capture.labelId ?? '-'}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="diffList">
                {!captureDiff && <p className="statusLine">还没有差分结果。先捕获至少两次 `READ_WRITE_SVC`，再点击对比。</p>}
                {captureDiff && !captureDiff.ok && <pre>{JSON.stringify(captureDiff, null, 2)}</pre>}
                {captureDiff?.ok && (
                  <div className="diffNotice">
                    <b>{captureDiff.sameFingerprint ? '两个捕获包完全一致' : '两个捕获包存在差异'}</b>
                    <span>A fp: {String(captureDiff.left?.fingerprint ?? '-')} · B fp: {String(captureDiff.right?.fingerprint ?? '-')}</span>
                    {captureDiff.sameCapture && <span>当前选中了同一个捕获包，请更换 A/B。</span>}
                  </div>
                )}
                {captureDiff?.ok && captureDiff.services?.map((service) => (
                  <article key={service.key}>
                    <h4>{service.service ?? service.key}</h4>
                    <div className="diffStats">
                      <span>key: {service.key}</span>
                      <span>A cmd: {String(service.left?.type ?? '-')} #{String(service.left?.id ?? '-')}</span>
                      <span>B cmd: {String(service.right?.type ?? '-')} #{String(service.right?.id ?? '-')}</span>
                      <span>A: {service.diff.leftBytes} bytes</span>
                      <span>B: {service.diff.rightBytes} bytes</span>
                      <span>变化: {service.diff.changedBytes} bytes</span>
                      <span>比例: {(service.diff.changedRatio * 100).toFixed(2)}%</span>
                      <span>首差异: {service.diff.firstDiff ?? '-'}</span>
                    </div>
                    <div className="diffRanges">
                      {service.diff.ranges.slice(0, 6).map((range) => (
                        <section key={`${service.key}-${range.start}-${range.end}`}>
                          <b>{range.start}-{range.end} · {range.length} bytes</b>
                          <code>A hex: {range.leftHex}</code>
                          <code>B hex: {range.rightHex}</code>
                          <code>A txt: {range.leftAscii}</code>
                          <code>B txt: {range.rightAscii}</code>
                        </section>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <div className="resultGrid">
              <div>
                <h3>发送结果</h3>
                <pre>{docResult ? JSON.stringify(docResult, null, 2) : '未发送'}</pre>
              </div>
              <div>
                <h3>建议订阅</h3>
                <pre>{(docResult?.subscribe ?? [`${storeCode}/+/cmd`, `${storeCode}/+/result`, `stores/${storeCode}/#`]).join('\n')}</pre>
              </div>
            </div>

            <section className="embeddedLogs">
              <div className="sectionHead compact">
                <div>
                  <h3>接入日志实验</h3>
                  <p className="statusLine">只显示认证、WS、MQTT、下发追踪和官方代理相关日志；完整列表仍在“接入日志”页。</p>
                </div>
                <button className="smallButton" onClick={() => refreshLogs().catch((error: Error) => setMessage(error.message))}>刷新</button>
              </div>
              <div className="logList compactLogs">
                {commandLogs.length === 0 && <p className="statusLine">暂无实验日志。</p>}
                {commandLogs.map((log) => (
                  <article key={log.id}>
                    <b>{log.method} {log.path}</b>
                    <span>{log.statusCode ?? '-'} · {log.ip ?? '-'} · {new Date(log.time).toLocaleString()}</span>
                    {log.body ? <pre>{JSON.stringify(log.body, null, 2)}</pre> : null}
                  </article>
                ))}
              </div>
            </section>

            <section className="embeddedLogs">
              <div className="sectionHead compact">
                <div>
                  <h3>官方 API 实验</h3>
                  <p className="statusLine">根据官方 docs 调用 API，再观察是否触发 OFFICIAL-WS-DOWN。若 direct 返回 not exists，先用 query_count/query 确认官方库是否已有价签。</p>
                </div>
                <button className="smallButton" onClick={() => callOfficialApiExperiment()}>
                  调用官方 API
                </button>
                <button className="smallButton" disabled={autoTemplateSamplesRunning} onClick={() => runAutoTemplateSamples().catch((error: Error) => setMessage(error.message))}>
                  {autoTemplateSamplesRunning ? '自动实验中...' : '自动样本实验'}
                </button>
                <button className="smallButton" disabled={bindPipelineRunning} onClick={() => runOfficialBindPipeline()}>
                  {bindPipelineRunning ? '绑定链路中...' : '一键绑定链路实验'}
                </button>
                <button className="smallButton" disabled={bindPipelineRunning} onClick={() => runOfficialAssociationExperiments()}>
                  {bindPipelineRunning ? '实验中...' : '关联规则批量实验'}
                </button>
                <button className="smallButton" onClick={() => runOfficialStateDiagnosis().catch((error: Error) => setMessage(error.message))}>
                  状态诊断
                </button>
              </div>
              <div className="commandWorkbench fourCols">
                <label>api_name
                  <input value={officialApi.apiName} onChange={(event) => setOfficialApi({ ...officialApi, apiName: event.target.value })} />
                </label>
                <label>resource
                  <select value={officialApi.resource} onChange={(event) => setOfficialApi({ ...officialApi, resource: event.target.value })}>
                    <option value="esl_ble">esl_ble</option>
                    <option value="esl">esl</option>
                    <option value="esl_wifi">esl_wifi</option>
                    <option value="nfc">nfc</option>
                    <option value="product">product</option>
                    <option value="productadjust">productadjust 调价单</option>
                    <option value="store">store 门店/过滤</option>
                    <option value="template">template 墨水屏模板</option>
                    <option value="pad_template">pad_template 彩屏模板</option>
                    <option value="pad">pad</option>
                    <option value="user">user 门店用户</option>
                    <option value="query">query/env 环境</option>
                  </select>
                </label>
                <label>action
                  <select value={officialApi.action} onChange={(event) => setOfficialApi({ ...officialApi, action: event.target.value })}>
                    <option value="unbind">unbind 解绑入队</option>
                    <option value="bind">bind 单价签绑定入队</option>
                    <option value="bind_multiple">bind_multiple 批量绑定入队</option>
                    <option value="bind_task">bind_task 触发队列</option>
                    <option value="search">search 闪灯</option>
                    <option value="sync">sync 同步价签信息</option>
                    <option value="direct">direct 直接刷新/可带 LED</option>
                    <option value="query_status">query_status 查询指定价签</option>
                    <option value="query">query 查询列表/模板</option>
                    <option value="query_count">query_count 统计</option>
                    <option value="query_with_code">query_with_code 查指定商品</option>
                    <option value="create">create 创建/更新商品</option>
                    <option value="create_multiple">create_multiple 批量创建商品</option>
                    <option value="del">del 删除终端</option>
                    <option value="del_multiple">del_multiple 批量删商品</option>
                    <option value="create_order">create_order 创建调价单</option>
                    <option value="del_order">del_order 删除调价单</option>
                    <option value="adjust_task">adjust_task 触发调价单</option>
                    <option value="set">set 设置门店/过滤</option>
                    <option value="delete">delete 删除用户</option>
                    <option value="env">env 查询环境</option>
                  </select>
                </label>
                <label>sign
                  <input value={officialApi.sign} onChange={(event) => setOfficialApi({ ...officialApi, sign: event.target.value })} />
                </label>
                <label>esl_code
                  <input value={officialApi.eslCode} placeholder={docCommand.labelId || labels[0]?.id || '价签编号'} onChange={(event) => setOfficialApi({ ...officialApi, eslCode: event.target.value })} />
                  {looksLikeDemoEslCode(officialApi.eslCode) && <small className="fieldHint warningText">当前是演示值，官方 API 不会认这个码；建议直接用 17900170。</small>}
                </label>
                <label>product_code
                  <input value={officialApi.productCode} onChange={(event) => setOfficialApi({ ...officialApi, productCode: event.target.value })} />
                </label>
                <label>product name
                  <input value={officialApi.productName} onChange={(event) => setOfficialApi({ ...officialApi, productName: event.target.value })} />
                </label>
                <label>price
                  <input type="number" value={officialApi.price} onChange={(event) => setOfficialApi({ ...officialApi, price: Number(event.target.value) })} />
                </label>
                <label>template_id
                  <input type="number" value={officialApi.templateId} onChange={(event) => setOfficialApi({ ...officialApi, templateId: Number(event.target.value) })} />
                </label>
                <label className="checkLabel"><input type="checkbox" checked={officialApi.led} onChange={(event) => setOfficialApi({ ...officialApi, led: event.target.checked })} /> 附带 LED</label>
                <label className="wideField">自定义字段（模板绑定 #f1/#f2 等）
                  <textarea
                    rows={4}
                    value={officialApi.customFieldsText}
                    onChange={(event) => setOfficialApi({ ...officialApi, customFieldsText: event.target.value })}
                    placeholder={'f1=要显示在 #f1 的内容\nf2=要显示在 #f2 的内容'}
                  />
                </label>
              </div>
              <div className="resultGrid">
                <div>
                  <h3>官方 API 返回</h3>
                  {officialWatch && <p className="statusLine strongStatus">{officialWatch}</p>}
                  <pre>{officialApiResult ? JSON.stringify(officialApiResult, null, 2) : '未调用'}</pre>
                </div>
                <div>
                  <h3>推荐顺序</h3>
                  <pre>{[
                    '1. query/env：确认官方服务可访问',
                    '2. template/query：先查真实 template_id',
                    '3. esl/query 或 esl_ble/query：查看官方库实际价签编号',
                    '4. product/query_with_code：确认 product_code 是否存在',
                    '5. product/create：改 product_code/name 前先创建或更新商品',
                    '6. esl/direct 或 esl_ble/direct：直接刷新，可勾选 LED',
                    '7. 若 direct 不触发，再试 esl/bind -> esl/bind_task',
                    '8. search/sync/bind_task/direct 会自动监听 OFFICIAL-WS-DOWN',
                  ].join('\n')}</pre>
                </div>
              </div>
              {autoTemplateSamplesResult && (
                <div className="embeddedLogs">
                  <div className="sectionHead compact">
                    <div>
                      <h3>自动样本实验结果</h3>
                      <p className="statusLine">程序已自动调用官方 esl/direct，并等待新 READ_WRITE_SVC 捕获；这里直接给出每个样本的 capture 指纹、长度和头尾摘要。</p>
                    </div>
                  </div>
                  <pre>{JSON.stringify(autoTemplateSamplesResult, null, 2)}</pre>
                </div>
              )}
              {bindPipelineResult && (
                <div className="embeddedLogs">
                  <div className="sectionHead compact">
                    <div>
                      <h3>绑定链路实验结果</h3>
                      <p className="statusLine">自动执行 product/create、product/query_with_code、esl/bind、esl/bind_task，并等待 READ_WRITE_SVC。</p>
                    </div>
                  </div>
                  <div className="diffStats">
                    <span>esl: {bindPipelineResult.eslCode}</span>
                    <span>template: {bindPipelineResult.templateId}</span>
                    <span>pc: {String(bindPipelineResult.product.pc ?? '-')}</span>
                    <span>pn: {String(bindPipelineResult.product.pn ?? '-')}</span>
                    <span>pp: {String(bindPipelineResult.product.pp ?? '-')}</span>
                    <span>f1: {String(bindPipelineResult.product.f1 ?? '-')}</span>
                    <span>fp: {bindPipelineResult.capture?.fingerprint ?? '-'}</span>
                    <span>svc03: {bindPipelineResult.capture?.service03Bytes ?? '-'}</span>
                  </div>
                  <pre>{JSON.stringify(bindPipelineResult, null, 2)}</pre>
                </div>
              )}
              {associationResults.length > 0 && (
                <div className="embeddedLogs">
                  <div className="sectionHead compact">
                    <div>
                      <h3>关联规则批量实验结果</h3>
                      <p className="statusLine">来自官方文档的三种路径：direct+extend、bind 单条完整字段、bind_multiple + esltemplate_id。</p>
                    </div>
                  </div>
                  <div className="diffList">
                    {associationResults.map((result) => (
                      <article key={`${result.variant}-${result.startedAt}`}>
                        <h4>{result.variant ?? '关联实验'} · {result.capture ? 'captured' : 'pending'}</h4>
                        <div className="diffStats">
                          <span>pc: {String(result.product.pc ?? '-')}</span>
                          <span>pn: {String(result.product.pn ?? '-')}</span>
                          <span>pp: {String(result.product.pp ?? '-')}</span>
                          <span>f1: {String(result.product.f1 ?? '-')}</span>
                          <span>extend.e001: {String((result.product.extend as Record<string, unknown> | undefined)?.e001 ?? '-')}</span>
                          <span>fp: {result.capture?.fingerprint ?? '-'}</span>
                          <span>svc03: {result.capture?.service03Bytes ?? '-'}</span>
                        </div>
                        <pre>{JSON.stringify(result, null, 2)}</pre>
                      </article>
                    ))}
                  </div>
                </div>
              )}
              {officialDiagnosis && (
                <div className="embeddedLogs">
                  <div className="sectionHead compact">
                    <div>
                      <h3>官方状态诊断</h3>
                      <p className="statusLine">这里用来确认官方后台的价签、商品、模板关联是否真的改变。若这里变了但 READ_WRITE_SVC 主图不变，问题就集中在官方模板渲染/模板变量绑定。</p>
                    </div>
                  </div>
                  <div className="diffStats">
                    <span>esl: {officialDiagnosis.eslCode}</span>
                    <span>pc: {officialDiagnosis.productCode || '-'}</span>
                    <span>template: {officialDiagnosis.templateId}</span>
                    <span>checks: {officialDiagnosis.checks.length}</span>
                  </div>
                  {officialDiagnosis.findings.length > 0 && (
                    <pre>{officialDiagnosis.findings.join('\n')}</pre>
                  )}
                  <pre>{JSON.stringify(officialDiagnosis, null, 2)}</pre>
                </div>
              )}
            </section>

            <section className="embeddedLogs">
              <div className="sectionHead compact">
                <div>
                  <h3>模板 A/B 批量测试</h3>
                  <p className="statusLine">逐个 template_id 调官方 esl/direct，等待 READ_WRITE_SVC，汇总 fingerprint。fingerprint 不变说明生成图没变。</p>
                </div>
                <button className="smallButton" disabled={templateBatchRunning} onClick={() => runTemplateBatchTest()}>
                  {templateBatchRunning ? '测试中...' : '开始批量测试'}
                </button>
              </div>
              <div className="commandWorkbench">
                <label>template_id 列表
                  <input value={templateBatchIds} onChange={(event) => setTemplateBatchIds(event.target.value)} />
                </label>
              </div>
              <div className="diffList">
                {templateBatchResults.length === 0 && <p className="statusLine">还没有批量测试结果。建议先填同尺寸模板，如 4678,4513。</p>}
                {templateBatchResults.map((row) => (
                  <article key={`${row.templateId}-${row.productCode}`}>
                    <h4>template {row.templateId} · {row.status}</h4>
                    <div className="diffStats">
                      <span>pc: {row.productCode}</span>
                      <span>pn: {row.productName}</span>
                      <span>pp: {row.price}</span>
                      <span>f1: {row.fieldOverrides?.f1 ?? '-'}</span>
                      <span>fp: {row.capture?.fingerprint ?? '-'}</span>
                      <span>bytes: {row.capture?.bytes ?? '-'}</span>
                      <span>svc03: {row.capture?.service03Bytes ?? '-'}</span>
                      <span>svc07: {row.capture?.service07Bytes ?? '-'}</span>
                    </div>
                    <pre>{JSON.stringify({
                      message: row.message,
                      apiResponse: row.api?.response,
                      capture: row.capture,
                    }, null, 2)}</pre>
                  </article>
                ))}
              </div>
            </section>

            <section className="embeddedLogs">
              <div className="sectionHead compact">
                <div>
                  <h3>同模板变量 A/B 测试</h3>
                  <p className="statusLine">固定一个有效模板，自动生成两组差异很大的商品数据。官方下发不稳定时，建议分别点 A/B 单独捕获，再用成功包手动差分。</p>
                </div>
                <div className="toolbar">
                  <button className="smallButton" disabled={variableBatchRunning} onClick={() => runVariableSingleTest('A')}>
                    单独捕获 A
                  </button>
                  <button className="smallButton" disabled={variableBatchRunning} onClick={() => runVariableSingleTest('B')}>
                    单独捕获 B
                  </button>
                  <button className="smallButton" disabled={variableBatchRunning} onClick={() => runVariableBatchTest()}>
                    {variableBatchRunning ? '测试中...' : '连续 A/B'}
                  </button>
                  <button className="smallButton secondary" disabled={variableBatchRunning} onClick={() => {
                    setVariableBatchResults([]);
                    setCaptureDiff(null);
                  }}>
                    清空结果
                  </button>
                </div>
              </div>
              <div className="commandWorkbench">
                <label>template_id
                  <input type="number" value={variableTemplateId} onChange={(event) => setVariableTemplateId(Number(event.target.value))} />
                </label>
              </div>
              <div className="diffList">
                {variableBatchResults.length === 0 && <p className="statusLine">建议用刚刚发现的动态模板 4513。</p>}
                {variableBatchResults.map((row) => (
                  <article key={`${row.variant}-${row.productCode}`}>
                    <h4>{row.variant} · template {row.templateId} · {row.status}</h4>
                    <div className="diffStats">
                      <span>pc: {row.productCode}</span>
                      <span>pn: {row.productName}</span>
                      <span>pp: {row.price}</span>
                      <span>f1: {row.fieldOverrides?.f1 ?? '-'}</span>
                      <span>fp: {row.capture?.fingerprint ?? '-'}</span>
                      <span>bytes: {row.capture?.bytes ?? '-'}</span>
                      <span>svc03: {row.capture?.service03Bytes ?? '-'}</span>
                      <span>svc07: {row.capture?.service07Bytes ?? '-'}</span>
                    </div>
                    <pre>{JSON.stringify({
                      message: row.message,
                      apiResponse: row.api?.response,
                      capture: row.capture,
                    }, null, 2)}</pre>
                  </article>
                ))}
              </div>
            </section>
          </section>
        )}

        {activeView === 'image-test' && (
          <section className="panel">
            <div className="sectionHead">
              <div>
                <h2>本地图片下发渲染测试</h2>
                <p className="statusLine">独立使用已验证通路：auto-best → f2slot → direct，可自由选择标签和图片进行下发测试。</p>
              </div>
              <button className="smallButton" disabled={imageTestRunning} onClick={() => runLocalImageRenderTest()}>
                <Send size={16} /> {imageTestRunning ? '执行中...' : imageTestForm.dryRun ? '执行 dryRun' : '一键下发测试'}
              </button>
            </div>

            <div className="resultGrid">
              <div>
                <h3>AP 队列状态</h3>
                <p className="statusLine">
                  rw_task_rest：{latestApQueueStatus?.rest ?? '-'}
                  {latestApQueueStatus?.time ? ` · ${new Date(latestApQueueStatus.time).toLocaleTimeString()}` : ''}
                  {latestApQueueStatus?.recentDownlinks !== undefined ? ` · 关联任务 ${latestApQueueStatus.recentDownlinks}` : ''}
                </p>
                <p className="statusLine">
                  {latestApQueueStatus?.rest && latestApQueueStatus.rest > 0
                    ? 'AP 队列未清空，连续点击会继续排队，稍后可能集中刷屏。'
                    : '队列为空或尚未收到 AP_REPORT_STATUS。'}
                </p>
              </div>
              <div>
                <h3>最近执行确认</h3>
                <p className="statusLine">{latestImageTraceInsight?.summary ?? '暂无最近 trace'}</p>
                <p className="statusLine">最近 queue_id：{latestImageTraceInsight?.queueId ?? imageActionResult?.protocol?.queueId ?? imageTestResult?.replay?.trackingId ?? '-'}</p>
              </div>
            </div>

            <div className="commandWorkbench fourCols">
              <label>目标基站
                <select
                  value={imageTestForm.apId}
                  onChange={(event) => setImageTestForm((current) => ({ ...current, apId: event.target.value }))}
                >
                  {aps.map((ap) => <option key={ap.id} value={ap.id}>{ap.name} · {ap.id} · {ap.status}</option>)}
                </select>
              </label>
              <label>目标价签
                <select
                  value={imageTestForm.eslCode}
                  onChange={(event) => setImageTestForm((current) => ({ ...current, eslCode: event.target.value }))}
                >
                  {labels
                    .filter((label) => !looksLikeDemoEslCode(label.id))
                    .map((label) => <option key={label.id} value={label.id}>{labelOptionText(label)}</option>)}
                </select>
              </label>
              <label>发送模式
                <select
                  value={imageTestForm.sendMode}
                  onChange={(event) => setImageTestForm((current) => ({ ...current, sendMode: event.target.value as 'direct' | 'replay' }))}
                >
                  <option value="direct">direct（推荐，不依赖官方捕获）</option>
                  <option value="replay">replay（兼容模式）</option>
                </select>
              </label>
              <label>渲染范围
                <select
                  value={imageTestForm.renderMode}
                  onChange={(event) => setImageTestForm((current) => ({ ...current, renderMode: event.target.value as 'full' | 'f2slot' | 'official' | 'service0c_replay' | 'service0c_local' }))}
                >
                  <option value="service0c_local">本地生成 0C 全屏（新解析）</option>
                  <option value="service0c_replay">本地重放完美 0C 包（确定复现）</option>
                  <option value="full">本地全屏实验（默认，不走官方）</option>
                  <option value="f2slot">模板槽位（稳定，但只在模板图片区显示）</option>
                  <option value="official">官方辅助采样（只用于对比，不推荐默认）</option>
                </select>
              </label>
              <label>全屏编码策略
                <select
                  value={imageTestForm.fullVariant}
                  onChange={(event) => setImageTestForm((current) => ({ ...current, fullVariant: event.target.value as 'single_chunk' | 'stacked_rows' | 'stacked_rows_triple' | 'first_quartet' | 'legacy' }))}
                >
                  <option value="stacked_rows">stacked_rows（稳定，单分组）</option>
                  <option value="single_chunk">single_chunk（主帧覆盖，实验）</option>
                  <option value="stacked_rows_triple">stacked_rows_triple（全高三段，实验）</option>
                  <option value="first_quartet">first_quartet（仅前4块）</option>
                  <option value="legacy">legacy（旧算法，仅回退排查）</option>
                </select>
              </label>
              <label>全屏分组
                <select
                  value={imageTestForm.fullQuartet}
                  onChange={(event) => setImageTestForm((current) => ({ ...current, fullQuartet: event.target.value }))}
                >
                  <option value="0">quartet 0（chunk 1-4）</option>
                  <option value="1">quartet 1（chunk 5-8，默认）</option>
                  <option value="2">quartet 2（chunk 9-12）</option>
                </select>
              </label>
              <label>TopN
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={imageTestForm.topN}
                  onChange={(event) => setImageTestForm((current) => ({ ...current, topN: Number(event.target.value) }))}
                />
              </label>
              <label>标签尺寸
                <select
                  value={imageTestForm.renderPreset}
                  onChange={(event) => setImageTestForm((current) => ({ ...current, renderPreset: event.target.value }))}
                >
                  {LABEL_SIZE_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label>画布/编码尺寸
                <select
                  value={imageTestForm.canvasPreset}
                  onChange={(event) => {
                    const canvasPreset = event.target.value;
                    const strategy = strategyForCanvasPreset(canvasPreset);
                    setImageTestForm((current) => ({
                      ...current,
                      canvasPreset,
                      imageRotate: strategy.imageRotate,
                      imageFlip: strategy.imageFlip,
                    }));
                  }}
                >
                  {IMAGE_CANVAS_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
                <small className="fieldHint">自动策略：{strategyForCanvasPreset(imageTestForm.canvasPreset).note}</small>
              </label>
              {imageTestForm.canvasPreset === 'custom' && (
                <>
                  <label>自定义类型
                    <select
                      value={imageTestForm.customCanvasType}
                      onChange={(event) => setImageTestForm((current) => ({ ...current, customCanvasType: event.target.value as '03' | '03-01' | '03-02' | '03-03' | '03-04' | '03-0a' | '0c' }))}
                    >
                      <option value="03">03（1bpp 服务 03）</option>
                      <option value="03-01">03-01（2bpp 服务 03，容器 01）</option>
                      <option value="03-02">03-02（2bpp 服务 03，173014D6/4518）</option>
                      <option value="03-03">03-03（2bpp 服务 03，174004d2/4518）</option>
                      <option value="03-04">03-04（2bpp 服务 03，176002f7/4518）</option>
                      <option value="03-0a">03-0A（2bpp 服务 03，1770008e/4518）</option>
                      <option value="0c">0C（2bpp 服务 0C）</option>
                    </select>
                  </label>
                  <label>自定义宽
                    <input
                      type="number"
                      min={16}
                      max={1200}
                      value={imageTestForm.customCanvasWidth}
                      onChange={(event) => setImageTestForm((current) => ({ ...current, customCanvasWidth: event.target.value }))}
                    />
                  </label>
                  <label>自定义高
                    <input
                      type="number"
                      min={16}
                      max={1200}
                      value={imageTestForm.customCanvasHeight}
                      onChange={(event) => setImageTestForm((current) => ({ ...current, customCanvasHeight: event.target.value }))}
                    />
                  </label>
                  {imageTestForm.customCanvasType === '03' && (
                    <>
                      <label>03 行字节
                        <input
                          type="number"
                          min={1}
                          placeholder="自动"
                          value={imageTestForm.customCanvasRowBytes}
                          onChange={(event) => setImageTestForm((current) => ({ ...current, customCanvasRowBytes: event.target.value }))}
                        />
                      </label>
                      <label>03 输出行数
                        <input
                          type="number"
                          min={1}
                          placeholder="自动"
                          value={imageTestForm.customCanvasOutputRows}
                          onChange={(event) => setImageTestForm((current) => ({ ...current, customCanvasOutputRows: event.target.value }))}
                        />
                      </label>
                    </>
                  )}
                </>
              )}
              <label>图片缩放
                <select
                  value={imageTestForm.renderScale}
                  onChange={(event) => setImageTestForm((current) => ({ ...current, renderScale: event.target.value }))}
                >
                  <option value="1">100%（原始填充）</option>
                  <option value="0.9">90%（稍小）</option>
                  <option value="0.8">80%（中等）</option>
                  <option value="0.7">70%（偏小）</option>
                  <option value="0.6">60%（较小）</option>
                  <option value="0.5">50%（半屏）</option>
                  <option value="0.4">40%</option>
                  <option value="0.3">30%</option>
                </select>
              </label>
              <label>图片旋转
                <select
                  value={imageTestForm.imageRotate}
                  disabled
                  onChange={(event) => setImageTestForm((current) => ({ ...current, imageRotate: event.target.value as ImageRotate }))}
                >
                  {IMAGE_ROTATE_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label>图片翻转
                <select
                  value={imageTestForm.imageFlip}
                  disabled
                  onChange={(event) => setImageTestForm((current) => ({ ...current, imageFlip: event.target.value as ImageFlip }))}
                >
                  {IMAGE_FLIP_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label>测试图片
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => setImageTestFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <label>服务器本地图片
                <input
                  value={imageTestForm.localImageName}
                  onChange={(event) => setImageTestForm((current) => ({ ...current, localImageName: event.target.value }))}
                  placeholder="111111.jpg"
                />
              </label>
              <label>图片闪灯 payload
                <input
                  value={imageTestForm.ledB64dat}
                  onChange={(event) => setImageTestForm((current) => ({ ...current, ledB64dat: event.target.value }))}
                  placeholder="AGQAZP8sAQ=="
                />
                <small className="fieldHint">官方 direct+led 捕获：01-00-00-07 / {imageTestForm.ledB64dat || 'AGQAZP8sAQ=='}</small>
              </label>
              <label className="checkLabel"><input type="checkbox" checked={imageTestForm.fourColor} onChange={(event) => setImageTestForm((current) => ({ ...current, fourColor: event.target.checked }))} /> 红黄黑白四色预处理</label>
              <label className="checkLabel"><input type="checkbox" checked={imageTestForm.fastMode} onChange={(event) => setImageTestForm((current) => ({ ...current, fastMode: event.target.checked }))} /> fastMode 快速筛选</label>
              <label className="checkLabel"><input type="checkbox" checked={imageTestForm.imageLed} onChange={(event) => setImageTestForm((current) => ({ ...current, imageLed: event.target.checked }))} /> 下发图片同时闪灯（复刻官方 direct+led）</label>
              <label className="checkLabel"><input type="checkbox" checked={imageTestForm.dryRun} onChange={(event) => setImageTestForm((current) => ({ ...current, dryRun: event.target.checked }))} /> dryRun（只算参数不下发）</label>
            </div>

            <section className="panelSubsection">
              <div className="sectionHead compactHead">
                <div>
                  <h3>价签操作</h3>
                  <p className="statusLine">使用当前目标基站和目标价签发送，队列未清空时不要连续重复点击。</p>
                </div>
              </div>
              <div className="commandWorkbench fiveCols">
                <label>LED R<input type="number" value={docCommand.r} onChange={(event) => setDocCommand({ ...docCommand, r: Number(event.target.value) })} /></label>
                <label>LED G<input type="number" value={docCommand.g} onChange={(event) => setDocCommand({ ...docCommand, g: Number(event.target.value) })} /></label>
                <label>LED B<input type="number" value={docCommand.b} onChange={(event) => setDocCommand({ ...docCommand, b: Number(event.target.value) })} /></label>
                <label>亮灯 ms<input type="number" value={docCommand.time_on_ms} onChange={(event) => setDocCommand({ ...docCommand, time_on_ms: Number(event.target.value) })} /></label>
                <label>持续 s<input type="number" value={docCommand.time_s} onChange={(event) => setDocCommand({ ...docCommand, time_s: Number(event.target.value) })} /></label>
                <label>刷新 index<input type="number" value={docCommand.index} onChange={(event) => setDocCommand({ ...docCommand, index: Number(event.target.value) })} /></label>
                <label>换组 group<input type="number" value={docCommand.group} onChange={(event) => setDocCommand({ ...docCommand, group: Number(event.target.value) })} /></label>
                <label>NDEF/OTA b64<input value={docCommand.b64dat} onChange={(event) => setDocCommand({ ...docCommand, b64dat: event.target.value })} /></label>
                <label className="checkLabel"><input type="checkbox" checked={docCommand.prePsm} onChange={(event) => setDocCommand({ ...docCommand, prePsm: event.target.checked })} /> 图像类先发 AP_PSM</label>
              </div>
              <div className="toolbar commandToggles">
                {IMAGE_TEST_TAG_ACTIONS.map((action) => (
                  <button
                    key={action.value}
                    className="smallButton"
                    disabled={Boolean(imageActionRunning)}
                    onClick={() => sendImageTestDocumentCommand(action.value, action.label)}
                  >
                    {imageActionRunning === action.value ? '发送中...' : action.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="panelSubsection">
              <div className="sectionHead compactHead">
                <div>
                  <h3>基站操作</h3>
                  <p className="statusLine">重启、休眠和 OTA 会影响当前基站连接，执行前会二次确认。</p>
                </div>
              </div>
              <div className="commandWorkbench fiveCols">
                <label>PSM 模式
                  <select value={docCommand.psmMode} onChange={(event) => setDocCommand({ ...docCommand, psmMode: event.target.value })}>
                    <option value="fast">fast</option>
                    <option value="default">default</option>
                    <option value="slow">slow</option>
                    <option value="sleep">sleep</option>
                    <option value="disable">disable</option>
                  </select>
                </label>
                <label>adv_group<input type="number" value={docCommand.adv_group} onChange={(event) => setDocCommand({ ...docCommand, adv_group: Number(event.target.value) })} /></label>
                <label>duration_ms<input type="number" value={docCommand.duration_ms} onChange={(event) => setDocCommand({ ...docCommand, duration_ms: Number(event.target.value) })} /></label>
                <label>act_time_us<input type="number" value={docCommand.act_time_us} onChange={(event) => setDocCommand({ ...docCommand, act_time_us: Number(event.target.value) })} /></label>
                <label>slp_cycle_ms<input type="number" value={docCommand.slp_cycle_ms} onChange={(event) => setDocCommand({ ...docCommand, slp_cycle_ms: Number(event.target.value) })} /></label>
                <label>adv_interval_ms<input type="number" value={docCommand.adv_interval_ms} onChange={(event) => setDocCommand({ ...docCommand, adv_interval_ms: Number(event.target.value) })} /></label>
                <label>retry_num<input type="number" value={docCommand.retry_num} onChange={(event) => setDocCommand({ ...docCommand, retry_num: Number(event.target.value) })} /></label>
                <label>parallel_num<input type="number" value={docCommand.parallel_num} onChange={(event) => setDocCommand({ ...docCommand, parallel_num: Number(event.target.value) })} /></label>
                <label>ap_chn_num<input type="number" value={docCommand.ap_chn_num} onChange={(event) => setDocCommand({ ...docCommand, ap_chn_num: Number(event.target.value) })} /></label>
                <label>AP OTA URL<input value={docCommand.url} onChange={(event) => setDocCommand({ ...docCommand, url: event.target.value })} /></label>
                <label>AP OTA MD5<input value={docCommand.md5} onChange={(event) => setDocCommand({ ...docCommand, md5: event.target.value })} /></label>
              </div>
              <div className="toolbar commandToggles">
                {IMAGE_TEST_AP_ACTIONS.map((action) => (
                  <button
                    key={action.value}
                    className="smallButton"
                    disabled={Boolean(imageActionRunning)}
                    onClick={() => sendImageTestDocumentCommand(action.value, action.label)}
                  >
                    {imageActionRunning === action.value ? '发送中...' : action.label}
                  </button>
                ))}
              </div>
            </section>

            <p className="statusLine">文件：{imageTestFile?.name ?? (imageTestForm.localImageName || '未选择')} · 状态：{imageTestStatus}</p>
            <p className="statusLine">操作台：{imageActionStatus}</p>
            <div className="resultGrid">
              <div>
                <h3>执行结果</h3>
                <pre>{imageTestResult ? JSON.stringify(imageTestResult, null, 2) : '未执行'}</pre>
              </div>
              <div>
                <h3>操作结果</h3>
                <pre>{imageActionResult ? JSON.stringify(imageActionResult, null, 2) : '未执行'}</pre>
              </div>
              <div>
                <h3>使用说明</h3>
                <pre>{[
                  '1. 选择目标基站与价签',
                  '2. 选择渲染范围（全屏实验 / 模板槽位）',
                  '3. 全屏模式下优先用 stacked_rows（抗条纹）',
                  '4. 选择标签尺寸与图片缩放',
                  '5. 03 是 01-00-00-03 黑白/1bpp；03-04/03-0A 是 01-00-00-03 四色/2bpp 的不同容器类型；0C 是 01-00-00-0c 四色/2bpp',
                  '6. 选择本地图片文件',
                  '7. 默认保持 fastMode=true + fourColor=true',
                  '8. 点击“一键下发测试”',
                  '9. 若只想看参数筛选结果，打开 dryRun',
                ].join('\n')}</pre>
              </div>
            </div>
          </section>
        )}

        {activeView === 'logs' && (
          <section className="panel">
            <div className="sectionHead">
              <div>
                <h2>接入日志</h2>
                <p className="statusLine">当前 {logs.length} 条，最后刷新 {logsLoadedAt}</p>
              </div>
              <div className="toolbar">
                <label className="checkLabel"><input type="checkbox" checked={showAllLogs} onChange={(event) => setShowAllLogs(event.target.checked)} /> 显示控制台请求</label>
                <button className="smallButton" onClick={() => refreshLogs().catch((error: Error) => setMessage(error.message))}>刷新日志</button>
              </div>
            </div>
            <div className="logList">
              {logs.length === 0 && <p className="statusLine">还没有收到除控制台外的请求。基站如果真的打到 4000，这里会立刻出现路径、IP 和状态码。</p>}
              {logs.map((log) => (
                <article key={log.id}>
                  <b>{log.method} {log.path}</b>
                  <span>{log.statusCode ?? '-'} · {log.ip ?? '-'} · {new Date(log.time).toLocaleString()}</span>
                  <code>{log.userAgent ?? 'no user-agent'}</code>
                  {log.body ? <pre>{JSON.stringify(log.body, null, 2)}</pre> : null}
                </article>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

function CloudConfig({ store, storeCode, mqttStats, detailed = false }: { store: StoreConfig | null; storeCode: string; mqttStats: MqttStats | null; detailed?: boolean }) {
  return (
    <div className="panel">
      <h2>基站填写参数</h2>
      <dl className="configList">
        <dt>服务器地址</dt><dd>{store?.serverUrl ?? 'http://localhost:4000'}</dd>
        <dt>门店编号</dt><dd>{store?.code ?? storeCode}</dd>
        <dt>用户名</dt><dd>admin</dd>
        <dt>密码</dt><dd>admin123456</dd>
        <dt>MQTT TCP</dt><dd>{store?.mqttTcpPort ?? 1883}</dd>
        <dt>MQTT WebSocket</dt><dd>ws://服务器IP:4001{store?.mqttWsPath ?? '/mqtt'}</dd>
        <dt>MQTT 模式</dt><dd>{mqttStats?.mode === 'external' ? '外部 EMQX' : '内置本地 Broker'}</dd>
        <dt>EMQX 状态</dt><dd>{mqttStats?.mode === 'external' ? `${mqttStats.external.host}:${mqttStats.external.port} · ${mqttStats.external.connected ? '已连接' : '未连接'}` : '未启用外部 EMQX'}</dd>
      </dl>
      {detailed && (
        <div className="notice">
          <strong>注意</strong>
          <p>真实基站不能填 localhost。localhost 指的是基站自己，不是你的电脑或云服务器。局域网测试要填电脑 IP，例如 http://192.168.1.23:4000；AWS 上线后填你的公网域名。</p>
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
