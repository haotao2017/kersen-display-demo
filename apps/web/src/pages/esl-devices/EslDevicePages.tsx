import { App, Button, Card, Descriptions, Form, Input, Modal, Select, Space, Table, Tag } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api';
import { useI18n } from '../../i18n';
import { queryKeys } from '../../utils/constants';

export const EslDeviceListPage = () => {
  const { tx } = useI18n();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [bindTarget, setBindTarget] = useState<any | null>(null);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [bindForm] = Form.useForm();
  const [filters, setFilters] = useState<{ storeCode?: string; apId?: string; keyword?: string }>({});
  const { data, isPending } = useQuery({ queryKey: [...queryKeys.devices, filters], queryFn: () => api.devices(filters), refetchInterval: 10_000 });
  const { data: products } = useQuery({ queryKey: queryKeys.products, queryFn: () => api.products({}) });
  const { data: templates } = useQuery({ queryKey: queryKeys.templates, queryFn: () => api.templates({}) });
  const { data: aps } = useQuery({ queryKey: queryKeys.aps, queryFn: () => api.aps({}), refetchInterval: 10_000 });
  const { data: stores } = useQuery({ queryKey: queryKeys.stores, queryFn: () => api.stores({}), refetchInterval: 10_000 });
  const create = useMutation({
    mutationFn: api.createDevice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      setCreateOpen(false);
      createForm.resetFields();
      message.success(tx('设备已添加', 'Device added'));
    },
  });
  const update = useMutation({
    mutationFn: ({
      id,
      values,
    }: {
      id: string;
      values: { eslCode: string; name: string; apId?: string; productId?: string; templateId?: string };
    }) => api.updateDevice(id, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      setEditTarget(null);
      editForm.resetFields();
      message.success(tx('显示节点已更新', 'Display node updated'));
    },
  });
  const bind = useMutation({
    mutationFn: ({ id, values }: { id: string; values: { productId: string; templateId?: string } }) => api.bindDevice(id, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      setBindTarget(null);
      bindForm.resetFields();
      message.success(tx('设备已绑定', 'Device bound'));
    },
  });
  const refresh = useMutation({
    mutationFn: api.refreshDevice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      message.success(tx('已提交设备刷新', 'Device refresh submitted'));
    },
  });
  const silentWake = useMutation({
    mutationFn: ({ id, apId }: { id: string; apId?: string }) => api.silentWakeDevice(id, { apId, waitMs: 8000 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      message.success(tx('已提交唤醒请求', 'Wake request submitted'));
    },
    onError: (error: any) => {
      const raw = String(error?.userMessage ?? error?.message ?? '');
      message.error(raw.includes('没有可用') || raw.includes('no_online_ap')
        ? tx('没有可用基站，唤醒未发送。', 'No available station. Wake request was not sent.')
        : tx('唤醒失败，请稍后重试。', 'Wake request failed. Please retry later.'));
    },
  });
  const unbind = useMutation({
    mutationFn: api.unbindDevice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      message.success(tx('设备已解绑', 'Device unbound'));
    },
  });
  const productOptions = useMemo(() => (products?.items ?? []).map((item: any) => ({ label: item.name, value: item.id })), [products]);
  const templateOptions = useMemo(() => (templates?.items ?? []).map((item: any) => ({ label: item.name, value: item.id })), [templates]);
  const storeOptions = useMemo(() => (stores?.items ?? []).map((item: any) => ({ label: `${item.name} / ${item.code}`, value: item.code })), [stores]);
  const apOptions = useMemo(() => (aps?.items ?? [])
    .filter((item: any) => !filters.storeCode || item.storeCode === filters.storeCode)
    .map((item: any) => ({ label: `${item.storeName ?? item.storeCode} / ${item.apCode} / ${item.name}`, value: item.id })), [aps, filters.storeCode]);
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Card title={tx('显示节点', 'Display Nodes')} extra={<Button type="primary" onClick={() => setCreateOpen(true)}>{tx('手动添加节点', 'Add Display Node')}</Button>}>
        <Space wrap style={{ marginBottom: 16 }}>
          <Select
            allowClear
            placeholder={tx('按门店筛选', 'Filter by store')}
            style={{ width: 220 }}
            options={storeOptions}
            value={filters.storeCode}
            onChange={(storeCode) => setFilters((current) => ({ ...current, storeCode, apId: undefined }))}
          />
          <Select
            allowClear
            placeholder={tx('按基站筛选', 'Filter by AP')}
            style={{ width: 260 }}
            options={apOptions}
            value={filters.apId}
            onChange={(apId) => setFilters((current) => ({ ...current, apId }))}
          />
          <Input.Search
            allowClear
            placeholder={tx('搜索标签码/名称', 'Search label code/name')}
            style={{ width: 260 }}
            onSearch={(keyword) => setFilters((current) => ({ ...current, keyword: keyword.trim() || undefined }))}
          />
        </Space>
        <Table
          rowKey="id"
          loading={isPending}
          dataSource={data?.items ?? []}
          columns={[
            { title: tx('设备名称', 'Device Name'), render: (_, row: any) => row.name ?? row.eslCode ?? '-' },
            { title: tx('设备码', 'Device Code'), dataIndex: 'eslCode' },
            { title: tx('门店', 'Store'), render: (_, row: any) => row.ap?.storeName ?? row.storeCode ?? '-' },
            { title: 'AP', render: (_, row: any) => row.ap?.name ?? row.ap?.apCode ?? '-' },
            {
              title: tx('绑定状态', 'Binding'),
              render: (_, row: any) => <Tag color={row.bindStatus === 'bound' || row.productId || row.templateId ? 'green' : 'default'}>{row.bindStatus === 'bound' || row.productId || row.templateId ? tx('已绑定', 'Bound') : tx('未绑定', 'Unbound')}</Tag>,
            },
            { title: tx('在线状态', 'Status'), dataIndex: 'status' },
            { title: tx('数据源', 'Data Source'), render: (_, row: any) => row.product?.name ?? '-' },
            { title: tx('模板', 'Template'), render: (_, row: any) => row.template?.name ?? '-' },
            {
              title: tx('操作', 'Actions'),
              render: (_, row: any) => {
                const isBound = row.bindStatus === 'bound' || row.productId || row.templateId;
                return (
                  <Space>
                    <Button
                      onClick={() => {
                        setEditTarget(row);
                        editForm.setFieldsValue({
                          eslCode: row.eslCode,
                          name: row.name ?? '',
                          apId: row.apId ?? undefined,
                          productId: row.productId ?? undefined,
                          templateId: row.templateId ?? undefined,
                        });
                      }}
                    >
                      {tx('编辑', 'Edit')}
                    </Button>
                    <Button onClick={() => refresh.mutate(row.id)} disabled={!isBound} loading={refresh.isPending && refresh.variables === row.id}>{tx('刷新', 'Refresh')}</Button>
                    <Button
                      onClick={() => silentWake.mutate({ id: row.id, apId: row.apId })}
                      loading={silentWake.isPending && silentWake.variables?.id === row.id}
                    >
                      {tx('唤醒', 'Wake')}
                    </Button>
                    {isBound ? (
                      <Button onClick={() => unbind.mutate(row.id)} loading={unbind.isPending && unbind.variables === row.id}>{tx('解绑', 'Unbind')}</Button>
                    ) : (
                      <Button
                        onClick={() => {
                          setBindTarget(row);
                          bindForm.setFieldsValue({ templateId: row.templateId ?? undefined });
                        }}
                      >
                        {tx('绑定', 'Bind')}
                      </Button>
                    )}
                  </Space>
                );
              },
            },
          ]}
        />
      </Card>
      <Modal open={createOpen} title={tx('手动添加节点', 'Add Display Node')} onCancel={() => setCreateOpen(false)} onOk={() => createForm.submit()} confirmLoading={create.isPending}>
        <Form form={createForm} layout="vertical" onFinish={(values) => create.mutate(values)}>
          <Form.Item name="name" label={tx('设备名称', 'Device Name')} rules={[{ required: true, message: tx('请输入设备名称', 'Enter device name') }]}><Input /></Form.Item>
          <Form.Item name="eslCode" label={tx('显示节点码', 'Display Node Code')} rules={[{ required: true, message: tx('请输入显示节点码', 'Enter display node code') }]}><Input /></Form.Item>
          <Form.Item name="apId" label={tx('所属 AP', 'AP')}><Select allowClear options={apOptions} /></Form.Item>
        </Form>
      </Modal>
      <Modal open={Boolean(editTarget)} title={editTarget ? `${tx('编辑显示节点', 'Edit Display Node')} · ${editTarget.eslCode}` : tx('编辑显示节点', 'Edit Display Node')} onCancel={() => setEditTarget(null)} onOk={() => editForm.submit()} confirmLoading={update.isPending}>
        <Form
          form={editForm}
          layout="vertical"
          onFinish={(values) => {
            if (!editTarget) return;
            update.mutate({ id: editTarget.id, values });
          }}
        >
          <Form.Item name="name" label={tx('设备名称', 'Device Name')} rules={[{ required: true, message: tx('请输入设备名称', 'Enter device name') }]}><Input /></Form.Item>
          <Form.Item name="eslCode" label={tx('显示节点码', 'Display Node Code')} rules={[{ required: true, message: tx('请输入显示节点码', 'Enter display node code') }]}><Input /></Form.Item>
          <Form.Item name="apId" label={tx('所属 AP', 'AP')}><Select allowClear options={apOptions} /></Form.Item>
          <Form.Item name="productId" label={tx('数据源', 'Data Source')}><Select allowClear options={productOptions} /></Form.Item>
          <Form.Item name="templateId" label={tx('模板', 'Template')}><Select allowClear options={templateOptions} /></Form.Item>
        </Form>
      </Modal>
      <Modal open={Boolean(bindTarget)} title={bindTarget ? `${tx('绑定设备', 'Bind Device')} · ${bindTarget.eslCode}` : tx('绑定设备', 'Bind Device')} onCancel={() => setBindTarget(null)} onOk={() => bindForm.submit()} confirmLoading={bind.isPending}>
        <Form
          form={bindForm}
          layout="vertical"
          onFinish={(values) => {
            if (!bindTarget) return;
            bind.mutate({ id: bindTarget.id, values });
          }}
        >
          <Form.Item name="productId" label={tx('数据源', 'Data Source')} rules={[{ required: true, message: tx('请选择数据源', 'Select a data source') }]}><Select options={productOptions} /></Form.Item>
          <Form.Item name="templateId" label={tx('模板', 'Template')}><Select allowClear options={templateOptions} /></Form.Item>
        </Form>
      </Modal>
    </Space>
  );
};

export const EslDeviceDetailPage = () => {
  const { tx } = useI18n();
  const { id = '' } = useParams();
  const { data, isPending } = useQuery({ queryKey: queryKeys.device(id), queryFn: () => api.device(id), refetchInterval: 10_000 });
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Card title={`${tx('设备详情', 'Device Details')} · ${data?.eslCode ?? ''}`} loading={isPending}>
        <Descriptions items={[
          { key: 'type', label: tx('设备类型', 'Device Type'), children: data?.deviceType },
          { key: 'battery', label: tx('电量', 'Battery'), children: data?.battery },
          { key: 'signal', label: tx('信号', 'Signal'), children: data?.signal },
          { key: 'bind', label: tx('绑定状态', 'Binding'), children: data?.bindStatus },
        ]} />
      </Card>
      <Card title={tx('最近任务', 'Recent Tasks')}>
        <Table rowKey="id" loading={isPending} dataSource={data?.recentTasks ?? []} columns={[{ title: tx('任务', 'Task'), dataIndex: 'taskType' }, { title: tx('状态', 'Status'), dataIndex: 'status' }]} pagination={false} />
      </Card>
    </Space>
  );
};
