import { http } from '../services/http';
import type { AuditLog, DashboardSummary, Paginated, Product, Template, TemplateSchema, EslDevice, Ap, PushTask, User, UserInvite, UserDetail, DeviceDetail, TemplatePreview, UploadImageResult, Store } from '../types/domain';

export interface RefreshLinkedResult {
  attempted: boolean;
  boundDeviceCount: number;
  refreshableDeviceCount: number;
  skippedDeviceCount: number;
  createdTaskCount: number;
  taskIds: string[];
  reasonCode: 'no_bound_devices' | 'no_template' | 'no_change' | null;
  message: string;
}

export interface ProductUpdateResult extends Product {
  refresh: RefreshLinkedResult;
}

export interface ProductRefreshResult {
  createdTaskCount: number;
  taskIds: string[];
  boundDeviceCount: number;
  skippedDeviceCount: number;
  reasonCode: 'no_bound_devices' | 'no_template' | 'no_change' | null;
}

export const api = {
  login: (payload: { username: string; password: string }) => http.post<{ accessToken: string; refreshToken: string; expiresIn: number; user: User }>('/auth/login', payload),
  me: () => http.get<User>('/auth/me'),
  inviteDetail: (token: string) => http.get<{ username: string; displayName?: string; email?: string; role: User['role']; expiresAt: string }>(`/auth/invites/${token}`),
  register: (payload: { token: string; password: string; displayName?: string; email?: string }) =>
    http.post<{ accessToken: string; refreshToken: string; expiresIn: number; user: User }>('/auth/register', payload),
  logout: (payload: { refreshToken: string }) => http.post<boolean>('/auth/logout', payload),
  dashboard: () => http.get<DashboardSummary>('/dashboard/summary'),
  stores: (params?: Record<string, unknown>) => http.get<Paginated<Store>>('/stores', { params }),
  createStore: (payload: Pick<Store, 'code' | 'name'> & { address?: string; ownerUserId?: string }) => http.post<Store>('/stores', payload),
  updateStore: (code: string, payload: Pick<Store, 'code' | 'name'> & { address?: string }) => http.put<Store>(`/stores/${code}`, payload),
  deleteStore: (code: string) => http.delete<{ deleted: boolean; code: string }>(`/stores/${code}`),
  products: (params?: Record<string, unknown>) => http.get<Paginated<Product>>('/products', { params }),
  productGroups: () => http.get<{ items: string[] }>('/products/groups'),
  product: (id: string) => http.get<Product & { defaultTemplate?: Template | null; boundDevices?: EslDevice[] }>(`/products/${id}`),
  productDevices: (id: string, params?: Record<string, unknown>) => http.get<Paginated<EslDevice>>('/esl-devices', { params: { ...params, productId: id } }),
  createProduct: (payload: Partial<Product>) => http.post<Product>('/products', payload),
  updateProduct: (id: string, payload: Partial<Product>) => http.put<ProductUpdateResult>(`/products/${id}`, payload),
  refreshProduct: (id: string) => http.post<ProductRefreshResult>(`/products/${id}/refresh-linked-devices`, { force: true }),
  productDeleteImpact: (id: string) => http.get<Record<string, any>>(`/products/${id}/delete-impact`),
  deleteProduct: (id: string) => http.delete<{ deleted: boolean; id: string; impact?: Record<string, any> }>(`/products/${id}`),
  templates: (params?: Record<string, unknown>) => http.get<Paginated<Template>>('/templates', { params }),
  template: (id: string) => http.get<Template>(`/templates/${id}`),
  createTemplate: (payload: Partial<Template>) => http.post<Template>('/templates', payload),
  updateTemplate: (id: string, payload: Partial<Template>) => http.put<Template>(`/templates/${id}`, payload),
  templateSchema: (id: string) => http.get<{ schema: TemplateSchema }>(`/templates/${id}/schema`),
  saveTemplateSchema: (id: string, schema: TemplateSchema) => http.put<{ schema: TemplateSchema }>(`/templates/${id}/schema`, { schema }),
  previewTemplate: (id: string, sampleData: Record<string, unknown>) => http.post<TemplatePreview>(`/templates/${id}/preview`, { sampleData }),
  publishTemplate: (id: string, refreshLinkedDevices = false) => http.post<{ ok: boolean; template?: Template; refresh?: RefreshLinkedResult }>(`/templates/${id}/publish`, { refreshLinkedDevices }),
  duplicateTemplate: (id: string, payload: { name: string; code: string }) => http.post<Template>(`/templates/${id}/duplicate`, payload),
  deleteTemplate: (id: string) => http.delete<{ deleted: boolean; id: string }>(`/templates/${id}`),
  templateDeleteImpact: (id: string) => http.get<Record<string, any>>(`/templates/${id}/delete-impact`),
  deleteTemplateVersion: (id: string, versionId: string) => http.delete<{ deleted: boolean; versionId: string }>(`/templates/${id}/versions/${versionId}`),
  devices: (params?: Record<string, unknown>) => http.get<Paginated<EslDevice>>('/esl-devices', { params }),
  deviceGroups: () => http.get<{ items: string[] }>('/esl-devices/groups'),
  createDevice: (payload: { eslCode: string; name: string; apId?: string; storeCode?: string; deviceType?: string; ownerUserId?: string; group?: string }) => http.post<EslDevice>('/esl-devices', payload),
  updateDevice: (id: string, payload: { eslCode: string; name: string; apId?: string | null; productId?: string | null; templateId?: string | null; group?: string | null }) => http.put<EslDevice>(`/esl-devices/${id}`, payload),
  device: (id: string) => http.get<DeviceDetail>(`/esl-devices/${id}`),
  bindDevice: (id: string, payload: { productId: string; templateId?: string; autoRefresh?: boolean }) => http.post<DeviceDetail>(`/esl-devices/${id}/bind`, payload),
  batchBindDevices: (payload: { deviceIds: string[]; productId?: string; templateId?: string }) => http.post<{ updatedCount: number; deviceIds: string[] }>('/esl-devices/batch-bind', payload),
  batchUnbindDevices: (payload: { deviceIds: string[] }) => http.post<{ updatedCount: number }>('/esl-devices/batch-unbind', payload),
  unbindDevice: (id: string) => http.post<DeviceDetail>(`/esl-devices/${id}/unbind`, { reason: 'manual unbind' }),
  deviceDeleteImpact: (id: string) => http.get<Record<string, any>>(`/esl-devices/${id}/delete-impact`),
  deleteDevice: (id: string) => http.delete<{ deleted: boolean; id: string; impact?: Record<string, any> }>(`/esl-devices/${id}`),
  batchDeleteDevices: (deviceIds: string[]) => http.delete<{ deletedCount: number; impacts?: Record<string, any>[] }>('/esl-devices/batch', { data: { deviceIds } }),
  refreshDevice: (id: string) => http.post<{ ok: boolean }>(`/esl-devices/${id}/refresh`, { force: true }),
  silentWakeDevice: (id: string, payload?: { apId?: string; waitMs?: number }) => http.post<{ ok: boolean; conclusion?: string; labels?: Array<{ detail?: string }> }>(`/esl-devices/${id}/silent-wake`, payload ?? {}),
  adjustDevice: (id: string, options: Record<string, unknown>) => http.post<{ ok: boolean }>(`/esl-devices/${id}/adjust`, { options }),
  deviceTasks: (id: string, params?: Record<string, unknown>) => http.get<Paginated<PushTask>>(`/esl-devices/${id}/tasks`, { params }),
  aps: (params?: Record<string, unknown>) => http.get<Paginated<Ap>>('/aps', { params }),
  ap: (id: string) => http.get<Ap>(`/aps/${id}`),
  createAp: (payload: Partial<Ap>) => http.post<Ap>('/aps', payload),
  updateAp: (id: string, payload: Partial<Ap>) => http.put<Ap>(`/aps/${id}`, payload),
  updateApAutoImportScannedLabels: (id: string, enabled: boolean) => http.put<Ap>(`/aps/${id}/auto-import-scanned-labels`, { enabled }),
  searchApDevices: (id: string) => http.post<{ ok: boolean; devices?: EslDevice[] }>(`/aps/${id}/search-devices`, { timeoutSeconds: 10 }),
  syncApStatus: (id: string) => http.post<{ ok: boolean; status?: string }>(`/aps/${id}/sync-status`),
  configAp: (id: string, config: Record<string, unknown>) => http.post<Ap>(`/aps/${id}/config`, { config }),
  transferApOwner: (id: string, payload: { targetUserId: string }) => http.post<Ap & { transferredDeviceCount: number; targetUser: User }>(`/aps/${id}/transfer-owner`, payload),
  unbindApDevices: (id: string) => http.post<{ unboundDeviceCount: number }>(`/aps/${id}/unbind-devices`, {}),
  deleteAp: (id: string) => http.delete<{ ok: boolean }>(`/aps/${id}`),
  apHeartbeats: (id: string) => http.get<Array<{ id: string; createdAt: string; status: string; payloadJson?: Record<string, unknown> }>>(`/aps/${id}/heartbeats`),
  tasks: (params?: Record<string, unknown>) => http.get<Paginated<PushTask>>('/tasks', { params }),
  task: (id: string) => http.get<PushTask>(`/tasks/${id}`),
  retryTask: (id: string) => http.post<PushTask>(`/tasks/${id}/retry`),
  deleteTask: (id: string) => http.delete<{ deleted: boolean; id: string }>(`/tasks/${id}`),
  batchRefreshTasks: (payload: { productIds?: string[]; templateIds?: string[]; deviceIds?: string[]; reason?: string }) => http.post<{ ok: boolean }>('/tasks/batch-refresh', payload),
  users: (params?: Record<string, unknown>) => http.get<Paginated<User>>('/users', { params }),
  userDetail: (id: string) => http.get<UserDetail>(`/users/${id}`),
  userInvites: (params?: Record<string, unknown>) => http.get<Paginated<UserInvite>>('/users/invites', { params }),
  auditLogs: (params?: Record<string, unknown>) => http.get<Paginated<AuditLog>>('/users/audit-logs', { params }),
  createUserInvite: (payload: { username: string; displayName?: string; email?: string; role?: string; expiresInDays?: number; storeCode?: string }) => http.post<UserInvite>('/users/invites', payload),
  disableUser: (id: string) => http.post<User>(`/users/${id}/disable`, {}),
  enableUser: (id: string) => http.post<User>(`/users/${id}/enable`, {}),
  resetUserPassword: (id: string, payload: { password: string }) => http.post<User>(`/users/${id}/reset-password`, payload),
  revokeUserInvite: (id: string) => http.post<UserInvite>(`/users/invites/${id}/revoke`, {}),
  uploadImage: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return http.post<UploadImageResult>('/uploads/image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};
