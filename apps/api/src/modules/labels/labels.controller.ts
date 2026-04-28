import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsNumber, IsObject, IsOptional, IsString } from 'class-validator';
import { gzipSync } from 'node:zlib';
import { MqttService } from '../mqtt/mqtt.service';
import { AuthGuard } from '../../shared/auth.guard';
import { MemoryStore } from '../../shared/memory-store';
import { Label } from '../../shared/models';
import { ApWebsocketService } from '../ap-websocket/ap-websocket.service';
import { LabelRendererService } from './label-renderer.service';
import { buildTaskEsl2Payload } from './esl-payload';

class UpsertLabelDto {
  @IsString()
  id!: string;

  @IsString()
  storeCode!: string;

  @IsOptional()
  @IsString()
  apId?: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsString()
  title!: string;

  @IsNumber()
  price!: number;

  @IsOptional()
  @IsString()
  currency?: string;
}

class CommandDto {
  @IsString()
  storeCode!: string;

  @IsString()
  type!: 'refresh_label' | 'bind_label' | 'raw';

  @IsObject()
  payload!: Record<string, unknown>;
}

class DocumentCommandDto {
  @IsString()
  storeCode!: string;

  @IsString()
  commandType!: string;

  @IsOptional()
  @IsString()
  apId?: string;

  @IsObject()
  params!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  delivery?: {
    mqtt?: boolean;
    websocket?: boolean;
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@UseGuards(AuthGuard)
@Controller('api/labels')
export class LabelsController {
  constructor(
    private readonly db: MemoryStore,
    private readonly mqtt: MqttService,
    private readonly apWebsocket: ApWebsocketService,
    private readonly renderer: LabelRendererService,
  ) {}

  @Get()
  list() {
    return [...this.db.labels.values()];
  }

  @Post()
  upsert(@Body() dto: UpsertLabelDto) {
    const label: Label = {
      id: dto.id,
      storeCode: dto.storeCode,
      apId: dto.apId,
      sku: dto.sku,
      title: dto.title,
      price: dto.price,
      currency: dto.currency ?? 'CNY',
      status: 'idle',
      battery: this.db.labels.get(dto.id)?.battery,
      updatedAt: new Date().toISOString(),
    };
    this.db.labels.set(label.id, label);
    this.db.save();
    return label;
  }

  @Get(':id/render')
  render(@Param('id') id: string) {
    return this.renderer.render(this.db.labels.get(id));
  }

  @Post(':id/commands')
  async command(@Param('id') id: string, @Body() dto: CommandDto) {
    const label = this.db.labels.get(id);
    const render = label ? this.renderer.render(label) : undefined;
    const apId = label?.apId ?? [...this.db.baseStations.values()].find((item) => item.status === 'online')?.id;
    const protocolPacket = dto.type === 'refresh_label' && render && apId
      ? this.buildTaskEsl2Packet(dto.storeCode, apId, id, render.bgraGzip.bgra_gzip_b64, dto.payload)
      : undefined;
    const payload = dto.type === 'refresh_label' && render
      ? {
        ...dto.payload,
        image: {
          labelId: id,
          width: render.width,
          height: render.height,
          colors: render.colors,
          preview_svg_b64: render.preview.svg_b64,
          bitmap_format: render.bitmap.format,
          bitmap_b64: render.bitmap.bitmap_b64,
          rowBytes: render.bitmap.rowBytes,
          blackBit: render.bitmap.blackBit,
          png_b64: render.png.png_b64,
          png_bytes: render.png.bytes,
          bgra_gzip_b64: render.bgraGzip.bgra_gzip_b64,
          bgra_gzip_bytes: render.bgraGzip.bytes,
        },
        protocol: protocolPacket
          ? {
            topic: protocolPacket.topic,
            payload_format: 'taskESL2-msgpack',
            image_format: 'bgra-gzip',
            topic_alias: protocolPacket.topicAlias,
            tag_tokens: protocolPacket.tagTokens,
            imageBytes: protocolPacket.imageBytes,
          }
          : {
            error: apId ? 'Unable to render ESL_WRITE packet' : 'No online AP found',
          },
      }
      : dto.payload;

    const command = this.db.createCommand({
      storeCode: dto.storeCode,
      targetType: 'label',
      targetId: id,
      type: dto.type,
      payload,
    });

    if (dto.type === 'refresh_label' && protocolPacket) {
      const mqttResults = [];
      try {
        for (const topic of protocolPacket.publishTopics) {
          await this.mqtt.publishBinary(topic, protocolPacket.payloadBuffer, { retain: false, qos: 1 });
          mqttResults.push({ topic, type: 'taskESL2', ok: true });
          this.recordTaskEsl2Outbound('MQTT-OUT-BINARY', topic, 200, protocolPacket);
        }
      } catch (error) {
        mqttResults.push({ topic: protocolPacket.topic, type: 'taskESL2', ok: false, reason: error instanceof Error ? error.message : String(error) });
        this.recordTaskEsl2Outbound('MQTT-OUT-BINARY', protocolPacket.topic, 500, protocolPacket, error);
      }

      const imageWsResult = this.apWebsocket.sendBinary(apId as string, protocolPacket.payloadBuffer, {
        type: 'taskESL2',
        topic: protocolPacket.topic,
        labelId: id,
        imageFormat: protocolPacket.imageFormat,
      });
      command.status = mqttResults.some((item) => item.ok) || imageWsResult.ok ? 'sent' : 'failed';
      command.sentAt = new Date().toISOString();
      this.db.commands.set(command.id, command);
      this.db.save();
      return {
        ...command,
        transport: 'taskESL2',
        delivery: {
          mqtt: mqttResults,
          websocketBinary: imageWsResult,
        },
        protocol: {
          topic: protocolPacket.topic,
          alternateTopics: protocolPacket.alternateTopics,
          payloadFormat: 'taskESL2-msgpack',
          imageFormat: protocolPacket.imageFormat,
          payloadBytes: protocolPacket.payloadBytes,
          imageBytes: protocolPacket.imageBytes,
          tagTokens: protocolPacket.tagTokens,
        },
        execution: {
          confirmed: false,
          reason: '已按 Kersen-Display-Cloud 的 taskESL2 二进制刷图协议下发；现在要看 /estation/{ap}/result 或 /estation/{ap}/message 是否返回执行结果。',
        },
      };
    }

    const wsPayload = dto.type === 'raw' ? dto.payload : {
      type: 'LABEL_COMMAND',
      command_id: command.id,
      label_id: id,
      command_type: dto.type,
      payload,
    };

    const wsResult = apId ? this.apWebsocket.sendRaw(apId, wsPayload) : { ok: false, reason: 'No online AP found' };
    if (wsResult.ok) {
      command.status = 'sent';
      command.sentAt = new Date().toISOString();
      this.db.commands.set(command.id, command);
      this.db.save();
      return {
        ...command,
        transport: 'websocket',
        delivery: wsResult,
        execution: {
          confirmed: false,
          reason: 'AP accepted the WebSocket frame, but no screen-refresh ACK was observed.',
        },
      };
    }

    await this.mqtt.publishLabelCommand(command);
    return {
      ...command,
      transport: 'mqtt',
      delivery: wsResult,
      mqtt: { ok: true },
      execution: {
        confirmed: false,
        reason: 'Command was published to MQTT because the AP WebSocket was unavailable or stale.',
      },
    };
  }

  @Post(':id/document-command')
  async documentCommand(@Param('id') id: string, @Body() dto: DocumentCommandDto) {
    const label = this.db.labels.get(id);
    const apId = dto.apId || label?.apId || [...this.db.baseStations.values()].find((item) => item.status === 'online')?.id;
    if (!apId) {
      return {
        ok: false,
        reason: '没有在线基站，无法下发文档指令',
      };
    }

    const taskPacket = dto.commandType === 'task_esl2'
      ? this.buildTaskEsl2Packet(
        dto.storeCode,
        apId,
        this.readString(dto.params.esl_code, id),
        this.resolveBgraGzipForTaskEsl2(id, dto.params),
        dto.params,
      )
      : undefined;
    const packet = taskPacket ?? this.buildDocumentPacket(dto.storeCode, apId, id, dto.commandType, dto.params);
    const jsonPacket = taskPacket ? undefined : packet as ReturnType<LabelsController['buildDocumentPacket']>;
    const sendMqtt = dto.delivery?.mqtt !== false;
    const sendWs = dto.delivery?.websocket !== false;
    const mqttResults = [];
    const shouldSendPsm = ['image', 'image_led', 'white'].includes(dto.commandType) && dto.params.pre_psm !== false;
    const psmPacket = shouldSendPsm ? this.buildDocumentPacket(dto.storeCode, apId, id, 'ap_psm', dto.params) : undefined;

    if (sendMqtt) {
      try {
        if (psmPacket) {
          await this.mqtt.publishJson(psmPacket.topic, psmPacket.command, { retain: false });
          mqttResults.push({ topic: psmPacket.topic, type: String(psmPacket.command.type ?? 'UNKNOWN'), ok: true });
          this.recordDocumentOutbound('MQTT-OUT', psmPacket.topic, 200, psmPacket);
          await wait(300);
        }
        if (taskPacket) {
          for (const topic of taskPacket.publishTopics) {
            await this.mqtt.publishBinary(topic, taskPacket.payloadBuffer, { retain: false, qos: 1 });
            mqttResults.push({ topic, type: 'taskESL2', ok: true });
            this.recordTaskEsl2Outbound('MQTT-OUT-BINARY', topic, 200, taskPacket);
          }
        } else if (jsonPacket) {
          await this.mqtt.publishJson(jsonPacket.topic, jsonPacket.command, { retain: false });
          mqttResults.push({ topic: jsonPacket.topic, type: String(jsonPacket.command.type ?? 'UNKNOWN'), ok: true });
          this.recordDocumentOutbound('MQTT-OUT', jsonPacket.topic, 200, jsonPacket);
        }
      } catch (error) {
        mqttResults.push({ topic: packet.topic, type: taskPacket ? 'taskESL2' : String(jsonPacket?.command.type ?? 'UNKNOWN'), ok: false, reason: error instanceof Error ? error.message : String(error) });
        if (taskPacket) {
          this.recordTaskEsl2Outbound('MQTT-OUT-BINARY', packet.topic, 500, taskPacket, error);
        } else if (jsonPacket) {
          this.recordDocumentOutbound('MQTT-OUT', jsonPacket.topic, 500, jsonPacket, error);
        }
      }
    }

    const psmWsResult = sendWs && psmPacket ? this.apWebsocket.sendRaw(apId, psmPacket.command) : undefined;
    if (psmWsResult?.ok) {
      await wait(300);
    }
    const wsResult = sendWs
      ? taskPacket
        ? this.apWebsocket.sendBinary(apId, taskPacket.payloadBuffer, { type: 'taskESL2', topic: taskPacket.topic, labelId: id })
        : jsonPacket
          ? this.apWebsocket.sendRaw(apId, jsonPacket.command)
          : { ok: false, reason: 'No document packet' }
      : { ok: false, reason: 'WebSocket delivery disabled' };

    return {
      ok: mqttResults.some((item) => item.ok) || wsResult.ok,
      transport: taskPacket ? 'taskESL2' : 'document',
      commandType: dto.commandType,
      delivery: {
        mqtt: mqttResults,
        websocketPsm: psmWsResult,
        websocket: wsResult,
      },
      protocol: {
        topic: packet.topic,
        alternateTopics: taskPacket?.alternateTopics,
        imageFormat: taskPacket?.imageFormat,
        payloadBytes: packet.payloadBytes,
        imageBytes: taskPacket?.imageBytes,
        queueId: 'queueId' in packet ? packet.queueId : undefined,
        tagTokens: taskPacket?.tagTokens,
      },
      command: taskPacket ? {
        type: 'taskESL2',
        topicAlias: taskPacket.topicAlias,
        labelId: taskPacket.labelId,
        publishTopics: taskPacket.publishTopics,
        payloadBytes: taskPacket.payloadBytes,
        imageBytes: taskPacket.imageBytes,
      } : jsonPacket ? this.summarizeCommand(jsonPacket.command) : undefined,
      psmCommand: psmPacket ? this.summarizeCommand(psmPacket.command) : undefined,
      subscribe: [
        `/estation/${apId}/#`,
        `/estation/${apId.toUpperCase()}/#`,
        `/estation/${apId.replace(/:/g, '').toUpperCase()}/#`,
        `${dto.storeCode}/${apId}/result`,
        `${dto.storeCode}/${apId}/cmd`,
        `${dto.storeCode}/+/result`,
        `${dto.storeCode}/+/cmd`,
        `stores/${dto.storeCode}/#`,
      ],
    };
  }

  private buildRefreshProtocolPacket(storeCode: string, apId: string, labelId: string, pngBase64: string) {
    const queueId = Math.floor(Date.now() % 2_147_483_647);
    const command = {
      type: 'ESL_WRITE',
      data: {
        esl_code: labelId,
        img: {
          queue_id: queueId,
          source: pngBase64,
          mode: 1,
          orientation: 0,
        },
      },
    };
    return {
      topic: `${storeCode}/${apId}/cmd`,
      command,
      payloadBytes: Buffer.byteLength(JSON.stringify(command)),
      imageBytes: Buffer.from(pngBase64, 'base64').length,
      queueId,
    };
  }

  private buildTaskEsl2Packet(storeCode: string, apId: string, labelId: string, bgraGzipBase64: string, params: Record<string, unknown> = {}) {
    const normalizedAp = apId.trim();
    const apUpper = normalizedAp.toUpperCase();
    const apNoColonUpper = normalizedAp.replace(/:/g, '').toUpperCase();
    const apNoColonLower = normalizedAp.replace(/:/g, '').toLowerCase();
    const topicAp = this.readString(params.ap_code, apUpper).trim() || apUpper;
    const topic = `/estation/${topicAp}/taskESL2`;
    const publishTopics = [...new Set([
      topic,
      `/estation/${apUpper}/taskESL2`,
      `/estation/${normalizedAp}/taskESL2`,
      `/estation/${apNoColonUpper}/taskESL2`,
      `/estation/${apNoColonLower}/taskESL2`,
    ])];
    const labelCode = this.readString(params.esl_code, labelId).trim().toUpperCase();
    const imageBytes = Buffer.from(bgraGzipBase64, 'base64');
    const protocolPayload = buildTaskEsl2Payload({
      tagIds: [labelCode],
      pattern: this.readNumber(params.pattern, 0),
      pageIndex: this.readNumber(params.page_index, 0),
      imageBytes,
      compress: this.readBool(params.compress, true),
      oldKey: this.readString(params.old_key, ''),
      newKey: this.readString(params.new_key, ''),
      ledRed: Boolean(params.led_red),
      ledGreen: Boolean(params.led_green),
      ledBlue: Boolean(params.led_blue),
      ledTimes: this.readNumber(params.led_times, 0),
      tokenSeed: this.readNumber(params.token_seed, Date.now()),
    });
    const payloadBuffer = Buffer.from(protocolPayload.payloadBytes);

    return {
      topic,
      alternateTopics: publishTopics.filter((item) => item !== topic),
      publishTopics,
      topicAlias: '0x02',
      payloadBuffer,
      payloadBytes: payloadBuffer.length,
      payloadBase64: protocolPayload.payloadBase64,
      imageBytes: imageBytes.length,
      imageFormat: 'bgra-gzip',
      entityCount: protocolPayload.entityCount,
      tagTokens: protocolPayload.tagTokens,
      labelId: labelCode,
      storeCode,
      apId,
    };
  }

  private buildPsmPacket(storeCode: string, apId: string) {
    const advGroup = Number(process.env.ESL_ADV_GROUP ?? 32);
    const command = {
      type: 'AP_PSM',
      data: {
        mode: process.env.ESL_PSM_MODE ?? 'fast',
        adv_group: advGroup,
        merge: {
          enable: true,
          duration_ms: Number(process.env.ESL_PSM_DURATION_MS ?? 5000),
          act_time_us: Number(process.env.ESL_PSM_ACT_TIME_US ?? 3000),
          slp_cycle_ms: Number(process.env.ESL_PSM_SLP_CYCLE_MS ?? 4000),
          adv_interval_ms: Number(process.env.ESL_PSM_ADV_INTERVAL_MS ?? 60000),
          retry_num: Number(process.env.ESL_PSM_RETRY_NUM ?? 2),
          parallel_num: Number(process.env.ESL_PSM_PARALLEL_NUM ?? 3),
          ap_chn_num: Number(process.env.ESL_PSM_AP_CHN_NUM ?? -1),
        },
      },
    };

    return {
      topic: `${storeCode}/${apId}/cmd`,
      command,
      payloadBytes: Buffer.byteLength(JSON.stringify(command)),
      queueId: undefined,
      imageBytes: undefined,
    };
  }

  private buildDocumentPacket(storeCode: string, apId: string, labelId: string, commandType: string, params: Record<string, unknown>) {
    const queueId = this.readNumber(params.queue_id, Math.floor(Date.now() % 2_147_483_647));
    const topic = `${storeCode}/${apId}/cmd`;
    const eslCode = this.readString(params.esl_code, labelId);
    let command: Record<string, unknown>;

    if (commandType === 'ap_psm') {
      command = {
        type: 'AP_PSM',
        data: {
          mode: this.readString(params.psm_mode, 'fast'),
          adv_group: this.readNumber(params.adv_group, 32),
          merge: {
            enable: true,
            duration_ms: this.readNumber(params.duration_ms, 5000),
            act_time_us: this.readNumber(params.act_time_us, 3000),
            slp_cycle_ms: this.readNumber(params.slp_cycle_ms, 4000),
            adv_interval_ms: this.readNumber(params.adv_interval_ms, 60000),
            retry_num: this.readNumber(params.retry_num, 2),
            parallel_num: this.readNumber(params.parallel_num, 3),
            ap_chn_num: this.readNumber(params.ap_chn_num, -1),
          },
        },
      };
    } else if (commandType === 'ap_svc_cfg') {
      command = {
        type: 'AP_SVC_CFG',
        adv_group: this.readNumber(params.adv_group, 32),
        adv_psm_interval_sec: 60,
        adv_listen_slave_enable: true,
        adv_psm_cfg: {
          enable: false,
          duration_ms: this.readNumber(params.duration_ms, 5000),
          act_time_us: this.readNumber(params.act_time_us, 3000),
          slp_cycle_ms: this.readNumber(params.slp_cycle_ms, 24000),
          adv_interval_ms: this.readNumber(params.adv_interval_ms, 60000),
          adv_map: this.readNumber(params.adv_map, 7),
          wait_conn_ch_idx: this.readNumber(params.wait_conn_ch_idx, 10),
        },
        rd_wr_svc_cfg: {
          retry_num: this.readNumber(params.retry_num, 3),
          parallel_num: this.readNumber(params.parallel_num, 3),
          ap_chn_num: this.readNumber(params.ap_chn_num, 255),
        },
      };
    } else if (commandType === 'ap_restart') {
      command = { type: 'AP_RESTART' };
    } else if (commandType === 'ap_reboot') {
      command = { type: 'AP_REBOOT' };
    } else if (commandType === 'ap_channels') {
      command = { type: 'AP_CHANNELS' };
    } else if (commandType === 'ap_ota') {
      command = {
        type: 'AP_OTA',
        data: {
          url: this.readString(params.url, ''),
          md5: this.readString(params.md5, ''),
        },
      };
    } else if (commandType === 'image' || commandType === 'image_led' || commandType === 'white') {
      const data: Record<string, unknown> = {
        esl_code: eslCode,
        img: {
          queue_id: queueId,
          source: commandType === 'white' ? '' : this.readString(params.source, ''),
          mode: this.readNumber(params.mode, 1),
          orientation: this.readNumber(params.orientation, 0),
        },
      };
      if (commandType === 'image_led') {
        data.led = this.buildLedParams(params, queueId);
      }
      command = { type: 'ESL_WRITE', data };
    } else if (commandType === 'led') {
      command = {
        type: 'READ_WRITE_SVC',
        opas: [
          {
            addr: eslCode,
            cmds: [
              { id: 0, type: 'CONN_DEV' },
              {
                id: 16,
                type: 'WRITE_SVC',
                service: '01-00-00-07',
                b64dat: this.readString(params.led_b64dat, 'ZAAAAf88AA=='),
              },
            ],
          },
        ],
      };
    } else if (commandType === 'stop_led') {
      command = {
        type: 'ESL_WRITE',
        data: {
          esl_code: eslCode,
          led: this.buildLedParams({
            ...params,
            time_s: commandType === 'stop_led' ? 0 : params.time_s,
          }, queueId),
        },
      };
    } else if (commandType === 'ndef') {
      command = {
        type: 'ESL_WRITE',
        data: {
          esl_code: eslCode,
          ndef: {
            queue_id: queueId,
            b64dat: this.readString(params.b64dat, ''),
          },
        },
      };
    } else if (commandType === 'ota') {
      command = {
        type: 'ESL_OTA',
        data: {
          queue_id: queueId,
          esl_code: eslCode,
          b64dat: this.readString(params.b64dat, ''),
        },
      };
    } else if (commandType === 'group_change') {
      command = {
        type: 'ESL_GROUP_CHANGE',
        data: {
          queue_id: queueId,
          esl_code: eslCode,
          group: this.readNumber(params.group, 32),
        },
      };
    } else if (commandType === 'refresh') {
      command = {
        type: 'ESL_WRITE',
        data: {
          esl_code: eslCode,
          refresh_data: {
            queue_id: queueId,
            source: this.readString(params.source, ''),
            index: this.readNumber(params.index, 0),
          },
        },
      };
    } else if (commandType === 'raw') {
      command = this.readObject(params.raw, { type: 'ESL_WRITE', data: { esl_code: eslCode } });
    } else {
      command = this.readObject(params.raw, { type: commandType, data: params });
    }

    return {
      topic,
      command,
      payloadBytes: Buffer.byteLength(JSON.stringify(command)),
      queueId,
    };
  }

  private buildLedParams(params: Record<string, unknown>, queueId: number) {
    return {
      queue_id: queueId,
      r: this.readNumber(params.r, 255),
      g: this.readNumber(params.g, 0),
      b: this.readNumber(params.b, 0),
      time_on_ms: this.readNumber(params.time_on_ms, 20),
      time_s: this.readNumber(params.time_s, 60),
    };
  }

  private readString(value: unknown, fallback: string) {
    return typeof value === 'string' ? value : fallback;
  }

  private readNumber(value: unknown, fallback: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private readObject(value: unknown, fallback: Record<string, unknown>) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fallback;
  }

  private readBool(value: unknown, fallback: boolean) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value === 'true' ? true : value === 'false' ? false : fallback;
    return fallback;
  }

  private resolveBgraGzipForTaskEsl2(labelId: string, params: Record<string, unknown>) {
    const explicit = this.readString(params.bgra_gzip_b64, '');
    if (explicit) {
      return explicit;
    }

    const rgbaBase64 = this.readString(params.rgba_b64, '');
    if (rgbaBase64) {
      const width = this.readNumber(params.width, 296);
      const height = this.readNumber(params.height, 128);
      const rgba = Buffer.from(rgbaBase64, 'base64');
      if (rgba.length !== width * height * 4) {
        throw new Error(`RGBA 图片尺寸不匹配：${rgba.length} bytes, expected ${width * height * 4}`);
      }
      const quantized = this.quantizeRgba(rgba, this.readString(params.color_mode, 'bwr'));
      return gzipSync(this.toBgraBytes(quantized)).toString('base64');
    }

    const label = this.db.labels.get(labelId);
    if (!label) {
      throw new Error('没有图片数据，也找不到价签模板渲染结果');
    }
    return this.renderer.render(label).bgraGzip.bgra_gzip_b64;
  }

  private quantizeRgba(rgba: Buffer, colorMode: string) {
    const output = Buffer.from(rgba);
    const palette = this.palette(colorMode);
    for (let offset = 0; offset < output.length; offset += 4) {
      if (output[offset + 3] < 16) {
        output[offset] = 255;
        output[offset + 1] = 255;
        output[offset + 2] = 255;
        output[offset + 3] = 255;
        continue;
      }
      let best = palette[0];
      let bestDistance = Number.MAX_SAFE_INTEGER;
      for (const candidate of palette) {
        const dr = candidate[0] - output[offset];
        const dg = candidate[1] - output[offset + 1];
        const db = candidate[2] - output[offset + 2];
        const distance = dr * dr + dg * dg + db * db;
        if (distance < bestDistance) {
          best = candidate;
          bestDistance = distance;
        }
      }
      output[offset] = best[0];
      output[offset + 1] = best[1];
      output[offset + 2] = best[2];
      output[offset + 3] = 255;
    }
    return output;
  }

  private palette(colorMode: string): Array<[number, number, number]> {
    const palettes: Record<string, Array<[number, number, number]>> = {
      bw: [[255, 255, 255], [0, 0, 0]],
      bwr: [[255, 255, 255], [0, 0, 0], [255, 0, 0]],
      bwy: [[255, 255, 255], [0, 0, 0], [255, 214, 0]],
      bwry: [[255, 255, 255], [0, 0, 0], [255, 0, 0], [255, 214, 0]],
    };
    return palettes[colorMode] ?? palettes.bwr;
  }

  private toBgraBytes(rgba: Buffer) {
    const output = Buffer.allocUnsafe(rgba.length);
    for (let offset = 0; offset < rgba.length; offset += 4) {
      output[offset] = rgba[offset + 2];
      output[offset + 1] = rgba[offset + 1];
      output[offset + 2] = rgba[offset];
      output[offset + 3] = rgba[offset + 3];
    }
    return output;
  }

  private recordTaskEsl2Outbound(
    method: string,
    topic: string,
    statusCode: number,
    packet: ReturnType<LabelsController['buildTaskEsl2Packet']>,
    error?: unknown,
  ) {
    this.db.recordRequest({
      method,
      path: topic,
      statusCode,
      body: {
        topic,
        topicAlias: packet.topicAlias,
        labelId: packet.labelId,
        payloadFormat: 'taskESL2-msgpack',
        imageFormat: packet.imageFormat,
        payloadBytes: packet.payloadBytes,
        imageBytes: packet.imageBytes,
        entityCount: packet.entityCount,
        tagTokens: packet.tagTokens,
        payloadPrefixHex: packet.payloadBuffer.subarray(0, 24).toString('hex'),
        error: error instanceof Error ? error.message : error ? String(error) : undefined,
      },
    });
  }

  private recordDocumentOutbound(method: string, topic: string, statusCode: number, packet: ReturnType<LabelsController['buildDocumentPacket']>, error?: unknown) {
    this.db.recordRequest({
      method,
      path: topic,
      statusCode,
      body: {
        topic,
        type: String(packet.command.type ?? 'UNKNOWN'),
        queue_id: packet.queueId,
        payloadBytes: packet.payloadBytes,
        command: this.summarizeCommand(packet.command),
        error: error instanceof Error ? error.message : error ? String(error) : undefined,
      },
    });
  }

  private summarizeCommand(command: Record<string, unknown>) {
    const cloned = JSON.parse(JSON.stringify(command)) as Record<string, unknown>;
    const data = cloned.data as Record<string, unknown> | undefined;
    const img = data?.img as Record<string, unknown> | undefined;
    if (img && typeof img.source === 'string' && img.source.length > 80) {
      img.source_prefix = img.source.slice(0, 32);
      img.source_chars = img.source.length;
      img.source = '[omitted]';
    }
    return cloned;
  }

  private recordOutboundMqtt(
    topic: string,
    statusCode: number,
    packet: ReturnType<LabelsController['buildRefreshProtocolPacket']> | ReturnType<LabelsController['buildPsmPacket']>,
    error?: unknown,
  ) {
    const eslWriteData = 'img' in packet.command.data ? packet.command.data : undefined;
    this.db.recordRequest({
      method: 'MQTT-OUT',
      path: topic,
      statusCode,
      body: {
        topic,
        type: packet.command.type,
        esl_code: eslWriteData?.esl_code,
        queue_id: packet.queueId,
        image: eslWriteData ? {
          mode: eslWriteData.img.mode,
          orientation: eslWriteData.img.orientation,
          bytes: packet.imageBytes,
          source_chars: eslWriteData.img.source.length,
          source_prefix: eslWriteData.img.source.slice(0, 32),
        } : undefined,
        psm: packet.command.type === 'AP_PSM' ? packet.command.data : undefined,
        error: error instanceof Error ? error.message : error ? String(error) : undefined,
      },
    });
  }
}
