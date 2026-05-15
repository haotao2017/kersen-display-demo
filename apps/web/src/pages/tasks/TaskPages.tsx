import { Alert, App, Button, Card, Descriptions, Divider, Drawer, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../../api';
import { useAppStore } from '../../app/store';
import { useI18n } from '../../i18n';
import { queryKeys } from '../../utils/constants';
import { buildTaskStatusLabels, buildTaskTypeLabels, getTaskProgressText, getTaskStatusLabel, getTaskSummary, getTaskUserText, normalizeTaskStatus } from '../../utils/taskText';

const formatDateTime = (value?: string | null) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-');
const DEFAULT_PAGE_SIZE = 50;

export const TaskListPage = () => {
  const { tx } = useI18n();
  const TASK_STATUS_LABELS = buildTaskStatusLabels(tx);
  const TASK_TYPE_LABELS = buildTaskTypeLabels(tx);
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [taskId, setTaskId] = useState<string | null>(null);
  const currentUser = useAppStore((state) => state.user);
  const isAdmin = currentUser?.role === 'ADMIN';
  const [filters, setFilters] = useState<{ ownerUserId?: string; keyword?: string }>({});
  const [pagination, setPagination] = useState({ current: 1, pageSize: DEFAULT_PAGE_SIZE });
  const updateFilters = (patch: Partial<typeof filters>) => {
    setPagination((current) => ({ ...current, current: 1 }));
    setFilters((current) => ({ ...current, ...patch }));
  };
  const { data: users } = useQuery({ queryKey: queryKeys.users, queryFn: () => api.users({ pageSize: 200 }), enabled: isAdmin });
  const userOptions = (users?.items ?? []).map((user) => ({ label: `${user.displayName || user.username} / ${user.username}`, value: user.id }));
  const { data, isPending } = useQuery({
    queryKey: [...queryKeys.tasks, filters, pagination],
    queryFn: () => api.tasks({ ...filters, page: pagination.current, pageSize: pagination.pageSize }),
    refetchInterval: 10_000,
    placeholderData: (previous) => previous,
  });
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
  const remove = useMutation({
    mutationFn: api.deleteTask,
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      if (taskId === id) setTaskId(null);
      message.success(tx('任务已删除', 'Task deleted'));
    },
  });

  const detailStatus = normalizeTaskStatus(detail?.status);
  const detailTaskType = detail?.taskType ? String(detail.taskType) : '';

  return (
    <>
      <Card title={tx('任务中心', 'Tasks')}>
        <Space wrap style={{ marginBottom: 16 }}>
          {isAdmin ? (
            <Select
              allowClear
              placeholder={tx('按用户筛选', 'Filter by user')}
              style={{ width: 240 }}
              options={userOptions}
              value={filters.ownerUserId}
              onChange={(ownerUserId) => updateFilters({ ownerUserId })}
            />
          ) : null}
          <Input.Search
            allowClear
            placeholder={tx('搜索任务/标签/基站/结果', 'Search task/label/station/result')}
            style={{ width: 280 }}
            onSearch={(keyword) => updateFilters({ keyword: keyword.trim() || undefined })}
          />
        </Space>
        <Table
          rowKey="id"
          loading={isPending}
          dataSource={data?.items ?? []}
          pagination={{
            current: data?.page ?? pagination.current,
            pageSize: data?.pageSize ?? pagination.pageSize,
            total: data?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [20, 50, 100, 200],
            showTotal: (total) => tx(`共 ${total} 条`, `${total} total`),
          }}
          onChange={(next) => setPagination({
            current: next.current ?? 1,
            pageSize: next.pageSize ?? DEFAULT_PAGE_SIZE,
          })}
          columns={[
            ...(isAdmin ? [{ title: tx('归属账号', 'Owner'), render: (_: unknown, row: any) => row.owner?.displayName || row.owner?.username || row.ownerUserId || '-' }] : []),
            { title: tx('任务 ID', 'Task ID'), dataIndex: 'id' },
            { title: tx('类型', 'Type'), render: (_, row: any) => TASK_TYPE_LABELS[String(row.taskType ?? '')] ?? row.taskType },
            { title: tx('数据源', 'Data Source'), render: (_, row: any) => row.product?.name ?? '-' },
            { title: tx('显示节点', 'Display Node'), render: (_, row: any) => row.eslDevice?.eslCode ?? '-' },
            { title: tx('AP 基站', 'AP Station'), render: (_, row: any) => row.ap?.name ?? '-' },
            { title: tx('状态', 'Status'), render: (_, row: any) => getTaskStatusLabel(row, tx) },
            { title: tx('触发时间', 'Triggered At'), render: (_, row: any) => formatDateTime(row.triggeredAt ?? row.createdAt) },
            { title: tx('重试次数', 'Retries'), dataIndex: 'retryCount' },
            { title: tx('结果', 'Result'), render: (_, row: any) => getTaskUserText(row, tx) },
            {
              title: tx('操作', 'Actions'),
              render: (_, row: any) => (
                <Space>
                  <Button onClick={() => setTaskId(row.id)}>{tx('查看', 'View')}</Button>
                  <Button
                    disabled={['queued', 'trigger_pending', 'rendering', 'sending', 'success'].includes(normalizeTaskStatus(row.status))}
                    onClick={() => retry.mutate(row.id)}
                    loading={retry.isPending && retry.variables === row.id}
                  >
                    {tx('重试', 'Retry')}
                  </Button>
                  <Button
                    danger
                    loading={remove.isPending && remove.variables === row.id}
                    onClick={() => {
                      Modal.confirm({
                        title: tx('删除任务？', 'Delete task?'),
                        content: tx('删除后仅移除任务记录，不会删除基站、价签或商品数据。', 'This only removes the task record. It will not delete stations, labels, or products.'),
                        okText: tx('删除', 'Delete'),
                        cancelText: tx('取消', 'Cancel'),
                        okButtonProps: { danger: true },
                        centered: true,
                        onOk: () => remove.mutateAsync(row.id),
                      });
                    }}
                  >
                    {tx('删除', 'Delete')}
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <Drawer open={Boolean(taskId)} onClose={() => setTaskId(null)} title={tx('任务详情', 'Task Details')} width={720}>
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
              <Descriptions.Item label={tx('处理说明', 'Result Note')}>{getTaskSummary(detail, tx)}</Descriptions.Item>
              <Descriptions.Item label={tx('设备确认情况', 'Device Confirmation')}>{getTaskProgressText(detail, tx)}</Descriptions.Item>
              <Descriptions.Item label={tx('上次设备刷新时间', 'Last Device Refresh')}>{formatDateTime(detail?.eslDevice?.lastRefreshAt)}</Descriptions.Item>
            </Descriptions>
          </Card>

          <Card size="small" title={tx('技术详情', 'Technical Details')} loading={isDetailPending}>
            <Descriptions column={1} size="small" labelStyle={{ width: 120 }}>
              <Descriptions.Item label={tx('原始说明', 'Raw Message')}>{detail?.resultMsg ?? '-'}</Descriptions.Item>
              <Descriptions.Item label={tx('下发方式', 'Transport')}>{detail?.delivery?.transport ?? '-'}</Descriptions.Item>
              <Descriptions.Item label={tx('命令编号', 'Command ID')}>{detail?.delivery?.commandId ?? '-'}</Descriptions.Item>
              <Descriptions.Item label={tx('追踪编号', 'Tracking ID')}>{detail?.delivery?.websocket?.trackingId ?? '-'}</Descriptions.Item>
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
                { title: tx('状态', 'Status'), render: (_, row: any) => getTaskStatusLabel({ ...detail, status: row.status, resultMsg: row.message }, tx) },
                { title: tx('说明', 'Message'), render: (_, row: any) => getTaskUserText({ ...detail, status: row.status, resultMsg: row.message }, tx) },
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
                          { title: tx('状态', 'Status'), render: (_, row: any) => getTaskStatusLabel(row, tx) },
                          { title: tx('结果', 'Result'), render: (_, row: any) => getTaskUserText(row, tx) },
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
