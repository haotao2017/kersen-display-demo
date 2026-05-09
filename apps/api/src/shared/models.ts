export type BaseStationStatus = 'offline' | 'online' | 'warning';
export type LabelStatus = 'idle' | 'updating' | 'online' | 'offline' | 'failed';
export type CommandStatus = 'queued' | 'sent' | 'ack' | 'failed';

export interface StoreConfig {
  id: string;
  code: string;
  name: string;
  username: string;
  passwordHash: string;
  serverUrl: string;
  mqttTcpPort: number;
  mqttWsPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface BaseStation {
  id: string;
  storeCode: string;
  name: string;
  mac?: string;
  ip?: string;
  firmware?: string;
  location?: unknown;
  config?: Record<string, unknown>;
  os?: string;
  hostAddr?: string;
  channels?: Array<Record<string, unknown>>;
  discoveredLabels?: Record<string, {
    eslCode: string;
    status: 'online' | 'offline' | 'warning';
    battery?: number | null;
    signal?: number | null;
    lastSeenAt?: string;
    source?: string;
    services?: Record<string, unknown>;
  }>;
  status: BaseStationStatus;
  lastSeenAt?: string;
  metrics: {
    rssi?: number;
    labelsOnline?: number;
    labelsTotal?: number;
  };
}

export interface Label {
  id: string;
  storeCode: string;
  apId?: string;
  sku?: string;
  title: string;
  price: number;
  currency: string;
  status: LabelStatus;
  battery?: number;
  rssi?: number;
  services?: Record<string, unknown>;
  updatedAt: string;
}

export interface EslCommand {
  id: string;
  storeCode: string;
  targetType: 'ap' | 'label';
  targetId: string;
  type: 'refresh_label' | 'bind_label' | 'reboot_ap' | 'raw';
  payload: Record<string, unknown>;
  status: CommandStatus;
  createdAt: string;
  sentAt?: string;
  ackAt?: string;
}

export interface RequestLog {
  id: string;
  time: string;
  method: string;
  path: string;
  statusCode?: number;
  ip?: string;
  userAgent?: string;
  body?: unknown;
  query?: unknown;
}

export interface OfficialDownlinkCapture {
  id: string;
  apId: string;
  storeCode?: string;
  targetUrl: string;
  createdAt: string;
  kind: 'text' | 'binary';
  bytes: number;
  replayable: boolean;
  text?: string;
  base64?: string;
  hexPrefix?: string;
  commandType?: string;
  labelId?: string;
  queueId?: number;
  fingerprint: string;
  summary: Record<string, unknown>;
}
