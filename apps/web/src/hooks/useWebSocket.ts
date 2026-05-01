import { App } from 'antd';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { EVENTS_URL, queryKeys } from '../utils/constants';
import { useAppStore } from '../app/store';

const NOTICEABLE_EVENT_TYPES = new Set(['ap.offline', 'task.failed']);
const AP_REFRESH_EVENT_TYPES = new Set(['ap.online', 'ap.offline', 'ap.updated']);
const TASK_REFRESH_EVENT_TYPES = new Set(['task.created', 'task.updated', 'task.success', 'task.failed']);
const DEVICE_REFRESH_EVENT_TYPES = new Set(['esl.bound', 'esl.unbound', 'esl.updated', 'esl.adjusted']);

function buildNotificationContent(payload: { type: string; data?: Record<string, unknown> }) {
  if (payload.type === 'ap.offline') {
    return {
      message: '基站离线',
      description: `${payload.data?.apCode ?? '未知基站'} 已离线`,
    };
  }

  if (payload.type === 'task.failed') {
    return {
      message: '任务失败',
      description: `${payload.data?.taskType ?? '未知任务'} 执行失败`,
    };
  }

  return {
    message: payload.type,
    description: JSON.stringify(payload.data ?? {}),
  };
}

export const useWebSocket = () => {
  const { notification } = App.useApp();
  const queryClient = useQueryClient();
  const setWsConnected = useAppStore((state) => state.setWsConnected);

  useEffect(() => {
    const source = new EventSource(EVENTS_URL);
    source.onopen = () => setWsConnected(true);
    source.onerror = () => setWsConnected(false);

    const handler = (event: MessageEvent) => {
      const payload = JSON.parse(event.data);
      if (NOTICEABLE_EVENT_TYPES.has(payload.type)) {
        const content = buildNotificationContent(payload);
        notification.warning({
          ...content,
          placement: 'bottomRight',
        });
      }
      if (TASK_REFRESH_EVENT_TYPES.has(payload.type)) {
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      }
      if (DEVICE_REFRESH_EVENT_TYPES.has(payload.type)) {
        queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      }
      if (AP_REFRESH_EVENT_TYPES.has(payload.type)) {
        queryClient.invalidateQueries({ queryKey: queryKeys.aps });
        queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === 'ap-summary' });
      }
      if (TASK_REFRESH_EVENT_TYPES.has(payload.type) || DEVICE_REFRESH_EVENT_TYPES.has(payload.type) || AP_REFRESH_EVENT_TYPES.has(payload.type)) {
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      }
    };

    ['ap.online', 'ap.offline', 'ap.updated', 'esl.bound', 'esl.unbound', 'esl.updated', 'esl.adjusted', 'task.created', 'task.updated', 'task.success', 'task.failed'].forEach(
      (type) => source.addEventListener(type, handler as EventListener),
    );

    return () => source.close();
  }, [queryClient, setWsConnected]);
};
