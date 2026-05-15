export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
export const EVENTS_URL = import.meta.env.VITE_EVENTS_URL ?? '/api/v1/events/stream';

export const queryKeys = {
  dashboard: ['dashboard'],
  me: ['me'],
  stores: ['stores'],
  products: ['products'],
  product: (id: string) => ['product', id],
  productDevices: (id: string) => ['product-devices', id],
  templates: ['templates'],
  template: (id: string) => ['template', id],
  templateSchema: (id: string) => ['template-schema', id],
  devices: ['devices'],
  device: (id: string) => ['device', id],
  aps: ['aps'],
  ap: (id: string) => ['ap', id],
  apSummary: (id: string) => ['ap-summary', id],
  apSnapshot: (id: string) => ['ap-snapshot', id],
  users: ['users'],
  userDetail: (id: string) => ['user', id],
  userInvites: ['user-invites'],
  auditLogs: ['audit-logs'],
  tasks: ['tasks'],
  task: (id: string) => ['task', id],
};
