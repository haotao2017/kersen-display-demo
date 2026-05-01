import { Alert, App, Button, Card, Descriptions, Divider, Drawer, Space, Table, Tag, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../../api';
import { useI18n } from '../../i18n';
import { queryKeys } from '../../utils/constants';

const buildTaskStatusLabels = (tx: (zh: string, en: string) => string): Record<string, string> => ({
  queued: tx('排队中', 'Queued'),
  rendering: tx('处理中', 'Rendering'),
  ready: tx('已准备好', 'Ready'),
  sending: tx('发送中', 'Sending'),
  sent: tx('已下发', 'Sent'),
  success: tx('成功', 'Success'),
  failed: tx('失败', 'Failed'),
  timeout: tx('超时', 'Timeout'),
  cancelled: tx('已取消', 'Cancelled'),
});

const buildTaskTypeLabels = (tx: (zh: string, en: string) => string): Record<string, string> => ({
  bind: tx('绑定设备', 'Bind Device'),
  unbind: tx('解绑设备', 'Unbind Device'),
  refresh: tx('刷新屏幕', 'Refresh Screen'),
  adjust: tx('调整设备', 'Adjust Device'),
  search_devices: tx('搜索设备', 'Search Devices'),
  sync_status: tx('同步状态', 'Sync Status'),
  config_push: tx('下发配置', 'Push Config'),
});

const formatDateTime = (value?: string | null) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-');
const normalizeTaskStatus = (value: unknown) => String(value ?? '').trim().toLowerCase();

const getTaskSummary = (detail: any, tx: (zh: string, en: string) => string) => {
  const status = normalizeTaskStatus(detail?.status);
  if (!detail) return tx('正在加载任务详情...', 'Loading task details...');
  if (detail.resultMsg) return detail.resultMsg;
  if (status === 'queued') return tx('任务已经提交，正在排队处理中。', 'The task has been submitted and is waiting in queue.');
  if (status === 'rendering') return tx('系统正在生成要显示的内容。', 'The system is generating content for display.');
  if (status === 'sending') return tx('内容已经发出，正在等待基站返回结果。', 'The content has been sent and is waiting for the station result.');
  if (status === 'success') return tx('任务已经完成。', 'The task has completed.');
  if (status === 'failed') return tx('任务执行失败，请查看原因后重试。', 'The task failed. Please review the reason and try again.');
  if (status === 'timeout') return tx('等待时间较长，暂时没有收到最终结果。', 'No final result has been received yet.');
  return tx('任务状态已更新。', 'Task status updated.');
};

const getTaskProgressText = (detail: any, tx: (zh: string, en: string) => string) => {
  const analysis = detail?.renderResult?.analysis;
  if (!analysis) return '-';
  if (analysis.allRequestedTagsPresent && analysis.allRequestedTokensMatched) return tx('设备已确认完成刷新', 'The device confirmed the refresh.');
  if (analysis.allRequestedTagsPresent) return tx('已经找到设备，正在等待最终确认', 'The device was found and is waiting for final confirmation.');
  return tx('基站已响应，正在继续确认设备状态', 'The station responded and device confirmation is still in progress.');
};

export const TaskListPage = () => {
  const { tx } = useI18n();
  const TASK_STATUS_LABELS = buildTaskStatusLabels(tx);
  const TASK_TYPE_LABELS = buildTaskTypeLabels(tx);
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [taskId, setTaskId] = useState<string | null>(null);
  const { data, isPending } = useQuery({ queryKey: queryKeys.tasks, queryFn: () => api.tasks({}), refetchInterval: 3000 });
  const { data: detail, isPending: isDetailPending } = useQuery({
    queryKey: taskId ? queryKeys.task(taskId) : ['task-empty'],
    queryFn: () => api.task(taskId!),
    enabled: Boolean(taskId),
    refetchInterval: (query) => {
      const status = normalizeTaskStatus((query.state.data as any)?.status);
      return taskId && !['success', 'failed', 'timeout', 'cancelled'].includes(status) ? 2000 : false;
    },
  });
  const retry = useMutation({
    mutationFn: api.retryTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      message.success(tx('已提交重试任务', 'Retry task submitted'));
    },
  });

  const detailStatus = normalizeTaskStatus(detail?.status);
  const detailTaskType = detail?.taskType ? String(detail.taskType) : '';

  return (
    <>
      <Card title={tx('任务中心', 'Tasks')}>
        <Table
          rowKey="id"
          loading={isPending}
          dataSource={data?.items ?? []}
          columns={[
            { title: tx('任务 ID', 'Task ID'), dataIndex: 'id' },
            { title: tx('类型', 'Type'), render: (_, row: any) => TASK_TYPE_LABELS[String(row.taskType ?? '')] ?? row.taskType },
            { title: tx('数据源', 'Data Source'), render: (_, row: any) => row.product?.name ?? '-' },
            { title: tx('显示节点', 'Display Node'), render: (_, row: any) => row.eslDevice?.eslCode ?? '-' },
            { title: tx('AP 基站', 'AP Station'), render: (_, row: any) => row.ap?.name ?? '-' },
            { title: tx('状态', 'Status'), render: (_, row: any) => TASK_STATUS_LABELS[normalizeTaskStatus(row.status)] ?? row.status },
            { title: tx('触发时间', 'Triggered At'), render: (_, row: any) => formatDateTime(row.triggeredAt ?? row.createdAt) },
            { title: tx('重试次数', 'Retries'), dataIndex: 'retryCount' },
            { title: tx('结果', 'Result'), dataIndex: 'resultMsg' },
            {
              title: tx('操作', 'Actions'),
              render: (_, row: any) => (
                <Space>
                  <Button onClick={() => setTaskId(row.id)}>{tx('查看', 'View')}</Button>
                  <Button
                    disabled={['queued', 'rendering', 'sending', 'success'].includes(normalizeTaskStatus(row.status))}
                    onClick={() => retry.mutate(row.id)}
                    loading={retry.isPending && retry.variables === row.id}
                  >
                    {tx('重试', 'Retry')}
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <Drawer open={Boolean(taskId)} onClose={() => setTaskId(null)} title={tx('任务详情', 'Task Details')} width={640}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            type={detailStatus === 'success' ? 'success' : detailStatus === 'failed' ? 'error' : detailStatus === 'timeout' ? 'warning' : 'info'}
            message={getTaskSummary(detail, tx)}
            showIcon
          />

          <Card size="small" title={tx('任务概况', 'Overview')} loading={isDetailPending}>
            <Descriptions column={1} size="small" labelStyle={{ width: 110 }}>
              <Descriptions.Item label={tx('任务类型', 'Task Type')}>{TASK_TYPE_LABELS[detailTaskType] ?? detailTaskType ?? '-'}</Descriptions.Item>
              <Descriptions.Item label={tx('当前状态', 'Current Status')}>
                <Tag color={detailStatus === 'success' ? 'green' : detailStatus === 'failed' ? 'red' : detailStatus === 'timeout' ? 'orange' : 'blue'}>
                  {TASK_STATUS_LABELS[detailStatus] ?? detailStatus ?? '-'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label={tx('创建时间', 'Created At')}>{formatDateTime(detail?.createdAt)}</Descriptions.Item>
              <Descriptions.Item label={tx('触发时间', 'Triggered At')}>{formatDateTime(detail?.triggeredAt ?? detail?.createdAt)}</Descriptions.Item>
              <Descriptions.Item label={tx('更新时间', 'Updated At')}>{formatDateTime(detail?.updatedAt)}</Descriptions.Item>
              <Descriptions.Item label={tx('重试次数', 'Retries')}>{detail?.retryCount ?? 0}</Descriptions.Item>
            </Descriptions>
          </Card>

          <Card size="small" title={tx('关联信息', 'Related Records')} loading={isDetailPending}>
            <Descriptions column={1} size="small" labelStyle={{ width: 110 }}>
              <Descriptions.Item label={tx('数据源', 'Data Source')}>{detail?.product?.name ?? '-'}</Descriptions.Item>
              <Descriptions.Item label={tx('显示节点码', 'Display Node Code')}>{detail?.eslDevice?.eslCode ?? '-'}</Descriptions.Item>
              <Descriptions.Item label={tx('AP 基站', 'AP Station')}>{detail?.ap?.name ?? '-'}</Descriptions.Item>
              <Descriptions.Item label={tx('模板', 'Template')}>{detail?.template?.name ?? '-'}</Descriptions.Item>
            </Descriptions>
          </Card>

          <Card size="small" title={tx('当前进度', 'Progress')} loading={isDetailPending}>
            <Descriptions column={1} size="small" labelStyle={{ width: 140 }}>
              <Descriptions.Item label={tx('处理说明', 'Result Note')}>{detail?.resultMsg ?? '-'}</Descriptions.Item>
              <Descriptions.Item label={tx('设备确认情况', 'Device Confirmation')}>{getTaskProgressText(detail, tx)}</Descriptions.Item>
              <Descriptions.Item label={tx('上次设备刷新时间', 'Last Device Refresh')}>{formatDateTime(detail?.eslDevice?.lastRefreshAt)}</Descriptions.Item>
            </Descriptions>
          </Card>

          <Card size="small" title={tx('基站返回记录', 'Station Responses')} loading={isDetailPending}>
            <Table
              size="small"
              rowKey={(row: any) => row.id ?? row.time}
              pagination={false}
              dataSource={detail?.events ?? []}
              columns={[
                { title: tx('时间', 'Time'), dataIndex: 'time', render: (value) => formatDateTime(value) },
                { title: tx('状态', 'Status'), dataIndex: 'status' },
                { title: tx('说明', 'Message'), dataIndex: 'message' },
                {
                  title: tx('回包', 'Reply'),
                  render: (_, row: any) => row.trace?.reply ? (
                    <Typography.Text style={{ fontSize: 12 }} ellipsis={{ tooltip: JSON.stringify(row.trace.reply) }}>
                      {JSON.stringify(row.trace.reply)}
                    </Typography.Text>
                  ) : row.trace?.error ?? '-',
                },
              ]}
            />
          </Card>

          {(detail?.renderResult?.previewImageUrl || detail?.retryHistory?.length) ? (
            <Card size="small" title={tx('补充信息', 'More Details')} loading={isDetailPending}>
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {detail?.renderResult?.previewImageUrl ? (
                  <div>
                    <Typography.Text strong>{tx('本次生成的预览图', 'Generated Preview')}</Typography.Text>
                    <div style={{ marginTop: 8 }}>
                      <img
                        src={String(detail.renderResult.previewImageUrl)}
                        alt={tx('任务预览', 'Task Preview')}
                        style={{ width: '100%', borderRadius: 8, border: '1px solid #f0f0f0', background: '#fff' }}
                      />
                    </div>
                  </div>
                ) : null}
                {detail?.retryHistory?.length ? (
                  <>
                    <Divider style={{ margin: '4px 0' }} />
                    <div>
                      <Typography.Text strong>{tx('历史重试记录', 'Retry History')}</Typography.Text>
                      <Table
                        style={{ marginTop: 8 }}
                        size="small"
                        pagination={false}
                        rowKey="id"
                        dataSource={detail.retryHistory}
                        columns={[
                          { title: tx('时间', 'Time'), render: (_, row: any) => formatDateTime(row.createdAt) },
                          { title: tx('触发时间', 'Triggered At'), render: (_, row: any) => formatDateTime(row.triggeredAt ?? row.createdAt) },
                          { title: tx('状态', 'Status'), render: (_, row: any) => TASK_STATUS_LABELS[normalizeTaskStatus(row.status)] ?? row.status },
                          { title: tx('结果', 'Result'), dataIndex: 'resultMsg' },
                        ]}
                      />
                    </div>
                  </>
                ) : null}
              </Space>
            </Card>
          ) : null}
        </Space>
      </Drawer>
    </>
  );
};
