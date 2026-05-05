import { App, Button, Card, Descriptions, Drawer, Form, Input, InputNumber, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { useAppStore } from '../../app/store';
import { PageHeaderCard } from '../../components/common/PageHeaderCard';
import { useI18n } from '../../i18n';
import { queryKeys } from '../../utils/constants';

export const ApListPage = () => {
  const { tx } = useI18n();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const { data, isPending } = useQuery({ queryKey: queryKeys.aps, queryFn: () => api.aps({}), refetchInterval: 10_000 });
  const create = useMutation({
    mutationFn: api.createAp,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.aps });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === 'ap' });
      setOpen(false);
      form.resetFields();
      message.success(tx('基站已保存', 'Station saved'));
    },
    onError: (error: any) => message.error(error?.response?.data?.message ?? tx('保存基站失败', 'Failed to save station')),
  });

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <PageHeaderCard
        title={tx('AP 基站', 'AP Stations')}
        extra={
          <Button type="primary" onClick={() => setOpen(true)}>
            {tx('新增基站', 'New Station')}
          </Button>
        }
      >
        {tx('用于登记 eStation / AP 基站信息。当前仅监听已登记基站的主题，自动发现的价签会单独展示，不再直接算作正式绑定设备。', 'Register eStation / AP stations here. Only registered station topics are subscribed, and auto-discovered labels are shown separately instead of being counted as formally bound devices.')}
      </PageHeaderCard>
      <Card>
        <Table
          rowKey="id"
          loading={isPending}
          dataSource={data?.items ?? []}
          columns={[
            { title: tx('AP 编码', 'AP Code'), dataIndex: 'apCode' },
            { title: tx('名称', 'Name'), dataIndex: 'name' },
            {
              title: tx('状态', 'Status'),
              render: (_, row: any) => (
                <Tag color={row.online ? 'green' : 'default'}>
                  {row.online ? tx('在线', 'Online') : tx('离线', 'Offline')}
                </Tag>
              ),
            },
            { title: tx('已绑定显示节点数', 'Bound Display Nodes'), dataIndex: 'deviceCount' },
            { title: tx('自动发现显示节点数', 'Discovered Display Nodes'), dataIndex: 'discoveredDeviceCount' },
            {
              title: tx('操作', 'Actions'),
              render: (_, row: any) => (
                <Space>
                  <Button onClick={() => navigate(`/aps/${row.id}`)}>{tx('查看', 'View')}</Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <Drawer
        title={tx('新增基站', 'New Station')}
        open={open}
        width={420}
        onClose={() => setOpen(false)}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ config: { heartbeat: 30, channel: 37, power: 80 } }}
          onFinish={(values) =>
            create.mutate({
              apCode: values.apCode,
              name: values.name,
              ip: values.ip,
              mac: values.mac,
              firmwareVersion: values.firmwareVersion,
              location: values.location,
              config: {
                heartbeat: values.heartbeat,
                channel: values.channel,
                power: values.power,
              },
            })
          }
        >
          <Form.Item
            name="apCode"
            label={tx('AP 编码', 'AP Code')}
            rules={[
              { required: true, message: tx('请输入 4 位基站编码', 'Enter a 4-character station code') },
              { pattern: /^[0-9A-Za-z]{4}$/, message: tx('AP 编码必须是 4 位字母或数字', 'AP code must be 4 letters or digits') },
            ]}
          >
            <Input placeholder={tx('例如 0019', 'e.g. 0019')} />
          </Form.Item>
          <Form.Item name="name" label={tx('基站名称', 'Station Name')} rules={[{ required: true, message: tx('请输入基站名称', 'Enter station name') }]}>
            <Input placeholder={tx('例如 一楼生鲜区基站', 'e.g. Fresh Area Station')} />
          </Form.Item>
          <Form.Item name="ip" label={tx('IP 地址', 'IP Address')}>
            <Input placeholder={tx('例如 192.168.1.10', 'e.g. 192.168.1.10')} />
          </Form.Item>
          <Form.Item name="mac" label={tx('MAC 地址', 'MAC Address')}>
            <Input placeholder={tx('例如 AA:BB:CC:DD:EE:FF', 'e.g. AA:BB:CC:DD:EE:FF')} />
          </Form.Item>
          <Form.Item name="firmwareVersion" label={tx('固件版本', 'Firmware Version')}>
            <Input placeholder={tx('例如 1.0.0', 'e.g. 1.0.0')} />
          </Form.Item>
          <Form.Item name="location" label={tx('安装位置', 'Location')}>
            <Input placeholder={tx('例如 一楼生鲜区', 'e.g. Fresh Area')} />
          </Form.Item>
          <Form.Item name="heartbeat" label={tx('心跳间隔（秒）', 'Heartbeat Interval (s)')}>
            <InputNumber min={15} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="channel" label={tx('信道', 'Channel')}>
            <InputNumber min={0} max={255} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="power" label={tx('发射功率', 'Transmit Power')}>
            <InputNumber min={0} max={100} style={{ width: '100%' }} />
          </Form.Item>
          <Space>
            <Button onClick={() => setOpen(false)}>{tx('取消', 'Cancel')}</Button>
            <Button type="primary" htmlType="submit" loading={create.isPending}>
              {tx('保存基站', 'Save Station')}
            </Button>
          </Space>
        </Form>
      </Drawer>
    </Space>
  );
};

export const ApDetailPage = () => {
  const { tx } = useI18n();
  const { message } = App.useApp();
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const currentUser = useAppStore((state) => state.user);
  const isAdmin = currentUser?.role === 'ADMIN';
  const [editForm] = Form.useForm();
  const [transferForm] = Form.useForm();
  const [editOpen, setEditOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const { data: liveData, isPending: isSummaryPending } = useQuery({
    queryKey: queryKeys.apSummary(id),
    queryFn: () => api.ap(id),
    enabled: Boolean(id),
    refetchInterval: 10_000,
  });
  const { data: snapshotData, refetch, isFetching, isPending: isSnapshotPending } = useQuery({
    queryKey: queryKeys.apSnapshot(id),
    queryFn: () => api.ap(id),
    enabled: Boolean(id),
    refetchInterval: 10_000,
  });
  const { data: users } = useQuery({ queryKey: queryKeys.users, queryFn: api.users, enabled: isAdmin });
  const sync = useMutation({
    mutationFn: api.syncApStatus,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.aps });
      await queryClient.invalidateQueries({ queryKey: queryKeys.apSummary(id) });
      await refetch();
      message.success(tx('基站状态已同步', 'Station status synced'));
    },
    onError: (error: any) => message.error(error?.response?.data?.message ?? tx('同步失败', 'Sync failed')),
  });
  const updateAp = useMutation({
    mutationFn: (values: any) => api.updateAp(id, values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.aps });
      await queryClient.invalidateQueries({ queryKey: queryKeys.apSummary(id) });
      await refetch();
      setEditOpen(false);
      editForm.resetFields();
      message.success(tx('基站已更新', 'Station updated'));
    },
    onError: (error: any) => message.error(error?.response?.data?.message ?? tx('更新基站失败', 'Failed to update station')),
  });
  const unbindDevices = useMutation({
    mutationFn: api.unbindApDevices,
    onSuccess: async (result: any) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.aps });
      await queryClient.invalidateQueries({ queryKey: queryKeys.apSummary(id) });
      await refetch();
      message.success(`${tx('已解绑', 'Unbound')} ${result?.unboundDeviceCount ?? 0} ${tx('台设备', 'devices')}`);
    },
    onError: (error: any) => message.error(error?.response?.data?.message ?? error?.message ?? tx('解绑设备失败', 'Failed to unbind devices')),
  });
  const transferOwner = useMutation({
    mutationFn: ({ targetUserId }: { targetUserId: string }) => api.transferApOwner(id, { targetUserId }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.aps });
      await queryClient.invalidateQueries({ queryKey: queryKeys.apSummary(id) });
      await refetch();
      setTransferOpen(false);
      transferForm.resetFields();
      message.success(`${tx('基站已转移给', 'Station transferred to')} ${result.targetUser.displayName || result.targetUser.username}`);
    },
    onError: (error: any) => message.error(error?.response?.data?.message ?? error?.message ?? tx('转移归属失败', 'Failed to transfer ownership')),
  });
  const remove = useMutation({
    mutationFn: api.deleteAp,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.aps });
      message.success(tx('基站已删除', 'Station deleted'));
      window.history.back();
    },
    onError: (error: any) => message.error(error?.response?.data?.message ?? error?.message ?? tx('删除基站失败', 'Failed to delete station')),
  });
  const summary = liveData ?? snapshotData;
  const detail = snapshotData ?? liveData;
  const isPagePending = isSummaryPending && isSnapshotPending;
  const boundDeviceCount = summary?.boundDevices?.length ?? summary?.devices?.length ?? summary?.deviceCount ?? 0;
  const latestHeartbeatPayload = detail?.recentHeartbeats?.[0]?.payloadJson ?? {};
  const latestConfig = (detail?.config ?? {}) as Record<string, string | number | boolean | null | undefined>;
  const summaryConfig = (summary?.config ?? {}) as Record<string, string | number | boolean | null | undefined>;
  const configItems = [
    { key: 'heartbeat', label: tx('配置心跳', 'Configured Heartbeat'), children: latestConfig.heartbeat ? `${latestConfig.heartbeat}s` : undefined },
    { key: 'channel', label: tx('信道', 'Channel'), children: latestConfig.channel },
    { key: 'power', label: tx('发射功率', 'Transmit Power'), children: latestConfig.power },
    { key: 'modVersion', label: tx('模组版本', 'Module Version'), children: latestConfig.modVersion },
    { key: 'configVersion', label: tx('配置版本', 'Config Version'), children: latestConfig.configVersion },
    { key: 'localIP', label: tx('固定 IP', 'Fixed IP'), children: latestConfig.localIP },
    { key: 'gateway', label: tx('网关', 'Gateway'), children: latestConfig.gateway },
  ].filter((item) => item.children !== undefined && item.children !== null && item.children !== '');

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <PageHeaderCard
        title={`${tx('AP 详情', 'AP Details')} · ${summary?.name ?? ''}`}
        extra={
          <Space>
            <Button loading={sync.isPending} onClick={() => sync.mutate(id)}>
              {tx('同步状态', 'Sync Status')}
            </Button>
            <Button
              onClick={() => {
                setEditOpen(true);
                editForm.setFieldsValue({
                  apCode: summary?.apCode,
                  name: summary?.name,
                  ip: summary?.ip,
                  mac: summary?.mac,
                  firmwareVersion: summary?.firmwareVersion,
                  location: summary?.location,
                  heartbeat: latestConfig.heartbeat,
                  channel: latestConfig.channel,
                  power: latestConfig.power,
                });
              }}
            >
              {tx('编辑基站', 'Edit Station')}
            </Button>
            <Popconfirm title={tx('解绑该基站下的所有设备？', 'Unbind all devices under this station?')} onConfirm={() => unbindDevices.mutate(id)}>
              <Button disabled={!boundDeviceCount} loading={unbindDevices.isPending}>
                {tx('解绑设备', 'Unbind Devices')}
              </Button>
            </Popconfirm>
            {isAdmin ? (
              <Button
                onClick={() => {
                  setTransferOpen(true);
                  transferForm.setFieldsValue({ targetUserId: summary?.ownerUserId ?? undefined });
                }}
              >
                {tx('转移归属', 'Transfer Ownership')}
              </Button>
            ) : null}
            <Button loading={isFetching} onClick={() => refetch()}>
              {tx('刷新详情', 'Refresh Details')}
            </Button>
          </Space>
        }
      >
        {tx('当前页展示基站概况、最近心跳、等待队列、最近任务，以及“已绑定商品设备”和“自动发现设备”的分开展示。', 'This page shows station summary, recent heartbeats, queue status, recent tasks, and separate sections for bound product devices and auto-discovered devices.')}
      </PageHeaderCard>
      <Card title={tx('基站概况', 'Station Summary')} loading={isPagePending}>
        <Descriptions
          column={2}
          items={[
            { key: 'apCode', label: tx('AP 编码', 'AP Code'), children: summary?.apCode },
            {
              key: 'status',
              label: tx('状态', 'Status'),
              children: <Tag color={summary?.online ? 'green' : 'default'}>{summary?.online ? tx('在线', 'Online') : tx('离线', 'Offline')}</Tag>,
            },
            { key: 'name', label: tx('名称', 'Name'), children: summary?.name },
            { key: 'location', label: tx('位置', 'Location'), children: summary?.location ?? '-' },
            { key: 'ip', label: 'IP', children: summary?.ip ?? '-' },
            { key: 'mac', label: 'MAC', children: summary?.mac ?? '-' },
            { key: 'firmwareVersion', label: tx('固件版本', 'Firmware'), children: summary?.firmwareVersion ?? '-' },
            { key: 'deviceCount', label: tx('已绑定商品设备', 'Bound Product Devices'), children: summary?.boundDevices?.length ?? summary?.devices?.length ?? 0 },
            { key: 'discoveredCount', label: tx('自动发现设备', 'Discovered Devices'), children: summary?.discoveredDevices?.length ?? summary?.discoveredDeviceCount ?? 0 },
            { key: 'lastOnlineAt', label: tx('最后在线', 'Last Online'), children: summary?.lastOnlineAt ?? '-' },
            { key: 'lastHeartbeatAt', label: tx('最后心跳', 'Last Heartbeat'), children: summary?.lastHeartbeatAt ?? '-' },
            { key: 'heartbeatIntervalSeconds', label: tx('心跳周期', 'Heartbeat Interval'), children: summary?.heartbeatIntervalSeconds ? `${summary.heartbeatIntervalSeconds}s` : '-' },
            {
              key: 'waitCount',
              label: tx('等待队列', 'Waiting Queue'),
              children: summaryConfig.waitCount ?? summaryConfig.lastResultTagCount ?? latestConfig.waitCount ?? 0,
            },
            {
              key: 'sendCount',
              label: tx('发送中', 'Sending'),
              children: summaryConfig.sendCount ?? latestConfig.sendCount ?? 0,
            },
            {
              key: 'messageName',
              label: tx('最近消息码', 'Recent Message'),
              children: summaryConfig.lastHeartbeatMessageName ?? summaryConfig.lastMessageName ?? summaryConfig.lastResultMessageName ?? '-',
            },
          ]}
        />
      </Card>
      {configItems.length ? (
        <Card title={tx('当前配置', 'Current Config')} loading={isPagePending}>
          <Descriptions column={2} items={configItems} />
        </Card>
      ) : null}
      <Card title={tx('最近心跳', 'Recent Heartbeats')}>
        <Table
          rowKey="id"
          loading={isPagePending}
          dataSource={detail?.recentHeartbeats ?? []}
          pagination={false}
          columns={[
            { title: tx('时间', 'Time'), dataIndex: 'createdAt' },
            { title: tx('状态', 'Status'), dataIndex: 'status' },
            {
              title: tx('消息码', 'Message'),
              render: (_, row: any) => row.payloadJson?.messageName ?? row.payloadJson?.codeName ?? '-',
            },
            {
              title: tx('等待队列', 'Waiting Queue'),
              render: (_, row: any) => row.payloadJson?.waitCount ?? '-',
            },
            {
              title: tx('发送中', 'Sending'),
              render: (_, row: any) => row.payloadJson?.sendCount ?? '-',
            },
            {
              title: tx('价签数', 'Labels'),
              render: (_, row: any) => Array.isArray(row.payloadJson?.tags) ? row.payloadJson.tags.length : '-',
            },
          ]}
        />
      </Card>
      <Card title={tx('最近任务', 'Recent Tasks')}>
        <Table
          rowKey="id"
          loading={isPagePending}
          dataSource={detail?.recentTasks ?? []}
          pagination={false}
          columns={[
            { title: tx('任务类型', 'Task Type'), dataIndex: 'taskType' },
            { title: tx('状态', 'Status'), dataIndex: 'status' },
            { title: tx('结果', 'Result'), dataIndex: 'resultMsg' },
            { title: tx('更新时间', 'Updated At'), dataIndex: 'updatedAt' },
          ]}
        />
      </Card>
      <Card title={tx('基站接入 / 下发日志', 'Station Access / Downlink Logs')}>
        <Table
          rowKey="id"
          loading={isPagePending}
          dataSource={detail?.recentLogs ?? []}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: tx('时间', 'Time'), dataIndex: 'time' },
            { title: tx('类型', 'Type'), dataIndex: 'method' },
            { title: tx('路径', 'Path'), dataIndex: 'path' },
            { title: tx('状态码', 'Status'), dataIndex: 'statusCode' },
            {
              title: tx('内容', 'Payload'),
              render: (_, row: any) => (
                <Typography.Text style={{ display: 'block', maxWidth: 720, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.5 }}>
                  {JSON.stringify(row.body ?? row.query ?? {})}
                </Typography.Text>
              ),
            },
          ]}
        />
      </Card>
      <Card title={tx('已绑定商品设备', 'Bound Product Devices')}>
        <Table
          rowKey="id"
          loading={isPagePending}
          dataSource={detail?.boundDevices ?? detail?.devices ?? []}
          pagination={false}
          columns={[
            { title: tx('设备码', 'Device Code'), dataIndex: 'eslCode' },
            { title: tx('状态', 'Status'), dataIndex: 'status' },
            { title: tx('电量', 'Battery'), dataIndex: 'battery' },
            { title: tx('信号', 'Signal'), dataIndex: 'signal' },
            { title: tx('最后刷新', 'Last Refresh'), dataIndex: 'lastRefreshAt' },
          ]}
        />
      </Card>
      <Card title={tx('自动发现设备', 'Discovered Devices')}>
        <Table
          rowKey="eslCode"
          loading={isPagePending}
          dataSource={detail?.discoveredDevices ?? []}
          pagination={false}
          columns={[
            { title: tx('设备码', 'Device Code'), dataIndex: 'eslCode' },
            { title: tx('状态', 'Status'), dataIndex: 'status' },
            { title: tx('电量', 'Battery'), dataIndex: 'battery' },
            { title: tx('信号', 'Signal'), dataIndex: 'signal' },
            { title: tx('来源', 'Source'), dataIndex: 'source' },
            { title: tx('最近发现时间', 'Last Seen'), dataIndex: 'lastSeenAt' },
          ]}
        />
      </Card>
      <Card>
        <Space style={{ width: '100%' }}>
          <Popconfirm
            title={tx('确认删除这个基站？', 'Delete this station?')}
            description={tx('若仍有关联设备，请先解绑。', 'If devices are still linked, unbind them first.')}
            onConfirm={() => remove.mutate(id)}
          >
            <Button danger loading={remove.isPending}>
              {tx('删除基站', 'Delete Station')}
            </Button>
          </Popconfirm>
        </Space>
      </Card>
      <Drawer
        title={tx('编辑基站', 'Edit Station')}
        open={editOpen}
        width={420}
        onClose={() => {
          setEditOpen(false);
          editForm.resetFields();
        }}
        destroyOnClose
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={(values) =>
            updateAp.mutate({
              apCode: values.apCode,
              name: values.name,
              ip: values.ip,
              mac: values.mac,
              firmwareVersion: values.firmwareVersion,
              location: values.location,
              config: {
                heartbeat: values.heartbeat,
                channel: values.channel,
                power: values.power,
              },
            })
          }
        >
          <Form.Item
            name="apCode"
            label={tx('AP 编码', 'AP Code')}
            rules={[
              { required: true, message: tx('请输入 4 位基站编码', 'Enter a 4-character station code') },
              { pattern: /^[0-9A-Za-z]{4}$/, message: tx('AP 编码必须是 4 位字母或数字', 'AP code must be 4 letters or digits') },
            ]}
          >
            <Input placeholder={tx('例如 0019', 'e.g. 0019')} />
          </Form.Item>
          <Form.Item name="name" label={tx('基站名称', 'Station Name')} rules={[{ required: true, message: tx('请输入基站名称', 'Enter station name') }]}>
            <Input placeholder={tx('例如 一楼生鲜区基站', 'e.g. Fresh Area Station')} />
          </Form.Item>
          <Form.Item name="ip" label={tx('IP 地址', 'IP Address')}>
            <Input placeholder={tx('例如 192.168.1.10', 'e.g. 192.168.1.10')} />
          </Form.Item>
          <Form.Item name="mac" label={tx('MAC 地址', 'MAC Address')}>
            <Input placeholder={tx('例如 AA:BB:CC:DD:EE:FF', 'e.g. AA:BB:CC:DD:EE:FF')} />
          </Form.Item>
          <Form.Item name="firmwareVersion" label={tx('固件版本', 'Firmware Version')}>
            <Input placeholder={tx('例如 1.0.0', 'e.g. 1.0.0')} />
          </Form.Item>
          <Form.Item name="location" label={tx('安装位置', 'Location')}>
            <Input placeholder={tx('例如 一楼生鲜区', 'e.g. Fresh Area')} />
          </Form.Item>
          <Form.Item name="heartbeat" label={tx('心跳间隔（秒）', 'Heartbeat Interval (s)')}>
            <InputNumber min={15} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="channel" label={tx('信道', 'Channel')}>
            <InputNumber min={0} max={255} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="power" label={tx('发射功率', 'Transmit Power')}>
            <InputNumber min={0} max={100} style={{ width: '100%' }} />
          </Form.Item>
          <Space>
            <Button
              onClick={() => {
                setEditOpen(false);
                editForm.resetFields();
              }}
            >
              {tx('取消', 'Cancel')}
            </Button>
            <Button type="primary" htmlType="submit" loading={updateAp.isPending}>
              {tx('保存基站', 'Save Station')}
            </Button>
          </Space>
        </Form>
      </Drawer>
      <Drawer
        title={summary ? `${tx('转移归属', 'Transfer Ownership')} · ${summary.apCode}` : tx('转移归属', 'Transfer Ownership')}
        open={transferOpen}
        width={420}
        onClose={() => {
          setTransferOpen(false);
          transferForm.resetFields();
        }}
        destroyOnClose
      >
        <Form
          form={transferForm}
          layout="vertical"
          onFinish={(values) => transferOwner.mutate({ targetUserId: values.targetUserId })}
        >
          <Form.Item label={tx('当前 AP', 'Current AP')}>
            <Input value={summary ? `${summary.apCode} / ${summary.name}` : ''} disabled />
          </Form.Item>
          <Form.Item name="targetUserId" label={tx('目标账号', 'Target User')} rules={[{ required: true, message: tx('请选择目标账号', 'Select a target user') }]}>
            <Select
              placeholder={tx('请选择目标账号', 'Select a target user')}
              options={(users ?? []).map((item) => ({
                label: `${item.displayName || item.username} (${item.role})`,
                value: item.id,
              }))}
            />
          </Form.Item>
          <Space>
            <Button
              onClick={() => {
                setTransferOpen(false);
                transferForm.resetFields();
              }}
            >
              {tx('取消', 'Cancel')}
            </Button>
            <Button type="primary" htmlType="submit" loading={transferOwner.isPending}>
              {tx('确认转移', 'Confirm Transfer')}
            </Button>
          </Space>
        </Form>
      </Drawer>
    </Space>
  );
};
