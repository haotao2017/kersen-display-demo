export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

export interface User {
  id: string;
  username: string;
  displayName?: string;
  email?: string;
  role: 'ADMIN' | 'OPERATOR' | 'VIEWER';
  status?: 'active' | 'disabled';
  lastLoginAt?: string;
  createdAt?: string;
}

export interface UserInvite {
  id: string;
  token: string;
  username: string;
  displayName?: string;
  email?: string;
  role: 'ADMIN' | 'OPERATOR' | 'VIEWER';
  expiresAt: string;
  usedAt?: string | null;
  revokedAt?: string | null;
  createdByUserId?: string | null;
  createdAt: string;
  registerPath?: string;
}

export interface AuditLog {
  id: string;
  module: string;
  action: string;
  targetId?: string | null;
  operatorId?: string | null;
  beforeJson?: Record<string, unknown> | null;
  afterJson?: Record<string, unknown> | null;
  createdAt: string;
}

export interface DashboardSummary {
  apOnlineCount: number;
  apOfflineCount: number;
  deviceOnlineCount: number;
  todayTaskSuccess: number;
  recentApEvents: Array<{ type: string; timestamp: string; title: string; message: string }>;
  recentFailedTasks: Array<{ id: string; timestamp: string; title: string; message: string; related: string }>;
}

export interface Store {
  id: string;
  code: string;
  name: string;
  address?: string;
  serverUrl?: string;
  mqttTcpPort?: number;
  mqttWsPath?: string;
  apCount?: number;
  onlineApCount?: number;
  deviceCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  sku: string;
  barcode?: string;
  name: string;
  subName?: string;
  specification?: string;
  unit?: string;
  brand?: string;
  categoryId?: string;
  price: number;
  originalPrice?: number;
  memberPrice?: number;
  promotionPrice?: number;
  promotionText?: string;
  imageUrl?: string;
  customFields?: Record<string, string>;
  defaultTemplateId?: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
  refresh?: {
    attempted: boolean;
    boundDeviceCount: number;
    refreshableDeviceCount: number;
    skippedDeviceCount: number;
    createdTaskCount: number;
    taskIds: string[];
    reasonCode: 'no_bound_devices' | 'no_template' | null;
    message: string;
  };
}

export interface TemplateElement {
  id: string;
  type: 'text' | 'image' | 'price' | 'barcode' | 'qrcode' | 'line' | 'rect' | 'label';
  x: number;
  y: number;
  width: number;
  height: number;
  rotate: number;
  visible: boolean;
  zIndex: number;
  bindingField?: string | null;
  expression?: string | null;
  imageUrl?: string | null;
  style: Record<string, unknown>;
}

export interface TemplateSchema {
  meta: {
    name: string;
    deviceType: string;
    width: number;
    height: number;
    colorMode: 'bw' | 'bwr' | 'bwry';
    version: number;
  };
  datasource: string[];
  elements: TemplateElement[];
}

export interface Template {
  id: string;
  code: string;
  name: string;
  deviceType: string;
  width: number;
  height: number;
  dpi: number;
  colorMode: 'bw' | 'bwr' | 'bwry';
  status: 'draft' | 'published';
  version: number;
  previewImageUrl?: string;
  schema: TemplateSchema;
  recentVersions?: Array<{
    id: string;
    version: number;
    previewImageUrl?: string;
    createdAt: string;
    schema?: TemplateSchema;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface Ap {
  id: string;
  apCode: string;
  storeCode?: string;
  storeName?: string;
  name: string;
  ownerUserId?: string | null;
  owner?: Pick<User, 'id' | 'username' | 'displayName'> | null;
  ip?: string;
  mac?: string;
  firmwareVersion?: string;
  location?: string;
  config: Record<string, unknown> & {
    autoImportScannedLabels?: boolean;
  };
  status: 'online' | 'offline';
  lastOnlineAt?: string;
  lastHeartbeatAt?: string;
  heartbeatIntervalSeconds?: number;
  online?: boolean;
  deviceCount?: number;
  discoveredDeviceCount?: number;
  devices?: EslDevice[];
  boundDevices?: EslDevice[];
  discoveredDevices?: Array<{
    eslCode: string;
    status: 'online' | 'offline' | 'warning';
    battery?: number | null;
    signal?: number | null;
    lastSeenAt?: string;
    source?: string;
    token?: number | null;
  }>;
  recentHeartbeats?: Array<{
    id: string;
    createdAt: string;
    status: string;
    payloadJson?: Record<string, unknown>;
  }>;
  recentTasks?: PushTask[];
  recentLogs?: Array<{
    id: string;
    time: string;
    method: string;
    path: string;
    statusCode?: number;
    body?: Record<string, unknown> | unknown;
    query?: Record<string, unknown> | unknown;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface TemplatePreview {
  previewImageUrl?: string;
  renderResult?: Record<string, unknown>;
}

export interface UploadImageResult {
  url: string;
  key: string;
  mimeType: string;
  size: number;
}

export interface DeviceDetail extends EslDevice {
  recentTasks?: PushTask[];
  product?: Product | null;
  template?: Template | null;
}

export interface EslDevice {
  id: string;
  eslCode: string;
  storeCode?: string;
  name?: string;
  apId?: string;
  productId?: string;
  templateId?: string;
  deviceType: string;
  screenWidth: number;
  screenHeight: number;
  battery: number;
  signal: number;
  bindStatus: 'bound' | 'unbound';
  status: 'online' | 'offline' | 'warning';
  lastRefreshAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PushTask {
  id: string;
  taskType: string;
  productId?: string;
  templateId?: string;
  eslDeviceId?: string;
  apId?: string;
  payload: Record<string, unknown>;
  renderResult?: Record<string, unknown>;
  userMessage?: string;
  resultMsg?: string;
  delivery?: {
    ok?: boolean;
    reason?: string;
    commandId?: string;
    transport?: string;
    websocket?: {
      ok?: boolean;
      trackingId?: string;
      reason?: string;
    };
    mqtt?: unknown;
    protocol?: Record<string, unknown>;
    downlinkTrace?: Record<string, unknown>;
  };
  retryCount: number;
  status: string;
  parentTaskId?: string;
  triggeredAt?: string;
  createdAt: string;
  updatedAt: string;
  product?: Product | null;
  template?: Template | null;
  eslDevice?: EslDevice | null;
  ap?: Ap | null;
  retryHistory?: PushTask[];
  events?: Array<{
    id?: string;
    time?: string;
    status?: string;
    message?: string;
    trace?: Record<string, unknown>;
  }>;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
