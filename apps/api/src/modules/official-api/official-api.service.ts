import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as zlib from 'node:zlib';
import { loadEnvFiles } from '../../shared/load-env';
import { MemoryStore } from '../../shared/memory-store';
import { ApWebsocketService } from '../ap-websocket/ap-websocket.service';

type OfficialApiBody = {
  apiName?: string;
  resource?: string;
  action?: string;
  method?: 'GET' | 'POST';
  payload?: Record<string, unknown>;
  query?: Record<string, unknown>;
  timeoutMs?: number;
};

type AutoTemplateSamplesBody = {
  apiName?: string;
  apId: string;
  eslCode: string;
  templateId: number;
  sign?: string;
  storeCode?: string;
  fieldName?: string;
  values?: string[];
  productCodePrefix?: string;
  productNamePrefix?: string;
  basePrice?: number;
  varyAuxiliaryFields?: boolean;
  timeoutMs?: number;
};

type AutoBleTemplateSamplesBody = {
  apiName?: string;
  apId: string;
  eslCode: string;
  templateId: number;
  sign?: string;
  storeCode?: string;
  fieldName?: string;
  values?: string[];
  productCodePrefix?: string;
  productNamePrefix?: string;
  basePrice?: number;
  varyAuxiliaryFields?: boolean;
  timeoutMs?: number;
};

type DirectAndCaptureBody = {
  apiName?: string;
  apId: string;
  eslCode: string;
  templateId: number;
  sign?: string;
  storeCode?: string;
  product?: Record<string, unknown>;
  timeoutMs?: number;
};

type SendImage4515Body = {
  apiName?: string;
  apId: string;
  eslCode: string;
  imageUrl: string;
  templateId?: number;
  imageFieldName?: string;
  sign?: string;
  storeCode?: string;
  productCode?: string;
  productName?: string;
  price?: number;
  timeoutMs?: number;
};

type SendImage4515FileBody = {
  apiName?: string;
  apId: string;
  eslCode: string;
  templateId?: number;
  imageFieldName?: string;
  sign?: string;
  storeCode?: string;
  productCode?: string;
  productName?: string;
  price?: number;
  timeoutMs?: number;
  fourColor?: boolean | string;
};

type SendImage4515FileLocalGeneratedBody = SendImage4515FileBody & {
  mode?: 'non55' | 'full' | 'f2slot';
  renderMode?: 'full' | 'f2slot' | 'official' | 'service0c_replay' | 'service0c_local';
  fullVariant?: 'single_chunk' | 'stacked_rows' | 'stacked_rows_triple' | 'first_quartet' | 'legacy';
  fullQuartet?: number | string;
  localImageName?: string;
  seedCaptureId?: string;
  sendMode?: 'direct' | 'replay';
  fit?: 'stretch' | 'contain_black' | 'contain_white' | 'cover';
  dither?: boolean | string;
  resample?: 'nearest' | 'bilinear' | 'bicubic' | 'lanczos';
  renderPreset?: string;
  canvasPreset?: string;
  renderScale?: number | string;
  dryRun?: boolean | string;
};

type Sweep4515Body = Omit<SendImage4515FileLocalGeneratedBody, 'mode' | 'fit' | 'resample' | 'dither' | 'sendMode' | 'dryRun'> & {
  fits?: Array<'stretch' | 'contain_black' | 'contain_white' | 'cover'>;
  resamples?: Array<'nearest' | 'bilinear' | 'bicubic' | 'lanczos'>;
  dithers?: Array<boolean | string>;
  topN?: number;
  fastMode?: boolean | string;
};

type AutoBest4515Body = Omit<SendImage4515FileLocalGeneratedBody, 'mode' | 'fit' | 'resample' | 'dither'> & {
  fits?: Array<'stretch' | 'contain_black' | 'contain_white' | 'cover'>;
  resamples?: Array<'nearest' | 'bilinear' | 'bicubic' | 'lanczos'>;
  dithers?: Array<boolean | string>;
  topN?: number;
  fastMode?: boolean | string;
};

type F2SlotCandidate = {
  fitMode: 'stretch' | 'contain_black' | 'contain_white' | 'cover';
  resample: 'nearest' | 'bilinear' | 'bicubic' | 'lanczos';
  dither: boolean;
  renderPreset: string;
  renderScale: number;
  generatedService03Bytes: number;
  generatedService03Sha256: string;
  f2slotStats: {
    totalPixels: number;
    code0: number;
    code1: number;
    code2: number;
    code3: number;
    code0Ratio: number;
    code1Ratio: number;
    code2Ratio: number;
    code3Ratio: number;
  };
  baseScore: number;
  historyBoost: number;
  score: number;
};

type F2SlotHistoryEntry = {
  imageSha256: string;
  candidateKey: string;
  fitMode: 'stretch' | 'contain_black' | 'contain_white' | 'cover';
  resample: 'nearest' | 'bilinear' | 'bicubic' | 'lanczos';
  dither: boolean;
  usedCount: number;
  successCount: number;
  lastResultOk?: boolean;
  lastScore?: number;
  generatedService03Sha256?: string;
  generatedService03Bytes?: number;
  createdAt: string;
  updatedAt: string;
};

type Service03CacheItem = {
  key: string;
  templateId: number;
  imageFieldName: string;
  imageSha256: string;
  service03B64: string;
  service03Bytes: number;
  sourceCaptureId?: string;
  createdAt: string;
  updatedAt: string;
};

type ServiceChunk = {
  cid: number;
  comp: Buffer;
  dec: Buffer;
};

function compact(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
}

function templateIdOrDefault(value?: number) {
  return Number(value ?? 4515);
}

@Injectable()
export class OfficialApiService {
  constructor(
    private readonly db: MemoryStore,
    private readonly apWebsocket: ApWebsocketService,
  ) {}

  private readonly service03CachePath = join(process.cwd(), 'data', 'service03-cache.json');
  private readonly f2slotHistoryPath = join(process.cwd(), 'data', 'f2slot-history.json');

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async call(body: OfficialApiBody) {
    loadEnvFiles();
    const baseUrl = (process.env.OFFICIAL_CLOUD_URL || process.env.UPSTREAM_CLOUD_URL || 'http://43.153.107.21').replace(/\/$/, '');
    const apiName = body.apiName || process.env.OFFICIAL_API_NAME || 'default';
    const resource = body.resource || 'esl_ble';
    const action = body.action || 'direct';
    const method = body.method || 'POST';
    const path = `/api/${encodeURIComponent(apiName)}/${encodeURIComponent(resource)}/${encodeURIComponent(action)}`;
    const url = new URL(`${baseUrl}${path}`);
    const sign = String(body.payload?.sign || body.query?.sign || process.env.OFFICIAL_API_SIGN || '80805d794841f1b4');
    const storeCode = String(body.payload?.store_code || body.query?.store_code || process.env.UPSTREAM_STORE_CODE || '20248517');
    const common = { store_code: storeCode, is_base64: '0', sign };

    let responseText = '';
    let status = 0;
    try {
      const payload = compact({ ...common, ...(body.payload ?? {}) });
      const query = compact({ ...common, ...(body.query ?? {}) });
      const timeoutMs = Number(body.timeoutMs ?? process.env.OFFICIAL_API_TIMEOUT_MS ?? 60_000);
      const signal = AbortSignal.timeout(timeoutMs);
      const response = method === 'GET'
        ? await fetch(this.withQuery(url, query), { method, headers: { accept: 'application/json' }, signal })
        : await fetch(url, {
          method,
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal,
        });

      status = response.status;
      responseText = await response.text();
      const parsed = this.parseBody(responseText);
      this.db.recordRequest({
        method: 'OFFICIAL-API',
        path,
        statusCode: status,
        body: {
          method,
          url: url.toString(),
          request: method === 'GET' ? query : payload,
          response: parsed,
        },
      });
      return {
        ok: response.ok,
        status,
        url: url.toString(),
        request: method === 'GET' ? query : payload,
        response: parsed,
      };
    } catch (error) {
      this.db.recordRequest({
        method: 'OFFICIAL-API',
        path,
        statusCode: 502,
        body: {
          method,
          url: url.toString(),
          error: error instanceof Error ? error.message : String(error),
          responseText,
        },
      });
      return {
        ok: false,
        status: status || 502,
        url: url.toString(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async autoTemplateSamples(body: AutoTemplateSamplesBody) {
    const apId = body.apId;
    const eslCode = body.eslCode;
    const templateId = Number(body.templateId);
    const fieldName = (body.fieldName || 'f1').replace(/^#/, '');
    const values = (body.values?.length ? body.values : ['AAAAA', 'AAAAB', 'AAAAC']).map((value) => String(value));
    const storeCode = String(body.storeCode || process.env.UPSTREAM_STORE_CODE || '20248517');
    const sign = String(body.sign || process.env.OFFICIAL_API_SIGN || '80805d794841f1b4');
    const productCodePrefix = body.productCodePrefix || 'AUTO';
    const productNamePrefix = body.productNamePrefix || 'AUTO';
    const basePrice = Number(body.basePrice ?? 19.9);
    const varyAuxiliaryFields = body.varyAuxiliaryFields === true;
    const timeoutMs = Number(body.timeoutMs ?? 180_000);
    const common = { store_code: storeCode, is_base64: '0', sign };

    const startedAt = new Date().toISOString();
    const results: Array<Record<string, unknown>> = [];

    for (const [index, value] of values.entries()) {
      const sampleStartedAtMs = Date.now();
      const beforeIds = new Set(
        this.db.officialDownlinkCaptures
          .filter((capture) => capture.apId === apId)
          .map((capture) => capture.id),
      );
      const suffix = `${Date.now().toString(36)}-${index + 1}`;
      const stableProductCode = `${productCodePrefix}-stable`;
      const stableProductName = `${productNamePrefix}-stable`;
      const productCode = fieldName === 'pc'
        ? value
        : varyAuxiliaryFields
          ? `${productCodePrefix}-${suffix}`
          : stableProductCode;
      const productName = fieldName === 'pn'
        ? value
        : varyAuxiliaryFields
          ? `${productNamePrefix}-${value}`
          : stableProductName;
      const price = fieldName === 'pp'
        ? Number(value)
        : varyAuxiliaryFields
          ? Number((basePrice + index * 0.01).toFixed(2))
          : basePrice;
      const product: Record<string, unknown> = {
        pc: productCode,
        pn: productName,
        pp: price,
        [fieldName]: value,
      };
      const match = fieldName.match(/^f(\d{1,2})$/i);
      if (match) {
        product[`field${match[1]}`] = value;
      }

      const directItem = {
        esl_code: eslCode,
        template_id: templateId,
        product,
      };
      let apiResult = await this.call({
        apiName: body.apiName,
        resource: 'esl',
        action: 'direct',
        method: 'POST',
        payload: {
          ...common,
          f1: [directItem],
        },
        query: {
          ...common,
          f1: [directItem],
        },
      });
      if (!apiResult.ok && apiResult.status >= 500) {
        await this.sleep(3000);
        apiResult = await this.call({
          apiName: body.apiName,
          resource: 'esl',
          action: 'direct',
          method: 'POST',
          payload: {
            ...common,
            f1: [directItem],
          },
          query: {
            ...common,
            f1: [directItem],
          },
        });
      }

      const capture = apiResult.ok
        ? await this.waitForReadWriteCapture(apId, beforeIds, timeoutMs, eslCode, sampleStartedAtMs)
        : undefined;
      results.push({
        index: index + 1,
        value,
        productCode,
        productName,
        price,
        api: apiResult,
        capture: capture ? this.summarizeCapture(capture) : undefined,
      });
    }

    return {
      startedAt,
      apId,
      eslCode,
      templateId,
      fieldName,
      values,
      results,
    };
  }

  async autoBleTemplateSamples(body: AutoBleTemplateSamplesBody) {
    const apId = body.apId;
    const eslCode = body.eslCode;
    const templateId = Number(body.templateId);
    const fieldName = (body.fieldName || 'pn').replace(/^#/, '');
    const values = (body.values?.length ? body.values : ['AUTO-A', 'AUTO-B', 'AUTO-C']).map((value) => String(value));
    const storeCode = String(body.storeCode || process.env.UPSTREAM_STORE_CODE || '20248517');
    const sign = String(body.sign || process.env.OFFICIAL_API_SIGN || '80805d794841f1b4');
    const productCodePrefix = body.productCodePrefix || 'AUTO';
    const productNamePrefix = body.productNamePrefix || 'AUTO';
    const basePrice = Number(body.basePrice ?? 19.9);
    const varyAuxiliaryFields = body.varyAuxiliaryFields !== false;
    const timeoutMs = Number(body.timeoutMs ?? 180_000);
    const common = { store_code: storeCode, is_base64: '0', sign };

    const startedAt = new Date().toISOString();
    const results: Array<Record<string, unknown>> = [];

    for (const [index, value] of values.entries()) {
      const sampleStartedAtMs = Date.now();
      const beforeIds = new Set(
        this.db.officialDownlinkCaptures
          .filter((capture) => capture.apId === apId)
          .map((capture) => capture.id),
      );
      const suffix = `${Date.now().toString(36)}-${index + 1}`;
      const productCode = fieldName === 'pc'
        ? value
        : varyAuxiliaryFields
          ? `${productCodePrefix}-${suffix}`
          : `${productCodePrefix}-stable`;
      const productName = fieldName === 'pn'
        ? value
        : varyAuxiliaryFields
          ? `${productNamePrefix}-${value}`
          : `${productNamePrefix}-stable`;
      const price = fieldName === 'pp'
        ? Number(value)
        : varyAuxiliaryFields
          ? Number((basePrice + index * 0.01).toFixed(2))
          : basePrice;

      const item = {
        esl_code: eslCode,
        template_id: templateId,
        product: {
          pc: productCode,
          pn: productName,
          pp: price,
          [fieldName]: value,
        },
        led: [
          { r: 0, g: 100, b: 0, time_on: 120, time: 2 },
        ],
      };

      const apiResult = await this.call({
        apiName: body.apiName,
        resource: 'esl_ble',
        action: 'direct',
        method: 'POST',
        payload: {
          ...common,
          f1: JSON.stringify([item]),
        },
        query: {
          ...common,
          f1: JSON.stringify([item]),
        },
      });

      const capture = apiResult.ok
        ? await this.waitForReadWriteCapture(apId, beforeIds, timeoutMs, eslCode, sampleStartedAtMs)
        : undefined;

      results.push({
        index: index + 1,
        value,
        productCode,
        productName,
        price,
        api: apiResult,
        capture: capture ? this.summarizeCapture(capture) : undefined,
      });
    }

    return {
      startedAt,
      apId,
      eslCode,
      templateId,
      fieldName,
      values,
      results,
    };
  }

  async directAndCapture(body: DirectAndCaptureBody) {
    const apId = body.apId;
    const eslCode = body.eslCode;
    const templateId = Number(body.templateId);
    const storeCode = String(body.storeCode || process.env.UPSTREAM_STORE_CODE || '20248517');
    const sign = String(body.sign || process.env.OFFICIAL_API_SIGN || '80805d794841f1b4');
    const timeoutMs = Number(body.timeoutMs ?? 180_000);
    const common = { store_code: storeCode, is_base64: '0', sign };

    const beforeIds = new Set(
      this.db.officialDownlinkCaptures
        .filter((capture) => capture.apId === apId)
        .map((capture) => capture.id),
    );
    const sampleStartedAtMs = Date.now();

    const directItem = {
      esl_code: eslCode,
      template_id: templateId,
      product: body.product ?? { pn: `AUTO-${Date.now().toString(36)}` },
    };

    const apiResult = await this.call({
      apiName: body.apiName,
      resource: 'esl',
      action: 'direct',
      method: 'POST',
      timeoutMs,
      payload: {
        ...common,
        f1: [directItem],
      },
      query: {
        ...common,
        f1: [directItem],
      },
    });

    const capture = apiResult.ok
      ? await this.waitForReadWriteCapture(apId, beforeIds, timeoutMs, eslCode, sampleStartedAtMs)
      : undefined;

    const summary = capture ? this.summarizeCapture(capture) : undefined;
    const service0c = capture?.text ? this.extractServiceBytes(capture.text, '01-00-00-0c') : undefined;
    const services = capture?.text ? this.extractReadWriteServices(capture.text) : [];
    return {
      ok: Boolean(apiResult.ok && capture),
      apId,
      eslCode,
      templateId,
      api: apiResult,
      capture: capture ? { ...summary, textChars: capture.text?.length } : undefined,
      service0c: service0c ? {
        bytes: service0c.length,
        sha256: createHash('sha256').update(service0c).digest('hex'),
        b64: service0c.toString('base64'),
        headHex: service0c.subarray(0, 24).toString('hex'),
        tailHex: service0c.subarray(-24).toString('hex'),
      } : undefined,
      services,
    };
  }

  async sendImage4515(body: SendImage4515Body) {
    const imageUrl = String(body.imageUrl || '').trim();
    if (!/^https?:\/\//i.test(imageUrl)) {
      return {
        ok: false,
        reason: 'invalid_image_url',
        message: 'imageUrl 必须是可访问的 http/https URL',
      };
    }

    const imageFieldName = String(body.imageFieldName || 'f2').trim();
    const templateId = Number(body.templateId ?? 4515);
    const product: Record<string, unknown> = {
      pc: String(body.productCode || `AUTO-${templateId}`),
      pn: String(body.productName || `IMG-${Date.now().toString(36)}`),
      pp: Number(body.price ?? 19.9),
      [imageFieldName]: imageUrl,
    };

    const result = await this.directAndCapture({
      apiName: body.apiName,
      apId: body.apId,
      eslCode: body.eslCode,
      templateId,
      sign: body.sign,
      storeCode: body.storeCode,
      product,
      timeoutMs: body.timeoutMs,
    });

    return {
      ...result,
      requestMeta: {
        templateId,
        imageFieldName,
        imageUrl,
      },
    };
  }

  async sendImage4515File(
    body: SendImage4515FileBody,
    file?: { buffer: Buffer; originalname?: string; mimetype?: string; size?: number },
  ) {
    if (!file?.buffer?.length) {
      return {
        ok: false,
        reason: 'missing_file',
        message: '请上传图片文件（multipart 字段名: file）',
      };
    }

    const useFourColor = this.parseBoolean(body.fourColor, true);
    const prepared = useFourColor
      ? this.convertToRybwPng(file)
      : { ...file, buffer: Buffer.from(file.buffer), originalname: file.originalname || 'image.jpg', mimetype: file.mimetype || 'application/octet-stream' };
    const imageSha256 = createHash('sha256').update(prepared.buffer).digest('hex');

    const uploaded = await this.uploadPublicImage(prepared);
    if (!uploaded.ok || !uploaded.url) {
      return {
        ok: false,
        reason: 'upload_failed',
        message: uploaded.error ?? '图片上传失败，无法获得可访问 URL',
      };
    }

    const sent = await this.sendImage4515({
      ...body,
      imageUrl: uploaded.url,
    });

    if (sent.ok && 'services' in sent) {
      const service03 = (Array.isArray(sent.services) ? sent.services : []).find(
        (service: { service?: string; b64?: string; bytes?: number }) => service.service === '01-00-00-03' && typeof service.b64 === 'string',
      );
      if (service03?.b64) {
        const templateId = templateIdOrDefault(body.templateId);
        const imageFieldName = String(body.imageFieldName || 'f2');
        this.upsertService03Cache({
          key: this.buildService03CacheKey(templateId, imageFieldName, imageSha256),
          templateId,
          imageFieldName,
          imageSha256,
          service03B64: String(service03.b64),
          service03Bytes: Number(service03.bytes || 0),
          sourceCaptureId: 'capture' in sent ? sent.capture?.id : undefined,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    return {
      ...sent,
      upload: {
        provider: uploaded.provider,
        imageUrl: uploaded.url,
        bytes: prepared.size ?? prepared.buffer.length,
        filename: prepared.originalname,
        mime: prepared.mimetype,
        fourColor: useFourColor,
        imageSha256,
      },
    };
  }

  async sendImage4515FileLocalOnly(
    body: SendImage4515FileBody,
    file?: { buffer: Buffer; originalname?: string; mimetype?: string; size?: number },
  ) {
    if (!file?.buffer?.length) {
      return {
        ok: false,
        reason: 'missing_file',
        message: '请上传图片文件（multipart 字段名: file）',
      };
    }

    const useFourColor = this.parseBoolean(body.fourColor, true);
    const prepared = useFourColor
      ? this.convertToRybwPng(file)
      : { ...file, buffer: Buffer.from(file.buffer), originalname: file.originalname || 'image.jpg', mimetype: file.mimetype || 'application/octet-stream' };
    const templateId = templateIdOrDefault(body.templateId);
    const imageFieldName = String(body.imageFieldName || 'f2');
    const imageSha256 = createHash('sha256').update(prepared.buffer).digest('hex');
    const cacheKey = this.buildService03CacheKey(templateId, imageFieldName, imageSha256);
    const cache = this.readService03Cache();
    const item = cache.items[cacheKey];
    if (!item?.service03B64) {
      return {
        ok: false,
        reason: 'cache_miss',
        message: '本地缓存没有这张图对应的 service03，请先调用 send-image-4515-file 生成一次。',
        cacheKey,
        imageSha256,
      };
    }

    const seed = this.pickReplaySeedCapture(body.apId, item.sourceCaptureId);
    if (!seed) {
      return {
        ok: false,
        reason: 'seed_capture_missing',
        message: '本地缺少可重放的 service03 捕获包，请先调用 send-image-4515-file。',
        cacheKey,
      };
    }

    const replay = this.apWebsocket.replayOfficialDownlink(body.apId, seed.id, {
      targetLabelId: body.eslCode,
      replacementService03B64: item.service03B64,
    });

    return {
      ok: replay.ok,
      localOnly: true,
      cacheHit: true,
      cacheKey,
      imageSha256,
      seedCaptureId: seed.id,
      sourceCaptureId: item.sourceCaptureId,
      replay,
    };
  }

  async sendImage4515FileLocalGenerated(
    body: SendImage4515FileLocalGeneratedBody,
    file?: { buffer: Buffer; originalname?: string; mimetype?: string; size?: number },
  ) {
    const effectiveFile = file ?? this.readLocalImageFile(body.localImageName);
    if (body.renderMode === 'service0c_local') {
      if (!effectiveFile?.buffer?.length) {
        return {
          ok: false,
          reason: 'missing_file',
          message: '请上传图片文件（multipart 字段名: file），或指定本地图片名 localImageName。',
        };
      }
      const useFourColor = this.parseBoolean(body.fourColor, true);
      const prepared = useFourColor
        ? this.convertToRybwPng(effectiveFile)
        : { ...effectiveFile, buffer: Buffer.from(effectiveFile.buffer), originalname: effectiveFile.originalname || 'image.jpg', mimetype: effectiveFile.mimetype || 'application/octet-stream' };
      const fitMode = this.parseFitMode(body.fit);
      const dither = this.parseBoolean(body.dither, true);
      const resample = this.parseResampleMode(body.resample);
      const renderPreset = this.parseRenderPreset(body.renderPreset);
      const renderScale = this.parseRenderScale(body.renderScale);
      const imageCanvas = this.parseImageCanvas(body.canvasPreset);
      if (imageCanvas.protocol === '03') {
        const service03Canvas = imageCanvas.canvas;
        const service03 = this.buildSmallService03FromImage(prepared.buffer, {
          fitMode,
          dither,
          resample,
          renderPreset,
          renderScale,
          canvas: service03Canvas,
        });
        const service03B64 = service03.toString('base64');
        const service03Sha256 = createHash('sha256').update(service03).digest('hex');
        if (this.parseBoolean(body.dryRun, false)) {
          return {
            ok: true,
            localOnly: true,
            generated: true,
            dryRun: true,
            mode: 'service03_1bpp_local',
            fitMode,
            dither,
            resample,
            renderPreset,
            renderScale,
            canvasPreset: body.canvasPreset ?? `${imageCanvas.protocol}:${service03Canvas.width}x${service03Canvas.height}`,
            canvas: service03Canvas,
            imageSha256: createHash('sha256').update(prepared.buffer).digest('hex'),
            generatedService03Bytes: service03.length,
            generatedService03Sha256: service03Sha256,
            autoSelection: {
              mode: 'service03_1bpp_local',
              reason: `按手动选择的 ${service03Canvas.width}x${service03Canvas.height} 画布生成 01-00-00-03 / a5a60102 / 1bpp 数据流。`,
            },
          };
        }
        const downlinkPayload = this.buildReadWriteSvcPayloadForService(body.eslCode, '01-00-00-03', service03B64, { bigsize: false });
        const replay = this.apWebsocket.sendRaw(body.apId, downlinkPayload);
        return {
          ok: replay.ok,
          localOnly: true,
          generated: true,
          mode: 'service03_1bpp_local',
          fitMode,
          dither,
          resample,
          renderPreset,
          renderScale,
          canvasPreset: body.canvasPreset ?? `${imageCanvas.protocol}:${service03Canvas.width}x${service03Canvas.height}`,
          canvas: service03Canvas,
          imageSha256: createHash('sha256').update(prepared.buffer).digest('hex'),
          generatedService03Bytes: service03.length,
          generatedService03Sha256: service03Sha256,
          replay,
          autoSelection: {
            mode: 'service03_1bpp_local',
            reason: `按手动选择的 ${service03Canvas.width}x${service03Canvas.height} 画布生成 01-00-00-03 / a5a60102 / 1bpp 数据流。`,
          },
        };
      }
      if (imageCanvas.protocol === '03_04' || imageCanvas.protocol === '03_0a') {
        const service0304 = this.buildService03BppFromImage(prepared.buffer, {
          fitMode,
          dither,
          resample,
          renderPreset,
          renderScale,
          canvas: imageCanvas.canvas,
          containerType: imageCanvas.protocol === '03_0a' ? 0x0a : 0x04,
        });
        const service0304B64 = service0304.toString('base64');
        const service0304Sha256 = createHash('sha256').update(service0304).digest('hex');
        if (this.parseBoolean(body.dryRun, false)) {
          return {
            ok: true,
            localOnly: true,
            generated: true,
            dryRun: true,
            mode: 'service03_2bpp_local',
            fitMode,
            dither,
            resample,
            renderPreset,
            renderScale,
            canvasPreset: body.canvasPreset ?? `${imageCanvas.protocol === '03_0a' ? '03-0a' : '03-04'}:${imageCanvas.canvas.width}x${imageCanvas.canvas.height}`,
            canvas: imageCanvas.canvas,
            imageSha256: createHash('sha256').update(prepared.buffer).digest('hex'),
            generatedService03Bytes: service0304.length,
            generatedService03Sha256: service0304Sha256,
            autoSelection: {
              mode: 'service03_2bpp_local',
              reason: `按官方形态生成 01-00-00-03 / a5a6${imageCanvas.protocol === '03_0a' ? '0a' : '04'}02 / 2bpp / ${imageCanvas.canvas.width}x${imageCanvas.canvas.height} 数据流。`,
            },
          };
        }
        const downlinkPayload = this.buildReadWriteSvcPayloadForService(body.eslCode, '01-00-00-03', service0304B64, { bigsize: false });
        const replay = this.apWebsocket.sendRaw(body.apId, downlinkPayload);
        return {
          ok: replay.ok,
          localOnly: true,
          generated: true,
          mode: 'service03_2bpp_local',
          fitMode,
          dither,
          resample,
          renderPreset,
          renderScale,
          canvasPreset: body.canvasPreset ?? `${imageCanvas.protocol === '03_0a' ? '03-0a' : '03-04'}:${imageCanvas.canvas.width}x${imageCanvas.canvas.height}`,
          canvas: imageCanvas.canvas,
          imageSha256: createHash('sha256').update(prepared.buffer).digest('hex'),
          generatedService03Bytes: service0304.length,
          generatedService03Sha256: service0304Sha256,
          replay,
          autoSelection: {
            mode: 'service03_2bpp_local',
            reason: `按官方形态生成 01-00-00-03 / a5a6${imageCanvas.protocol === '03_0a' ? '0a' : '04'}02 / 2bpp / ${imageCanvas.canvas.width}x${imageCanvas.canvas.height} 数据流。`,
          },
        };
      }
      const service0c = this.buildService0cFromImage(prepared.buffer, { fitMode, dither, resample, renderPreset, renderScale, canvas: imageCanvas.canvas });
      const service0cB64 = service0c.toString('base64');
      if (this.parseBoolean(body.dryRun, false)) {
        return {
          ok: true,
          localOnly: true,
          generated: true,
          dryRun: true,
          mode: 'service0c_local',
          fitMode,
          dither,
          resample,
          renderPreset,
          renderScale,
          canvasPreset: body.canvasPreset ?? `0c:${imageCanvas.canvas.width}x${imageCanvas.canvas.height}`,
          canvas: imageCanvas.canvas,
          imageSha256: createHash('sha256').update(prepared.buffer).digest('hex'),
          generatedService0cBytes: service0c.length,
          generatedService0cSha256: createHash('sha256').update(service0c).digest('hex'),
        };
      }
      const downlinkPayload = this.buildReadWriteSvcPayloadForService(body.eslCode, '01-00-00-0c', service0cB64, { supersize: true });
      const replay = this.apWebsocket.sendRaw(body.apId, downlinkPayload);
      return {
        ok: replay.ok,
        localOnly: true,
        generated: true,
        mode: 'service0c_local',
        fitMode,
        dither,
        resample,
        renderPreset,
        renderScale,
        canvasPreset: body.canvasPreset ?? `0c:${imageCanvas.canvas.width}x${imageCanvas.canvas.height}`,
        canvas: imageCanvas.canvas,
        imageSha256: createHash('sha256').update(prepared.buffer).digest('hex'),
        generatedService0cBytes: service0c.length,
        generatedService0cSha256: createHash('sha256').update(service0c).digest('hex'),
        replay,
        autoSelection: {
          mode: 'service0c_local',
          reason: '本地生成 800x480/2bpp 的 01-00-00-0c supersize 全屏数据流。',
        },
      };
    }

    if (body.renderMode === 'service0c_replay') {
      const seed = this.pickReplaySeedCaptureWithService(body.apId, '01-00-00-0c', body.seedCaptureId);
      if (!seed?.text) {
        return {
          ok: false,
          reason: 'service0c_capture_missing',
          message: '本地没有可重放的 service0c 完美包；需要先捕获一次官方/自动完美下发。',
        };
      }
      const service0c = this.extractServiceBytes(seed.text, '01-00-00-0c');
      const replay = this.apWebsocket.replayOfficialDownlink(body.apId, seed.id, {
        targetLabelId: body.eslCode,
        replacementService0cB64: service0c?.toString('base64'),
      });
      return {
        ok: replay.ok,
        localOnly: true,
        generated: false,
        mode: 'service0c_replay',
        seedCaptureId: seed.id,
        service0cBytes: service0c?.length,
        service0cSha256: service0c ? createHash('sha256').update(service0c).digest('hex') : undefined,
        replay: {
          ...replay.replay,
          replayCaptureId: replay.captureId,
          sourceReplay: replay,
        },
        autoSelection: {
          mode: 'service0c_replay',
          reason: '复用本地捕获的 01-00-00-0c supersize 完美数据流，不调用官方接口。',
        },
      };
    }

    if (body.renderMode === 'official') {
      const sent = await this.sendImage4515File({
        ...body,
        timeoutMs: body.timeoutMs ?? 30_000,
        templateId: body.templateId ?? 4515,
        imageFieldName: body.imageFieldName ?? 'f2',
      }, effectiveFile);
      return {
        ...sent,
        localOnly: false,
        generated: false,
        mode: 'official',
        autoSelection: {
          mode: 'official',
          reason: '改走官方模板合成链路，规避 full 实验模式的中间条与残影问题。',
        },
      };
    }

    if (!effectiveFile?.buffer?.length) {
      return {
        ok: false,
        reason: 'missing_file',
        message: '请上传图片文件（multipart 字段名: file），或指定本地图片名 localImageName。',
      };
    }

    const useFourColor = this.parseBoolean(body.fourColor, true);
    const prepared = useFourColor
      ? this.convertToRybwPng(effectiveFile)
      : { ...effectiveFile, buffer: Buffer.from(effectiveFile.buffer), originalname: effectiveFile.originalname || 'image.jpg', mimetype: effectiveFile.mimetype || 'application/octet-stream' };
    const mode = body.mode === 'full' ? 'full' : (body.mode === 'non55' ? 'non55' : (body.renderMode === 'full' ? 'full' : 'f2slot'));
    const fullVariant = this.parseFullVariant(body.fullVariant);
    const fullQuartet = this.parseFullQuartet(body.fullQuartet);
    const sendMode = body.sendMode === 'replay' ? 'replay' : 'direct';
    const fitMode = this.parseFitMode(body.fit);
    const dither = this.parseBoolean(body.dither, true);
    const resample = this.parseResampleMode(body.resample);
    const renderPreset = this.parseRenderPreset(body.renderPreset);
    const renderScale = this.parseRenderScale(body.renderScale);
    const dryRun = this.parseBoolean(body.dryRun, false);
    const needsBaseline = mode !== 'f2slot';
    const seed = (sendMode === 'replay' || needsBaseline) ? this.pickReplaySeedCapture(body.apId, body.seedCaptureId) : undefined;
    if ((sendMode === 'replay' || needsBaseline) && !seed?.text) {
      return {
        ok: false,
        reason: 'seed_capture_missing',
        message: needsBaseline ? '当前渲染模式需要 baseline service03（请先捕获一条官方成功包）。' : 'replay 模式缺少可重放的 service03 捕获包。',
      };
    }

    const baselineService03 = seed?.text ? this.extractServiceBytes(seed.text, '01-00-00-03') : undefined;
    if (mode !== 'f2slot' && !baselineService03) {
      return {
        ok: false,
        reason: 'baseline_service03_missing',
        message: '种子包中未找到 service03，无法进行全屏模式渲染。',
      };
    }

    const baselineBytes = baselineService03 ? Buffer.from(baselineService03) : undefined;
    const f2slotBundle = mode === 'f2slot'
      ? this.build4515F2SlotBundle(prepared.buffer, { fitMode, dither, resample, renderPreset, renderScale })
      : undefined;
    const rebuilt = f2slotBundle?.service03 ?? (
      mode === 'full'
        ? this.rebuildService03FullExperimental(
          this.parseService03Chunks(this.requireBaselineService03(baselineBytes)),
          prepared.buffer,
          {
            fitMode,
            dither,
            resample,
            renderPreset,
            renderScale,
            variant: fullVariant,
            fullQuartet,
          },
        )
        : this.rebuildService03FromImage(
          this.parseService03Chunks(this.requireBaselineService03(baselineBytes)),
          this.packImageTo2bppBytes(prepared.buffer),
          'non55',
        )
    );
    const replacementService03B64 = rebuilt.toString('base64');
    const downlinkPayload = this.buildReadWriteSvcPayload(body.eslCode, replacementService03B64);
    if (dryRun) {
      return {
        ok: true,
        localOnly: true,
        generated: true,
        dryRun: true,
        mode,
        sendMode,
        fitMode,
        dither,
        resample,
        renderPreset,
        renderScale,
        fullVariant,
        fullQuartet,
        seedCaptureId: seed?.id,
        imageSha256: createHash('sha256').update(prepared.buffer).digest('hex'),
        baselineService03Bytes: baselineBytes?.length,
        generatedService03Bytes: rebuilt.length,
        generatedService03Sha256: createHash('sha256').update(rebuilt).digest('hex'),
        f2slotStats: f2slotBundle?.stats,
        downlinkPayloadMeta: {
          type: 'READ_WRITE_SVC',
          opas: downlinkPayload.opas.length,
          service: '01-00-00-03',
          b64Chars: replacementService03B64.length,
        },
      };
    }
    const replay = sendMode === 'replay'
      ? this.apWebsocket.replayOfficialDownlink(body.apId, seed?.id || '', {
        targetLabelId: body.eslCode,
        replacementService03B64,
      })
      : this.apWebsocket.sendRaw(body.apId, downlinkPayload);

    return {
      ok: replay.ok,
      localOnly: true,
      generated: true,
      mode,
      sendMode,
      fitMode,
      dither,
      resample,
      renderPreset,
      renderScale,
      fullVariant,
      fullQuartet,
      seedCaptureId: seed?.id,
      imageSha256: createHash('sha256').update(prepared.buffer).digest('hex'),
      baselineService03Bytes: baselineBytes?.length,
      generatedService03Bytes: rebuilt.length,
      generatedService03Sha256: createHash('sha256').update(rebuilt).digest('hex'),
      f2slotStats: f2slotBundle?.stats,
      downlinkPayload,
      replay,
    };
  }

  async sweepImage4515FileLocalGenerated(
    body: Sweep4515Body,
    file?: { buffer: Buffer; originalname?: string; mimetype?: string; size?: number },
  ) {
    if (!file?.buffer?.length) {
      return {
        ok: false,
        reason: 'missing_file',
        message: '请上传图片文件（multipart 字段名: file）',
      };
    }
    const useFourColor = this.parseBoolean(body.fourColor, true);
    const prepared = useFourColor
      ? this.convertToRybwPng(file)
      : { ...file, buffer: Buffer.from(file.buffer), originalname: file.originalname || 'image.jpg', mimetype: file.mimetype || 'application/octet-stream' };
    const imageSha256 = createHash('sha256').update(prepared.buffer).digest('hex');
    const fastMode = this.parseBoolean(body.fastMode, true);
    const renderPreset = this.parseRenderPreset(body.renderPreset);
    const renderScale = this.parseRenderScale(body.renderScale);
    const fits = this.normalizeFitModes(body.fits, fastMode);
    const resamples = this.normalizeResampleModes(body.resamples, fastMode);
    const dithers = this.normalizeDitherModes(body.dithers, fastMode);
    const rows: F2SlotCandidate[] = [];
    for (const fitMode of fits) {
      for (const resample of resamples) {
        for (const dither of dithers) {
          const bundle = this.build4515F2SlotBundle(prepared.buffer, { fitMode, dither, resample, renderPreset, renderScale });
          const sha = createHash('sha256').update(bundle.service03).digest('hex');
          const s = bundle.stats;
          const entropy = this.scoreEntropy([s.code0, s.code1, s.code2, s.code3]);
          const nonWhiteRatio = 1 - s.code1Ratio;
          const baseScore = Number((entropy * 0.6 + nonWhiteRatio * 0.4).toFixed(6));
          const historyBoost = this.getHistoryBoost(imageSha256, fitMode, resample, dither);
          rows.push({
            fitMode,
            resample,
            dither,
            renderPreset,
            renderScale,
            generatedService03Bytes: bundle.service03.length,
            generatedService03Sha256: sha,
            f2slotStats: s,
            baseScore,
            historyBoost,
            score: Number((baseScore + historyBoost).toFixed(6)),
          });
        }
      }
    }
    rows.sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));
    const topN = Math.max(1, Math.min(50, Number(body.topN ?? 8)));
    return {
      ok: true,
      localOnly: true,
      sweep: true,
      imageSha256,
      fastMode,
      totalCombos: rows.length,
      topN,
      best: rows[0],
      candidates: rows.slice(0, topN),
    };
  }

  async sendImage4515FileLocalGeneratedAutoBest(
    body: AutoBest4515Body,
    file?: { buffer: Buffer; originalname?: string; mimetype?: string; size?: number },
  ) {
    if (body.renderMode === 'official') {
      const send = await this.sendImage4515FileLocalGenerated({
        ...body,
        renderMode: 'official',
        timeoutMs: body.timeoutMs ?? 30_000,
        templateId: body.templateId ?? 4515,
        imageFieldName: body.imageFieldName ?? 'f2',
      }, file);
      return {
        ...send,
        autoBest: false,
        autoSelection: {
          mode: 'official',
          reason: '官方模板合成模式不走本地 sweep，直接按模板下发。',
        },
      };
    }

    if (body.renderMode === 'service0c_replay') {
      const send = await this.sendImage4515FileLocalGenerated({
        ...body,
        renderMode: 'service0c_replay',
      }, file);
      return {
        ...send,
        autoBest: false,
        autoSelection: {
          mode: 'service0c_replay',
          reason: '直接本地重放已捕获 service0c 完美流。',
        },
      };
    }

    if (body.renderMode === 'service0c_local') {
      const send = await this.sendImage4515FileLocalGenerated({
        ...body,
        renderMode: 'service0c_local',
      }, file);
      return {
        ...send,
        autoBest: false,
        autoSelection: {
          mode: 'service0c_local',
          reason: '直接本地生成 service0c 全屏数据流，不走官方接口。',
        },
      };
    }

    const renderMode = body.renderMode === 'full' ? 'full' : 'f2slot';
    if (renderMode === 'full') {
      const send = await this.sendImage4515FileLocalGenerated({
        ...body,
        mode: 'full',
        sendMode: body.sendMode ?? 'direct',
        dryRun: body.dryRun,
      }, file);
      return {
        ...send,
        autoBest: false,
        autoSelection: {
          mode: 'full',
          reason: '全屏模式不走 f2slot 参数筛选，直接使用全屏重建通路。',
        },
      };
    }

    const firstSweep = await this.sweepImage4515FileLocalGenerated({
      ...body,
      fits: body.fits,
      resamples: body.resamples,
      dithers: body.dithers,
      topN: body.topN ?? 8,
      fastMode: body.fastMode,
    }, file);
    const needFullSweep = (
      firstSweep
      && 'ok' in firstSweep
      && firstSweep.ok
      && 'best' in firstSweep
      && firstSweep.best
      && Number((firstSweep.best as { score?: number }).score ?? 0) < 0.86
      && this.parseBoolean(body.fastMode, true)
      && !body.fits?.length
      && !body.resamples?.length
      && !body.dithers?.length
    );
    const sweep = needFullSweep
      ? await this.sweepImage4515FileLocalGenerated({
        ...body,
        topN: body.topN ?? 8,
        fastMode: false,
      }, file)
      : firstSweep;
    if (!sweep?.ok || !('best' in sweep) || !sweep.best) {
      return {
        ok: false,
        reason: 'auto_sweep_failed',
        message: '自动参数筛选失败，无法选择最优组合。',
        sweep,
      };
    }
    const best = sweep.best as {
      fitMode?: 'stretch' | 'contain_black' | 'contain_white' | 'cover';
      resample?: 'nearest' | 'bilinear' | 'bicubic' | 'lanczos';
      dither?: boolean;
      score?: number;
    };
    const send = await this.sendImage4515FileLocalGenerated({
      ...body,
      mode: 'f2slot',
      fit: best.fitMode ?? 'stretch',
      resample: best.resample ?? 'bilinear',
      dither: best.dither ?? true,
      renderPreset: typeof (sweep.best as { renderPreset?: string })?.renderPreset === 'string'
        ? (sweep.best as { renderPreset?: string }).renderPreset
        : this.parseRenderPreset(body.renderPreset),
      sendMode: body.sendMode ?? 'direct',
      dryRun: body.dryRun,
    }, file);
    const dryRun = this.parseBoolean(body.dryRun, false);
    if (!dryRun && send && typeof send === 'object' && 'imageSha256' in send) {
      const imageSha256 = String((send as { imageSha256?: string }).imageSha256 || '');
      if (imageSha256) {
        this.upsertF2SlotHistory({
          imageSha256,
          fitMode: best.fitMode ?? 'stretch',
          resample: best.resample ?? 'bilinear',
          dither: Boolean(best.dither ?? true),
          score: Number(best.score ?? 0),
          resultOk: Boolean((send as { ok?: boolean }).ok),
          generatedService03Sha256: (send as { generatedService03Sha256?: string }).generatedService03Sha256,
          generatedService03Bytes: Number((send as { generatedService03Bytes?: number }).generatedService03Bytes ?? 0),
        });
      }
    }
    return {
      ...send,
      autoBest: true,
      autoFallbackToFullSweep: needFullSweep,
      autoSelection: {
        score: best.score,
        fitMode: best.fitMode,
        resample: best.resample,
        dither: best.dither,
        renderPreset: (sweep.best as { renderPreset?: string })?.renderPreset,
      },
      sweepSummary: {
        totalCombos: 'totalCombos' in sweep ? sweep.totalCombos : undefined,
        topN: 'topN' in sweep ? sweep.topN : undefined,
        best: sweep.best,
      },
    };
  }

  private parseBoolean(value: boolean | string | undefined, fallback = false) {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
      if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
    }
    return fallback;
  }

  private readLocalImageFile(localImageName?: string) {
    const name = String(localImageName || '').trim();
    if (!name || name.includes('/') || name.includes('\\') || name.startsWith('.')) {
      return undefined;
    }
    const candidates = [
      join(process.cwd(), name),
      join(process.cwd(), '..', name),
      join(process.cwd(), '..', '..', name),
    ];
    const path = candidates.find((item) => existsSync(item));
    if (!path) {
      return undefined;
    }
    const lower = name.toLowerCase();
    const mimetype = lower.endsWith('.png')
      ? 'image/png'
      : lower.endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg';
    const buffer = readFileSync(path);
    return {
      buffer,
      originalname: name,
      mimetype,
      size: buffer.length,
    };
  }

  private parseFitMode(value: string | undefined): 'stretch' | 'contain_black' | 'contain_white' | 'cover' {
    if (value === 'contain_black' || value === 'contain_white' || value === 'cover' || value === 'stretch') {
      return value;
    }
    return 'stretch';
  }

  private parseResampleMode(value: string | undefined): 'nearest' | 'bilinear' | 'bicubic' | 'lanczos' {
    if (value === 'nearest' || value === 'bilinear' || value === 'bicubic' || value === 'lanczos') {
      return value;
    }
    return 'bilinear';
  }

  private parseRenderPreset(value: string | undefined) {
    const normalized = String(value || '').trim();
    const supported = new Set(['2.13', '1.54', '2.90', '4.2', '5.83', '3.7', '7.5', '2.6', '10.2']);
    return supported.has(normalized) ? normalized : '2.13';
  }

  private parseFullVariant(value: string | undefined): 'single_chunk' | 'stacked_rows' | 'stacked_rows_triple' | 'first_quartet' | 'legacy' {
    if (value === 'single_chunk' || value === 'legacy' || value === 'first_quartet' || value === 'stacked_rows' || value === 'stacked_rows_triple') {
      return value;
    }
    return 'stacked_rows';
  }

  private parseFullQuartet(value: number | string | undefined): number {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return Math.max(0, Math.min(2, Math.trunc(n)));
    }
    return 1;
  }

  private getRenderPresetDimensions(preset: string) {
    const map: Record<string, { width: number; height: number }> = {
      '1.54': { width: 200, height: 200 },
      '2.13': { width: 250, height: 122 },
      '2.6': { width: 360, height: 184 },
      '2.90': { width: 296, height: 128 },
      '3.7': { width: 416, height: 240 },
      '4.2': { width: 400, height: 300 },
      '5.83': { width: 648, height: 480 },
      '7.5': { width: 800, height: 480 },
      '10.2': { width: 960, height: 640 },
    };
    return map[preset] ?? map['2.13'];
  }

  private parseImageCanvas(value?: string): {
    protocol: '03' | '03_04' | '03_0a' | '0c';
    canvas: { width: number; height: number; rowBytes: number; outputRows: number; outputBytes: number };
  } {
    let normalized = String(value || '').trim().toLowerCase();
    if (!normalized || normalized === '0c_800x480' || normalized === 'service0c' || normalized === '800x480_0c') {
      normalized = '0c:800x480';
    }
    const explicit = normalized.match(/^(03-04|03_04|0304|03-0a|03_0a|030a|03|0c)[:_](.+)$/);
    const protocol = explicit
      ? (
        ['03-04', '03_04', '0304'].includes(explicit[1])
          ? '03_04'
          : ['03-0a', '03_0a', '030a'].includes(explicit[1])
            ? '03_0a'
            : explicit[1]
      ) as '03' | '03_04' | '03_0a' | '0c'
      : '03';
    const spec = explicit ? explicit[2] : normalized;
    const match = spec.match(/^(\d{2,4})x(\d{2,4})(?:@(\d{1,4})x(\d{1,4}))?$/);
    if (!match) {
      return {
        protocol: '0c',
        canvas: { width: 800, height: 480, rowBytes: 200, outputRows: 480, outputBytes: 96000 },
      };
    }
    const width = Number(match[1]);
    const height = Number(match[2]);
    const rowBytes = protocol === '03'
      ? match[3] ? Number(match[3]) : Math.ceil(width / 8)
      : Math.ceil(width / 4);
    const outputRows = match[4] ? Number(match[4]) : height;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || width > 1200 || height > 1200) {
      return {
        protocol: '0c',
        canvas: { width: 800, height: 480, rowBytes: 200, outputRows: 480, outputBytes: 96000 },
      };
    }
    const minRowBytes = protocol === '03' ? Math.ceil(width / 8) : Math.ceil(width / 4);
    if (!Number.isInteger(rowBytes) || !Number.isInteger(outputRows) || rowBytes < minRowBytes || outputRows < height || rowBytes > 4096 || outputRows > 1200) {
      return {
        protocol: '0c',
        canvas: { width: 800, height: 480, rowBytes: 200, outputRows: 480, outputBytes: 96000 },
      };
    }
    return { protocol, canvas: { width, height, rowBytes, outputRows, outputBytes: rowBytes * outputRows } };
  }

  private parseRenderScale(value: number | string | undefined) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return 1;
    }
    return Math.min(1, Math.max(0.2, numeric));
  }

  private normalizeFitModes(values?: Array<'stretch' | 'contain_black' | 'contain_white' | 'cover'>, fastMode = true) {
    if (!values?.length) {
      return fastMode
        ? (['stretch', 'contain_black'] as const)
        : (['stretch', 'contain_black', 'contain_white', 'cover'] as const);
    }
    return Array.from(new Set(values.map((value) => this.parseFitMode(value))));
  }

  private normalizeResampleModes(values?: Array<'nearest' | 'bilinear' | 'bicubic' | 'lanczos'>, fastMode = true) {
    if (!values?.length) {
      return fastMode
        ? (['bilinear', 'nearest', 'bicubic'] as const)
        : (['nearest', 'bilinear', 'bicubic', 'lanczos'] as const);
    }
    return Array.from(new Set(values.map((value) => this.parseResampleMode(value))));
  }

  private normalizeDitherModes(values?: Array<boolean | string>, fastMode = true) {
    if (!values?.length) {
      return fastMode ? ([true, false] as const) : ([false, true] as const);
    }
    return Array.from(new Set(values.map((value) => this.parseBoolean(value, false))));
  }

  private scoreEntropy(counts: number[]) {
    const total = counts.reduce((sum, item) => sum + item, 0);
    if (!total) return 0;
    let entropy = 0;
    for (const count of counts) {
      if (!count) continue;
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
    return entropy / 2;
  }

  private buildCandidateKey(
    fitMode: 'stretch' | 'contain_black' | 'contain_white' | 'cover',
    resample: 'nearest' | 'bilinear' | 'bicubic' | 'lanczos',
    dither: boolean,
  ) {
    return `${fitMode}|${resample}|${dither ? 1 : 0}`;
  }

  private readF2SlotHistory() {
    try {
      if (!existsSync(this.f2slotHistoryPath)) {
        return { version: 1, byImage: {} as Record<string, Record<string, F2SlotHistoryEntry>> };
      }
      const raw = JSON.parse(readFileSync(this.f2slotHistoryPath, 'utf8')) as {
        version?: number;
        byImage?: Record<string, Record<string, F2SlotHistoryEntry>>;
      };
      return {
        version: raw.version ?? 1,
        byImage: raw.byImage ?? {},
      };
    } catch {
      return { version: 1, byImage: {} as Record<string, Record<string, F2SlotHistoryEntry>> };
    }
  }

  private writeF2SlotHistory(history: { version: number; byImage: Record<string, Record<string, F2SlotHistoryEntry>> }) {
    mkdirSync(join(process.cwd(), 'data'), { recursive: true });
    writeFileSync(this.f2slotHistoryPath, JSON.stringify(history, null, 2), 'utf8');
  }

  private getHistoryBoost(
    imageSha256: string,
    fitMode: 'stretch' | 'contain_black' | 'contain_white' | 'cover',
    resample: 'nearest' | 'bilinear' | 'bicubic' | 'lanczos',
    dither: boolean,
  ) {
    const history = this.readF2SlotHistory();
    const key = this.buildCandidateKey(fitMode, resample, dither);
    const entry = history.byImage[imageSha256]?.[key];
    if (!entry) {
      return 0;
    }
    const successBoost = Math.min(0.08, (entry.successCount || 0) * 0.02);
    const lastOkBoost = entry.lastResultOk ? 0.01 : 0;
    return Number((successBoost + lastOkBoost).toFixed(6));
  }

  private upsertF2SlotHistory(input: {
    imageSha256: string;
    fitMode: 'stretch' | 'contain_black' | 'contain_white' | 'cover';
    resample: 'nearest' | 'bilinear' | 'bicubic' | 'lanczos';
    dither: boolean;
    score: number;
    resultOk: boolean;
    generatedService03Sha256?: string;
    generatedService03Bytes?: number;
  }) {
    const history = this.readF2SlotHistory();
    const key = this.buildCandidateKey(input.fitMode, input.resample, input.dither);
    history.byImage[input.imageSha256] = history.byImage[input.imageSha256] ?? {};
    const existing = history.byImage[input.imageSha256][key];
    const now = new Date().toISOString();
    history.byImage[input.imageSha256][key] = {
      imageSha256: input.imageSha256,
      candidateKey: key,
      fitMode: input.fitMode,
      resample: input.resample,
      dither: input.dither,
      usedCount: (existing?.usedCount ?? 0) + 1,
      successCount: (existing?.successCount ?? 0) + (input.resultOk ? 1 : 0),
      lastResultOk: input.resultOk,
      lastScore: input.score,
      generatedService03Sha256: input.generatedService03Sha256,
      generatedService03Bytes: input.generatedService03Bytes,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.writeF2SlotHistory(history);
  }

  private buildService03CacheKey(templateId: number, imageFieldName: string, imageSha256: string) {
    return `${templateId}:${imageFieldName}:${imageSha256}`;
  }

  private readService03Cache() {
    try {
      if (!existsSync(this.service03CachePath)) {
        return { version: 1, items: {} as Record<string, Service03CacheItem> };
      }
      const raw = JSON.parse(readFileSync(this.service03CachePath, 'utf8')) as { version?: number; items?: Record<string, Service03CacheItem> };
      return {
        version: raw.version ?? 1,
        items: raw.items ?? {},
      };
    } catch {
      return { version: 1, items: {} as Record<string, Service03CacheItem> };
    }
  }

  private upsertService03Cache(item: Service03CacheItem) {
    const cache = this.readService03Cache();
    const existing = cache.items[item.key];
    cache.items[item.key] = {
      ...item,
      createdAt: existing?.createdAt ?? item.createdAt,
      updatedAt: new Date().toISOString(),
    };
    mkdirSync(join(process.cwd(), 'data'), { recursive: true });
    writeFileSync(this.service03CachePath, JSON.stringify(cache, null, 2), 'utf8');
  }

  private pickReplaySeedCapture(apId: string, preferredCaptureId?: string) {
    return this.pickReplaySeedCaptureWithService(apId, '01-00-00-03', preferredCaptureId);
  }

  private pickReplaySeedCaptureWithService(apId: string, service: string, preferredCaptureId?: string) {
    const isServiceCapture = (capture: { apId: string; id: string; commandType?: string; text?: string }) => {
      if (capture.apId !== apId || capture.commandType !== 'READ_WRITE_SVC' || !capture.text) {
        return false;
      }
      return Boolean(this.extractServiceBytes(capture.text, service));
    };

    if (preferredCaptureId) {
      const preferred = this.db.officialDownlinkCaptures.find((capture) => capture.id === preferredCaptureId);
      if (preferred && isServiceCapture(preferred)) {
        return preferred;
      }
    }

    return this.db.officialDownlinkCaptures
      .slice()
      .reverse()
      .find((capture) => isServiceCapture(capture));
  }

  private packImageTo2bppBytes(imageBuffer: Buffer) {
    const dir = mkdtempSync(join(tmpdir(), 'esl-2bpp-'));
    const input = join(dir, 'input.png');
    const output = join(dir, 'packed.bin');
    writeFileSync(input, imageBuffer);
    try {
      execFileSync('python3', [
        '-c',
        [
          'from PIL import Image',
          'import sys',
          'inp, out = sys.argv[1], sys.argv[2]',
          'img = Image.open(inp).convert("RGB").resize((256,128))',
          'palette = [((0,0,0),0), ((255,255,255),2), ((255,0,0),3), ((255,255,0),1)]',
          'pix = img.load()',
          'vals = [0] * (256*128)',
          'for y in range(128):',
          '  for x in range(256):',
          '    r,g,b = pix[x,y]',
          '    best = min(palette, key=lambda p: (r-p[0][0])**2 + (g-p[0][1])**2 + (b-p[0][2])**2)',
          '    vals[y*256+x] = best[1]',
          'outb = bytearray(8192)',
          'for i in range(0, len(vals), 4):',
          '  outb[i//4] = ((vals[i]&3)<<6) | ((vals[i+1]&3)<<4) | ((vals[i+2]&3)<<2) | (vals[i+3]&3)',
          'open(out, \"wb\").write(outb)',
        ].join('\n'),
        input,
        output,
      ], { stdio: 'pipe' });
      return readFileSync(output);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private parseService03Chunks(service03: Buffer) {
    const magic = Buffer.from([0xa5, 0xa6, 0x0c, 0x02]);
    if (service03.length < 8 || !service03.subarray(0, 4).equals(magic)) {
      throw new Error('invalid_service03_magic');
    }
    const chunks: ServiceChunk[] = [];
    let offset = 4;
    while (offset + 3 <= service03.length) {
      const cid = service03[offset];
      const clen = service03.readUInt16LE(offset + 1);
      offset += 3;
      if (offset + clen > service03.length) {
        throw new Error('invalid_service03_chunk_length');
      }
      const comp = service03.subarray(offset, offset + clen);
      offset += clen;
      const dec = zlib.inflateRawSync(comp);
      chunks.push({ cid, comp: Buffer.from(comp), dec: Buffer.from(dec) });
    }
    if (offset !== service03.length || !chunks.length) {
      throw new Error('invalid_service03_chunk_alignment');
    }
    return chunks;
  }

  private requireBaselineService03(baselineBytes?: Buffer) {
    if (!baselineBytes?.length) {
      throw new Error('baseline_service03_required_for_mode');
    }
    return baselineBytes;
  }

  private rebuildService03FromImage(chunks: ServiceChunk[], imagePacked: Buffer, mode: 'non55' | 'full') {
    const out: ServiceChunk[] = chunks.map((chunk) => ({
      cid: chunk.cid,
      comp: chunk.comp,
      // 全屏实验模式先清空每个 chunk，避免 baseline 残留导致“幽灵图”叠加
      dec: Buffer.alloc(chunk.dec.length, 0x55),
    }));
    for (const chunk of out) {
      const target = Buffer.from(chunk.dec);
      const src = imagePacked.subarray(0, Math.min(target.length, imagePacked.length));
      for (let i = 0; i < src.length; i += 1) {
        if (mode === 'full' || target[i] !== 0x55) {
          target[i] = src[i];
        }
      }
      chunk.dec = target;
      chunk.comp = zlib.deflateRawSync(target, { level: 9 });
    }
    const parts: Buffer[] = [Buffer.from([0xa5, 0xa6, 0x0c, 0x02])];
    for (const chunk of out) {
      const header = Buffer.allocUnsafe(3);
      header[0] = chunk.cid & 0xff;
      header.writeUInt16LE(chunk.comp.length & 0xffff, 1);
      parts.push(header, chunk.comp);
    }
    return Buffer.concat(parts);
  }

  private rebuildService03FullExperimental(
    chunks: ServiceChunk[],
    imageBuffer: Buffer,
    options: {
      fitMode: 'stretch' | 'contain_black' | 'contain_white' | 'cover';
      dither: boolean;
      resample: 'nearest' | 'bilinear' | 'bicubic' | 'lanczos';
      renderPreset: string;
      renderScale: number;
      variant: 'single_chunk' | 'stacked_rows' | 'stacked_rows_triple' | 'first_quartet' | 'legacy';
      fullQuartet: number;
    },
  ) {
    if (options.variant === 'legacy') {
      return this.rebuildService03FromImage(chunks, this.packImageTo2bppBytes(imageBuffer), 'full');
    }

    const rowBytesSingle = this.packImageToFullRows200Bytes(imageBuffer, {
      fitMode: options.fitMode,
      dither: options.dither,
      resample: options.resample,
      renderPreset: options.renderPreset,
      renderScale: options.renderScale,
    });
    const useTripleRows = options.variant === 'stacked_rows_triple';
    const rowBytesTriple = useTripleRows
      ? this.packImageToFullRows200Bytes(imageBuffer, {
        fitMode: options.fitMode,
        dither: options.dither,
        resample: options.resample,
        renderPreset: options.renderPreset,
        renderScale: options.renderScale,
        targetHeight: 384,
      })
      : undefined;

    const out: ServiceChunk[] = chunks.map((chunk) => ({
      cid: chunk.cid,
      comp: chunk.comp,
      // 保留 baseline 结构，降低 WRITE_SVC errno=-9 风险
      dec: Buffer.from(chunk.dec),
    }));

    if (options.variant === 'single_chunk') {
      const packed = this.packImageTo2bppBytes(imageBuffer);
      if (out.length > 0) {
        const first = out[0].dec;
        packed.copy(first, 0, 0, Math.min(first.length, packed.length));
      }
      for (const chunk of out) {
        chunk.comp = zlib.deflateRawSync(chunk.dec, { level: 9 });
      }
      const parts: Buffer[] = [Buffer.from([0xa5, 0xa6, 0x0c, 0x02])];
      for (const chunk of out) {
        const header = Buffer.allocUnsafe(3);
        header[0] = chunk.cid & 0xff;
        header.writeUInt16LE(chunk.comp.length & 0xffff, 1);
        parts.push(header, chunk.comp);
      }
      return Buffer.concat(parts);
    }

    const writeRowsToChunk = (chunk: Buffer, group: number, rowBytes: Buffer, sourceRowBase = 0) => {
      const baseOffset = [200, 8, 16, 24][group] ?? 200;
      const ranges: Array<[number, number]> = [
        [0, 40],
        [40, 81],
        [81, 122],
        [122, 128],
      ];
      const [startRow, endRow] = ranges[group] ?? [0, 0];
      for (let y = startRow; y < endRow; y += 1) {
        const rowInGroup = y - startRow;
        const dstOffset = baseOffset + rowInGroup * 200;
        const srcOffset = (sourceRowBase + y) * 200;
        if (dstOffset + 200 <= chunk.length) {
          rowBytes.copy(chunk, dstOffset, srcOffset, srcOffset + 200);
        }
      }
    };

    if (useTripleRows && rowBytesTriple) {
      // 全高模式：分别写入 3 个 quartet，上/中/下三段各 128 行。
      // 保留 baseline 封套，仅覆盖显示区域，避免设备执行 errno=-9。
      for (let q = 0; q < 3; q += 1) {
        const qStart = q * 4;
        const qEnd = Math.min(qStart + 4, out.length);
        for (let index = qStart; index < qEnd; index += 1) {
          if (out[index].dec.length < 5888) {
            continue;
          }
          const group = (index - qStart) % 4;
          writeRowsToChunk(out[index].dec, group, rowBytesTriple, q * 128);
        }
      }
    } else {
      // 诊断模式：只写一个 quartet，避免重复渲染；quartet 取值 0/1/2 分别对应 chunk 1-4 / 5-8 / 9-12
      const qStart = Math.max(0, Math.min(2, options.fullQuartet)) * 4;
      const qEnd = Math.min(qStart + 4, out.length);
      for (let index = qStart; index < qEnd; index += 1) {
        if (out[index].dec.length < 5888) {
          continue;
        }
        const group = (index - qStart) % 4;
        writeRowsToChunk(out[index].dec, group, rowBytesSingle, 0);
      }
    }

    for (const chunk of out) {
      chunk.comp = zlib.deflateRawSync(chunk.dec, { level: 9 });
    }

    const parts: Buffer[] = [Buffer.from([0xa5, 0xa6, 0x0c, 0x02])];
    for (const chunk of out) {
      const header = Buffer.allocUnsafe(3);
      header[0] = chunk.cid & 0xff;
      header.writeUInt16LE(chunk.comp.length & 0xffff, 1);
      parts.push(header, chunk.comp);
    }
    return Buffer.concat(parts);
  }

  private packImageTo4515F2RowBytes(
    imageBuffer: Buffer,
    options?: {
      fitMode?: 'stretch' | 'contain_black' | 'contain_white' | 'cover';
      dither?: boolean;
      resample?: 'nearest' | 'bilinear' | 'bicubic' | 'lanczos';
      renderPreset?: string;
      renderScale?: number;
    },
  ) {
    const dir = mkdtempSync(join(tmpdir(), 'esl-f2slot-'));
    const input = join(dir, 'input.png');
    const output = join(dir, 'rows.bin');
    writeFileSync(input, imageBuffer);
    const preset = this.parseRenderPreset(options?.renderPreset);
    const dims = this.getRenderPresetDimensions(preset);
    try {
      execFileSync('python3', [
        '-c',
        [
          'from PIL import Image',
          'from PIL import ImageOps',
          'import sys',
          'inp, out, fit_mode, dither_mode, resample_name, render_scale, preset_w, preset_h = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], float(sys.argv[6]), int(sys.argv[7]), int(sys.argv[8])',
          'img = Image.open(inp).convert("RGB")',
          'resample_map = {\"nearest\": Image.Resampling.NEAREST, \"bilinear\": Image.Resampling.BILINEAR, \"bicubic\": Image.Resampling.BICUBIC, \"lanczos\": Image.Resampling.LANCZOS}',
          'resample = resample_map.get(resample_name, Image.Resampling.NEAREST)',
          'target_size = (preset_w, preset_h)',
          'if fit_mode == \"contain_black\":',
          '  img = ImageOps.pad(img, target_size, method=resample, color=(0,0,0), centering=(0.5,0.5))',
          'elif fit_mode == \"contain_white\":',
          '  img = ImageOps.pad(img, target_size, method=resample, color=(255,255,255), centering=(0.5,0.5))',
          'elif fit_mode == \"cover\":',
          '  img = ImageOps.fit(img, target_size, method=resample, centering=(0.5,0.5))',
          'else:',
          '  img = img.resize(target_size, resample)',
          'if dither_mode == \"1\":',
          '  pal = Image.new(\"P\", (1,1))',
          '  pal.putpalette([0,0,0,255,255,255,255,255,0,255,0,0] + [0,0,0]*252)',
          '  img = img.quantize(palette=pal, dither=Image.Dither.FLOYDSTEINBERG).convert(\"RGB\")',
          'if 0 < render_scale < 0.9999:',
          '  sw = max(1, int(round(preset_w * render_scale)))',
          '  sh = max(1, int(round(preset_h * render_scale)))',
          '  scaled = img.resize((sw, sh), resample)',
          '  bg = (0,0,0) if fit_mode == \"contain_black\" else (255,255,255)',
          '  canvas = Image.new(\"RGB\", (preset_w,preset_h), bg)',
          '  canvas.paste(scaled, ((preset_w - sw)//2, (preset_h - sh)//2))',
          '  img = canvas',
          'img = ImageOps.fit(img, (256,128), method=resample, centering=(0.5,0.5))',
          'palette = [((0,0,0),0), ((255,255,255),1), ((255,0,0),3), ((255,255,0),2)]',
          'pix = img.load()',
          'rows = bytearray()',
          'for y in range(128):',
          '  codes = [1,1]',
          '  for x in range(256):',
          '    r,g,b = pix[x,y]',
          '    best = min(palette, key=lambda p: (r-p[0][0])**2 + (g-p[0][1])**2 + (b-p[0][2])**2)',
          '    codes.append(best[1])',
          '  codes.extend([1,1])',
          '  for i in range(0,260,4):',
          '    rows.append(((codes[i]&3)<<6) | ((codes[i+1]&3)<<4) | ((codes[i+2]&3)<<2) | (codes[i+3]&3))',
          'open(out, \"wb\").write(rows)',
        ].join('\n'),
        input,
        output,
        options?.fitMode || 'stretch',
        options?.dither ? '1' : '0',
        options?.resample || 'nearest',
        String(options?.renderScale ?? 1),
        String(dims.width),
        String(dims.height),
      ], { stdio: 'pipe' });
      return readFileSync(output);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private packImageToFullRows200Bytes(
    imageBuffer: Buffer,
    options?: {
      fitMode?: 'stretch' | 'contain_black' | 'contain_white' | 'cover';
      dither?: boolean;
      resample?: 'nearest' | 'bilinear' | 'bicubic' | 'lanczos';
      renderPreset?: string;
      renderScale?: number;
      targetHeight?: number;
    },
  ) {
    const dir = mkdtempSync(join(tmpdir(), 'esl-fullrows-'));
    const input = join(dir, 'input.png');
    const output = join(dir, 'rows200.bin');
    writeFileSync(input, imageBuffer);
    const preset = this.parseRenderPreset(options?.renderPreset);
    const dims = this.getRenderPresetDimensions(preset);
    try {
      execFileSync('python3', [
        '-c',
        [
          'from PIL import Image',
          'from PIL import ImageOps',
          'import sys',
          'inp, out, fit_mode, dither_mode, resample_name, render_scale, preset_w, preset_h = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], float(sys.argv[6]), int(sys.argv[7]), int(sys.argv[8])',
          'img = Image.open(inp).convert("RGB")',
          'resample_map = {"nearest": Image.Resampling.NEAREST, "bilinear": Image.Resampling.BILINEAR, "bicubic": Image.Resampling.BICUBIC, "lanczos": Image.Resampling.LANCZOS}',
          'resample = resample_map.get(resample_name, Image.Resampling.BILINEAR)',
          'target_size = (preset_w, preset_h)',
          'if fit_mode == "contain_black":',
          '  img = ImageOps.pad(img, target_size, method=resample, color=(0,0,0), centering=(0.5,0.5))',
          'elif fit_mode == "contain_white":',
          '  img = ImageOps.pad(img, target_size, method=resample, color=(255,255,255), centering=(0.5,0.5))',
          'elif fit_mode == "cover":',
          '  img = ImageOps.fit(img, target_size, method=resample, centering=(0.5,0.5))',
          'else:',
          '  img = img.resize(target_size, resample)',
          'if 0 < render_scale < 0.9999:',
          '  sw = max(1, int(round(preset_w * render_scale)))',
          '  sh = max(1, int(round(preset_h * render_scale)))',
          '  scaled = img.resize((sw, sh), resample)',
          '  bg = (0,0,0) if fit_mode == "contain_black" else (255,255,255)',
          '  canvas = Image.new("RGB", (preset_w,preset_h), bg)',
          '  canvas.paste(scaled, ((preset_w - sw)//2, (preset_h - sh)//2))',
          '  img = canvas',
          'target_h = int(sys.argv[9])',
          'img = ImageOps.fit(img, (800,target_h), method=resample, centering=(0.5,0.5))',
          'if dither_mode == "1":',
          '  pal = Image.new("P", (1,1))',
          '  pal.putpalette([0,0,0,255,255,255,255,255,0,255,0,0] + [0,0,0]*252)',
          '  img = img.quantize(palette=pal, dither=Image.Dither.FLOYDSTEINBERG).convert("RGB")',
          'palette = [((0,0,0),0), ((255,255,255),2), ((255,255,0),1), ((255,0,0),3)]',
          'pix = img.load()',
          'rows = bytearray()',
          'for y in range(target_h):',
          '  vals = []',
          '  for x in range(800):',
          '    r,g,b = pix[x,y]',
          '    best = min(palette, key=lambda p: (r-p[0][0])**2 + (g-p[0][1])**2 + (b-p[0][2])**2)',
          '    vals.append(best[1])',
          '  for i in range(0,800,4):',
          '    rows.append(((vals[i]&3)<<6) | ((vals[i+1]&3)<<4) | ((vals[i+2]&3)<<2) | (vals[i+3]&3))',
          'open(out, "wb").write(rows)',
        ].join('\n'),
        input,
        output,
        options?.fitMode || 'stretch',
        options?.dither ? '1' : '0',
        options?.resample || 'bilinear',
        String(options?.renderScale ?? 1),
        String(dims.width),
        String(dims.height),
        String(options?.targetHeight ?? 128),
      ], { stdio: 'pipe' });
      const rows = readFileSync(output);
      const expectedRows = 200 * (options?.targetHeight ?? 128);
      if (rows.length !== expectedRows) {
        throw new Error('invalid_full_rows_size');
      }
      return rows;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private packImageToService0cRowsBytes(
    imageBuffer: Buffer,
    options?: {
      fitMode?: 'stretch' | 'contain_black' | 'contain_white' | 'cover';
      dither?: boolean;
      resample?: 'nearest' | 'bilinear' | 'bicubic' | 'lanczos';
      renderPreset?: string;
      renderScale?: number;
      canvas?: { width: number; height: number; rowBytes: number; outputRows: number; outputBytes: number };
    },
  ) {
    const dir = mkdtempSync(join(tmpdir(), 'esl-service0c-'));
    const input = join(dir, 'input.png');
    const output = join(dir, 'rows.bin');
    writeFileSync(input, imageBuffer);
    const preset = this.parseRenderPreset(options?.renderPreset);
    const dims = this.getRenderPresetDimensions(preset);
    const canvas = options?.canvas ?? { width: 800, height: 480, rowBytes: 200, outputRows: 480, outputBytes: 96000 };
    try {
      execFileSync('python3', [
        '-c',
        [
          'from PIL import Image',
          'from PIL import ImageOps',
          'import sys',
          'inp, out, fit_mode, dither_mode, resample_name, render_scale, preset_w, preset_h, canvas_w, canvas_h, row_bytes, output_rows = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], float(sys.argv[6]), int(sys.argv[7]), int(sys.argv[8]), int(sys.argv[9]), int(sys.argv[10]), int(sys.argv[11]), int(sys.argv[12])',
          'img = Image.open(inp).convert("RGB")',
          'resample_map = {"nearest": Image.Resampling.NEAREST, "bilinear": Image.Resampling.BILINEAR, "bicubic": Image.Resampling.BICUBIC, "lanczos": Image.Resampling.LANCZOS}',
          'resample = resample_map.get(resample_name, Image.Resampling.BILINEAR)',
          'target_size = (preset_w, preset_h)',
          'if fit_mode == "contain_black":',
          '  img = ImageOps.pad(img, target_size, method=resample, color=(0,0,0), centering=(0.5,0.5))',
          'elif fit_mode == "contain_white":',
          '  img = ImageOps.pad(img, target_size, method=resample, color=(255,255,255), centering=(0.5,0.5))',
          'elif fit_mode == "cover":',
          '  img = ImageOps.fit(img, target_size, method=resample, centering=(0.5,0.5))',
          'else:',
          '  img = img.resize(target_size, resample)',
          'if 0 < render_scale < 0.9999:',
          '  sw = max(1, int(round(preset_w * render_scale)))',
          '  sh = max(1, int(round(preset_h * render_scale)))',
          '  scaled = img.resize((sw, sh), resample)',
          '  bg = (0,0,0) if fit_mode == "contain_black" else (255,255,255)',
          '  slot = Image.new("RGB", target_size, bg)',
          '  slot.paste(scaled, ((preset_w - sw)//2, (preset_h - sh)//2))',
          '  img = slot',
          'canvas = Image.new("RGB", (canvas_w,canvas_h), (255,255,255))',
          'canvas.paste(img, ((canvas_w - preset_w)//2, (canvas_h - preset_h)//2))',
          'img = canvas',
          'if dither_mode == "1":',
          '  pal = Image.new("P", (1,1))',
          '  pal.putpalette([0,0,0,255,255,255,255,255,0,255,0,0] + [0,0,0]*252)',
          '  img = img.quantize(palette=pal, dither=Image.Dither.FLOYDSTEINBERG).convert("RGB")',
          '# service0c: 2bpp。0x55 是白底，因此 white=1。',
          'palette = [((0,0,0),0), ((255,255,255),1), ((255,255,0),2), ((255,0,0),3)]',
          'pix = img.load()',
          'rows = bytearray()',
          'for y in range(output_rows):',
          '  vals = [1] * (row_bytes * 4)',
          '  if y < canvas_h:',
          '    for x in range(min(canvas_w, row_bytes * 4)):',
          '      r,g,b = pix[x,y]',
          '      best = min(palette, key=lambda p: (r-p[0][0])**2 + (g-p[0][1])**2 + (b-p[0][2])**2)',
          '      vals[x] = best[1]',
          '  for i in range(0,row_bytes * 4,4):',
          '    rows.append(((vals[i]&3)<<6) | ((vals[i+1]&3)<<4) | ((vals[i+2]&3)<<2) | (vals[i+3]&3))',
          'open(out, "wb").write(rows)',
        ].join('\n'),
        input,
        output,
        options?.fitMode || 'stretch',
        options?.dither ? '1' : '0',
        options?.resample || 'bilinear',
        String(options?.renderScale ?? 1),
        String(dims.width),
        String(dims.height),
        String(canvas.width),
        String(canvas.height),
        String(canvas.rowBytes),
        String(canvas.outputRows),
      ], { stdio: 'pipe' });
      const rows = readFileSync(output);
      if (rows.length !== canvas.outputBytes) {
        throw new Error('invalid_service0c_rows_size');
      }
      return rows;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private buildService0cFromImage(
    imageBuffer: Buffer,
    options?: {
      fitMode?: 'stretch' | 'contain_black' | 'contain_white' | 'cover';
      dither?: boolean;
      resample?: 'nearest' | 'bilinear' | 'bicubic' | 'lanczos';
      renderPreset?: string;
      renderScale?: number;
      canvas?: { width: number; height: number; rowBytes: number; outputRows: number; outputBytes: number };
    },
  ) {
    const rows = this.packImageToService0cRowsBytes(imageBuffer, options);
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < rows.length; offset += 8192) {
      chunks.push(rows.subarray(offset, Math.min(offset + 8192, rows.length)));
    }
    const parts: Buffer[] = [Buffer.from([0xa5, 0xa6, 0x0c, 0x02])];
    for (let index = 0; index < chunks.length; index += 1) {
      const comp = zlib.deflateRawSync(chunks[index], { level: 9 });
      const header = Buffer.allocUnsafe(3);
      header[0] = (index + 1) & 0xff;
      header.writeUInt16LE(comp.length & 0xffff, 1);
      parts.push(header, comp);
    }
    return Buffer.concat(parts);
  }

  private buildService03BppFromImage(
    imageBuffer: Buffer,
    options?: {
      fitMode?: 'stretch' | 'contain_black' | 'contain_white' | 'cover';
      dither?: boolean;
      resample?: 'nearest' | 'bilinear' | 'bicubic' | 'lanczos';
      renderPreset?: string;
      renderScale?: number;
      canvas?: { width: number; height: number; rowBytes: number; outputRows: number; outputBytes: number };
      containerType?: 0x04 | 0x0a;
    },
  ) {
    const rows = this.packImageToService0cRowsBytes(imageBuffer, options);
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < rows.length; offset += 8192) {
      chunks.push(rows.subarray(offset, Math.min(offset + 8192, rows.length)));
    }
    const parts: Buffer[] = [Buffer.from([0xa5, 0xa6, options?.containerType ?? 0x04, 0x02])];
    for (let index = 0; index < chunks.length; index += 1) {
      const comp = zlib.deflateRawSync(chunks[index], { level: 9 });
      const header = Buffer.allocUnsafe(3);
      header[0] = (index + 1) & 0xff;
      header.writeUInt16LE(comp.length & 0xffff, 1);
      parts.push(header, comp);
    }
    return Buffer.concat(parts);
  }

  private packImageToSmallService03RowsBytes(
    imageBuffer: Buffer,
    options?: {
      fitMode?: 'stretch' | 'contain_black' | 'contain_white' | 'cover';
      dither?: boolean;
      resample?: 'nearest' | 'bilinear' | 'bicubic' | 'lanczos';
      renderPreset?: string;
      renderScale?: number;
      canvas?: { width: number; height: number; rowBytes: number; outputRows: number; outputBytes: number };
    },
  ) {
    const dims = options?.canvas ?? { width: 200, height: 160, rowBytes: 25, outputRows: 160, outputBytes: 4000 };
    const dir = mkdtempSync(join(tmpdir(), 'esl-service03-small-'));
    const input = join(dir, 'input.png');
    const output = join(dir, 'rows.bin');
    writeFileSync(input, imageBuffer);
    try {
      execFileSync('python3', [
        '-c',
        [
          'from PIL import Image',
          'from PIL import ImageOps',
          'import sys',
          'inp, out, fit_mode, dither_mode, resample_name, render_scale, target_w, target_h, row_bytes, output_rows = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], float(sys.argv[6]), int(sys.argv[7]), int(sys.argv[8]), int(sys.argv[9]), int(sys.argv[10])',
          'img = Image.open(inp).convert("RGB")',
          'resample_map = {"nearest": Image.Resampling.NEAREST, "bilinear": Image.Resampling.BILINEAR, "bicubic": Image.Resampling.BICUBIC, "lanczos": Image.Resampling.LANCZOS}',
          'resample = resample_map.get(resample_name, Image.Resampling.BILINEAR)',
          'target_size = (target_w, target_h)',
          'if fit_mode == "contain_black":',
          '  img = ImageOps.pad(img, target_size, method=resample, color=(0,0,0), centering=(0.5,0.5))',
          'elif fit_mode == "contain_white":',
          '  img = ImageOps.pad(img, target_size, method=resample, color=(255,255,255), centering=(0.5,0.5))',
          'elif fit_mode == "cover":',
          '  img = ImageOps.fit(img, target_size, method=resample, centering=(0.5,0.5))',
          'else:',
          '  img = img.resize(target_size, resample)',
          'if 0 < render_scale < 0.9999:',
          '  sw = max(1, int(round(target_w * render_scale)))',
          '  sh = max(1, int(round(target_h * render_scale)))',
          '  scaled = img.resize((sw, sh), resample)',
          '  bg = (0,0,0) if fit_mode == "contain_black" else (255,255,255)',
          '  canvas = Image.new("RGB", target_size, bg)',
          '  canvas.paste(scaled, ((target_w - sw)//2, (target_h - sh)//2))',
          '  img = canvas',
          'if dither_mode == "1":',
          '  pal = Image.new("P", (1,1))',
          '  pal.putpalette([0,0,0,255,255,255] + [0,0,0]*254)',
          '  img = img.quantize(palette=pal, dither=Image.Dither.FLOYDSTEINBERG).convert("RGB")',
          'pix = img.load()',
          'rows = bytearray([0xff]) * (row_bytes * output_rows)',
          'for y in range(target_h):',
          '  for x in range(target_w):',
          '    r,g,b = pix[x,y]',
          '    gray = r * 0.299 + g * 0.587 + b * 0.114',
          '    if gray < 180:',
          '      byte_index = y * row_bytes + (x // 8)',
          '      if byte_index < len(rows):',
          '        rows[byte_index] &= ~(1 << (7 - (x % 8)))',
          'open(out, "wb").write(rows)',
        ].join('\n'),
        input,
        output,
        options?.fitMode || 'stretch',
        options?.dither ? '1' : '0',
        options?.resample || 'bilinear',
        String(options?.renderScale ?? 1),
        String(dims.width),
        String(dims.height),
        String(dims.rowBytes),
        String(dims.outputRows),
      ], { stdio: 'pipe' });
      const rows = readFileSync(output);
      if (rows.length !== dims.outputBytes) {
        throw new Error('invalid_small_service03_rows_size');
      }
      return rows;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private buildSmallService03FromImage(
    imageBuffer: Buffer,
    options?: {
      fitMode?: 'stretch' | 'contain_black' | 'contain_white' | 'cover';
      dither?: boolean;
      resample?: 'nearest' | 'bilinear' | 'bicubic' | 'lanczos';
      renderPreset?: string;
      renderScale?: number;
      canvas?: { width: number; height: number; rowBytes: number; outputRows: number; outputBytes: number };
    },
  ) {
    const rows = this.packImageToSmallService03RowsBytes(imageBuffer, options);
    const comp = zlib.deflateRawSync(rows, { level: 9 });
    const header = Buffer.allocUnsafe(3);
    header[0] = 1;
    header.writeUInt16LE(comp.length & 0xffff, 1);
    return Buffer.concat([Buffer.from([0xa5, 0xa6, 0x01, 0x02]), header, comp]);
  }

  private build4515F2SlotBundle(
    imageBuffer: Buffer,
    options?: {
      fitMode?: 'stretch' | 'contain_black' | 'contain_white' | 'cover';
      dither?: boolean;
      resample?: 'nearest' | 'bilinear' | 'bicubic' | 'lanczos';
      renderPreset?: string;
      renderScale?: number;
    },
  ) {
    const rowBytes = this.packImageTo4515F2RowBytes(imageBuffer, options);
    if (rowBytes.length !== 65 * 128) {
      throw new Error('invalid_f2slot_rows_size');
    }
    const chunks: Buffer[] = [];
    for (let i = 0; i < 11; i += 1) {
      chunks.push(Buffer.alloc(8192, 0x55));
    }
    chunks.push(Buffer.alloc(5888, 0x55));

    const putRow = (chunkIndex: number, rowIndexInChunk: number, baseOffset: number, sourceRow: number) => {
      const dst = chunks[chunkIndex];
      const offset = baseOffset + rowIndexInChunk * 200;
      const srcStart = sourceRow * 65;
      rowBytes.copy(dst, offset, srcStart, srcStart + 65);
    };

    for (let y = 0; y < 40; y += 1) {
      putRow(0, y, 200, y);
    }
    for (let y = 40; y < 81; y += 1) {
      putRow(1, y - 40, 8, y);
    }
    for (let y = 81; y < 122; y += 1) {
      putRow(2, y - 81, 16, y);
    }
    for (let y = 122; y < 128; y += 1) {
      putRow(3, y - 122, 24, y);
    }

    const parts: Buffer[] = [Buffer.from([0xa5, 0xa6, 0x0c, 0x02])];
    for (let index = 0; index < chunks.length; index += 1) {
      const cid = index + 1;
      const comp = zlib.deflateRawSync(chunks[index], { level: 9 });
      const header = Buffer.allocUnsafe(3);
      header[0] = cid & 0xff;
      header.writeUInt16LE(comp.length & 0xffff, 1);
      parts.push(header, comp);
    }
    return {
      service03: Buffer.concat(parts),
      rowBytes,
      stats: this.summarizeF2SlotRowBytes(rowBytes),
    };
  }

  private build4515F2SlotService03(
    imageBuffer: Buffer,
    options?: {
      fitMode?: 'stretch' | 'contain_black' | 'contain_white' | 'cover';
      dither?: boolean;
      resample?: 'nearest' | 'bilinear' | 'bicubic' | 'lanczos';
      renderPreset?: string;
      renderScale?: number;
    },
  ) {
    return this.build4515F2SlotBundle(imageBuffer, options).service03;
  }

  private summarizeF2SlotRowBytes(rowBytes: Buffer) {
    if (rowBytes.length !== 65 * 128) {
      return {
        totalPixels: 0,
        code0: 0,
        code1: 0,
        code2: 0,
        code3: 0,
        code0Ratio: 0,
        code1Ratio: 0,
        code2Ratio: 0,
        code3Ratio: 0,
      };
    }
    const counts = [0, 0, 0, 0];
    for (let row = 0; row < 128; row += 1) {
      const start = row * 65;
      const line = rowBytes.subarray(start, start + 65);
      let pixelIndex = 0;
      for (const byte of line) {
        const c0 = (byte >> 6) & 0x03;
        const c1 = (byte >> 4) & 0x03;
        const c2 = (byte >> 2) & 0x03;
        const c3 = byte & 0x03;
        const codes = [c0, c1, c2, c3];
        for (const code of codes) {
          // 去掉每行左右各 2px 边界（总宽 260 -> 可视 256）
          if (pixelIndex >= 2 && pixelIndex < 258) {
            counts[code] += 1;
          }
          pixelIndex += 1;
        }
      }
    }
    const totalPixels = counts.reduce((sum, item) => sum + item, 0);
    return {
      totalPixels,
      code0: counts[0],
      code1: counts[1],
      code2: counts[2],
      code3: counts[3],
      code0Ratio: totalPixels ? counts[0] / totalPixels : 0,
      code1Ratio: totalPixels ? counts[1] / totalPixels : 0,
      code2Ratio: totalPixels ? counts[2] / totalPixels : 0,
      code3Ratio: totalPixels ? counts[3] / totalPixels : 0,
    };
  }

  private buildReadWriteSvcPayload(eslCode: string, service03B64: string) {
    return this.buildReadWriteSvcPayloadForService(eslCode, '01-00-00-03', service03B64, { bigsize: false });
  }

  private buildReadWriteSvcPayloadForService(
    eslCode: string,
    service: '01-00-00-03' | '01-00-00-0c',
    b64dat: string,
    flags?: { bigsize?: boolean; supersize?: boolean },
  ) {
    return {
      type: 'READ_WRITE_SVC',
      opas: [
        {
          addr: String(eslCode),
          cmds: [
            { id: 0, type: 'CONN_DEV' },
            {
              id: 16,
              type: 'WRITE_SVC',
              ...(flags?.supersize ? { supersize: true } : { bigsize: flags?.bigsize ?? false }),
              mtu: 10000,
              service,
              b64dat,
            },
          ],
        },
      ],
    };
  }

  private convertToRybwPng(file: { buffer: Buffer; originalname?: string; mimetype?: string; size?: number }) {
    const dir = mkdtempSync(join(tmpdir(), 'esl-4c-'));
    const input = join(dir, 'input.bin');
    const output = join(dir, 'output.png');
    writeFileSync(input, file.buffer);
    try {
      // 将图片量化到红黄黑白四色，避免模板端再做不可控的颜色映射。
      execFileSync('python3', [
        '-c',
        [
          'from PIL import Image',
          'import sys',
          'inp, out = sys.argv[1], sys.argv[2]',
          'img = Image.open(inp).convert("RGB")',
          'palette = [(0,0,0), (255,255,255), (255,0,0), (255,255,0)]',
          'pix = img.load()',
          'w, h = img.size',
          'for y in range(h):',
          '  for x in range(w):',
          '    r,g,b = pix[x,y]',
          '    best = min(palette, key=lambda p: (r-p[0])**2 + (g-p[1])**2 + (b-p[2])**2)',
          '    pix[x,y] = best',
          'img.save(out, format="PNG")',
        ].join('\n'),
        input,
        output,
      ], { stdio: 'pipe' });
      const buffer = readFileSync(output);
      return {
        buffer,
        originalname: (file.originalname || 'image').replace(/\.[^.]+$/, '') + '.png',
        mimetype: 'image/png',
        size: buffer.length,
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private async uploadPublicImage(file: { buffer: Buffer; originalname?: string; mimetype?: string }) {
    const safeName = (file.originalname || 'image.jpg').replace(/[^\w.\-]/g, '_');
    const contentType = file.mimetype || 'application/octet-stream';
    const blob = new Blob([new Uint8Array(file.buffer)], { type: contentType });

    // 首选 tmpfiles（当前环境验证可用）
    try {
      const form = new FormData();
      form.append('file', blob, safeName);
      const resp = await fetch('https://tmpfiles.org/api/v1/upload', {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(45_000),
      });
      const text = await resp.text();
      const parsed = this.parseBody(text) as { status?: string; data?: { url?: string } };
      const pageUrl = parsed?.data?.url;
      if (resp.ok && parsed?.status === 'success' && pageUrl) {
        let dlUrl = pageUrl.replace('http://', 'https://');
        if (!/tmpfiles\.org\/dl\//i.test(dlUrl)) {
          dlUrl = dlUrl.replace('https://tmpfiles.org/', 'https://tmpfiles.org/dl/');
        }
        return {
          ok: true,
          provider: 'tmpfiles',
          url: dlUrl,
        };
      }
      return {
        ok: false,
        error: `tmpfiles 上传失败: ${text.slice(0, 180)}`,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async waitForReadWriteCapture(
    apId: string,
    beforeIds: Set<string>,
    timeoutMs: number,
    labelId?: string,
    sampleStartedAtMs = Date.now(),
  ) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const capture = this.findMatchingCapture(apId, beforeIds, labelId, sampleStartedAtMs);
      if (capture) {
        return capture;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Some valid upstream downlinks arrive slightly after the first watcher window.
    const graceStarted = Date.now();
    while (Date.now() - graceStarted < 15_000) {
      const capture = this.findMatchingCapture(apId, beforeIds, labelId, sampleStartedAtMs);
      if (capture) {
        return capture;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return this.findMatchingCapture(apId, beforeIds, labelId, sampleStartedAtMs);
  }

  private findMatchingCapture(
    apId: string,
    beforeIds: Set<string>,
    labelId?: string,
    sampleStartedAtMs = 0,
  ) {
    return this.db.officialDownlinkCaptures
      .filter((item) => item.apId === apId && item.commandType === 'READ_WRITE_SVC' && item.text)
      .filter((item) => !beforeIds.has(item.id))
      .filter((item) => !labelId || item.labelId === labelId)
      .filter((item) => {
        const createdAtMs = Date.parse(item.createdAt);
        return Number.isFinite(createdAtMs) ? createdAtMs >= sampleStartedAtMs - 2_000 : true;
      })
      .slice()
      .reverse()
      .find(Boolean);
  }

  private summarizeCapture(capture: {
    id: string;
    createdAt: string;
    bytes: number;
    fingerprint: string;
    labelId?: string;
    text?: string;
  }) {
    const service03 = capture.text ? this.extractServiceBytes(capture.text, '01-00-00-03') : undefined;
    const service07 = capture.text ? this.extractServiceBytes(capture.text, '01-00-00-07') : undefined;
    const service0c = capture.text ? this.extractServiceBytes(capture.text, '01-00-00-0c') : undefined;
    return {
      id: capture.id,
      createdAt: capture.createdAt,
      bytes: capture.bytes,
      fingerprint: capture.fingerprint,
      labelId: capture.labelId,
      service03Bytes: service03?.length,
      service07Bytes: service07?.length,
      service0cBytes: service0c?.length,
      service03Sha256: service03 ? createHash('sha256').update(service03).digest('hex') : undefined,
      service03HeadHex: service03?.subarray(0, 24).toString('hex'),
      service03TailHex: service03?.subarray(-24).toString('hex'),
    };
  }

  private extractServiceBytes(text: string, service: string) {
    try {
      const parsed = JSON.parse(text) as { type?: string; opas?: Array<{ cmds?: Array<Record<string, unknown>> }> };
      if (parsed.type !== 'READ_WRITE_SVC' || !Array.isArray(parsed.opas)) {
        return undefined;
      }
      for (const opa of parsed.opas) {
        for (const cmd of opa.cmds ?? []) {
          if (cmd.service === service && typeof cmd.b64dat === 'string') {
            return Buffer.from(cmd.b64dat, 'base64');
          }
        }
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private extractReadWriteServices(text: string) {
    try {
      const parsed = JSON.parse(text) as { type?: string; opas?: Array<{ cmds?: Array<Record<string, unknown>> }> };
      if (parsed.type !== 'READ_WRITE_SVC' || !Array.isArray(parsed.opas)) {
        return [];
      }
      const services: Array<Record<string, unknown>> = [];
      for (const opa of parsed.opas) {
        for (const cmd of opa.cmds ?? []) {
          if (typeof cmd.service !== 'string' || typeof cmd.b64dat !== 'string') {
            continue;
          }
          const bytes = Buffer.from(cmd.b64dat, 'base64');
          services.push({
            id: cmd.id,
            type: cmd.type,
            service: cmd.service,
            bytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            b64: cmd.b64dat,
            headHex: bytes.subarray(0, 24).toString('hex'),
            tailHex: bytes.subarray(-24).toString('hex'),
          });
        }
      }
      return services;
    } catch {
      return [];
    }
  }

  private withQuery(url: URL, query: Record<string, unknown>) {
    const next = new URL(url.toString());
    Object.entries(query).forEach(([key, value]) => next.searchParams.set(key, String(value)));
    return next;
  }

  private parseBody(text: string) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
}
