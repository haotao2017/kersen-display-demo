import { App, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api';
import { useAppStore } from '../../app/store';
import { PageHeaderCard } from '../../components/common/PageHeaderCard';
import { useI18n } from '../../i18n';
import { queryKeys } from '../../utils/constants';
import type { Store } from '../../types/domain';

export const StoreListPage = () => {
  const { tx } = useI18n();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const currentUser = useAppStore((state) => state.user);
  const isAdmin = currentUser?.role === 'ADMIN';
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Store | null>(null);
  const [filters, setFilters] = useState<{ ownerUserId?: string; keyword?: string }>({});
  const { data, isPending } = useQuery({ queryKey: [...queryKeys.stores, filters], queryFn: () => api.stores(filters), refetchInterval: 10_000 });
  const { data: users } = useQuery({ queryKey: queryKeys.users, queryFn: () => api.users({ pageSize: 200 }), enabled: isAdmin });

  const close = () => {
    setOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const save = useMutation({
    mutationFn: (values: { code: string; name: string; address?: string }) => (
      editing ? api.updateStore(editing.code, values) : api.createStore(values)
    ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.stores });
      await queryClient.invalidateQueries({ queryKey: queryKeys.aps });
      await queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      close();
      message.success(tx('门店已保存', 'Store saved'));
    },
    onError: (error: any) => message.error(error?.response?.data?.message ?? tx('保存门店失败', 'Failed to save store')),
  });

  const remove = useMutation({
    mutationFn: api.deleteStore,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.stores });
      await queryClient.invalidateQueries({ queryKey: queryKeys.aps });
      await queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      message.success(tx('门店已删除', 'Store deleted'));
    },
    onError: (error: any) => message.error(error?.response?.data?.message ?? tx('删除门店失败', 'Failed to delete store')),
  });

  const openEdit = (store: Store) => {
    setEditing(store);
    form.setFieldsValue({ code: store.code, name: store.name, address: store.address });
    setOpen(true);
  };

  const userOptions = (users?.items ?? []).map((user) => ({ label: `${user.displayName || user.username} / ${user.username}`, value: user.id }));

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <PageHeaderCard
        title={tx('门店管理', 'Stores')}
        extra={<Button type="primary" onClick={() => {
          setEditing(null);
          form.setFieldsValue({ ownerUserId: currentUser?.id });
          setOpen(true);
        }}>{tx('新增门店', 'New Store')}</Button>}
      >
        {tx('基站配置里的门店号必须先在这里创建。未匹配门店号的基站不会登记，也不会显示在基站列表。', 'AP store codes must be created here first. Stations with unmatched store codes are rejected and hidden.')}
      </PageHeaderCard>
      <Card>
        <Space wrap style={{ marginBottom: 16 }}>
          {isAdmin ? (
            <Select
              allowClear
              placeholder={tx('按用户筛选', 'Filter by user')}
              style={{ width: 240 }}
              options={userOptions}
              value={filters.ownerUserId}
              onChange={(ownerUserId) => setFilters((current) => ({ ...current, ownerUserId }))}
            />
          ) : null}
          <Input.Search
            allowClear
            placeholder={tx('搜索门店名称/门店号/地址', 'Search store name/code/address')}
            style={{ width: 280 }}
            onSearch={(keyword) => setFilters((current) => ({ ...current, keyword: keyword.trim() || undefined }))}
          />
        </Space>
        <Table
          rowKey="code"
          loading={isPending}
          dataSource={data?.items ?? []}
          columns={[
            ...(isAdmin ? [{ title: tx('归属账号', 'Owner'), render: (_: unknown, row: any) => row.owner?.displayName || row.owner?.username || row.ownerUserId || '-' }] : []),
            { title: tx('门店名称', 'Store Name'), dataIndex: 'name' },
            { title: tx('门店号', 'Store Code'), dataIndex: 'code' },
            { title: tx('门店地址', 'Address'), dataIndex: 'address', render: (value) => value || '-' },
            { title: tx('基站', 'APs'), render: (_, row: Store) => <Tag color={row.onlineApCount ? 'green' : 'default'}>{row.onlineApCount ?? 0}/{row.apCount ?? 0}</Tag> },
            { title: tx('显示节点', 'Display Nodes'), dataIndex: 'deviceCount' },
            {
              title: tx('操作', 'Actions'),
              render: (_, row: Store) => (
                <Space>
                  <Button onClick={() => openEdit(row)}>{tx('编辑', 'Edit')}</Button>
                  <Popconfirm
                    title={tx('删除门店？', 'Delete store?')}
                    description={tx('删除门店会删除该门店下的基站，并解除标签、模板、商品、任务与该门店/基站的关联；标签、模板和商品数据本身会保留。', 'Deleting a store removes its AP stations and clears store/AP links from labels, templates, products, and tasks. Label, template, and product data will be kept.')}
                    okText={tx('删除', 'Delete')}
                    cancelText={tx('取消', 'Cancel')}
                    okButtonProps={{ danger: true }}
                    onConfirm={() => remove.mutate(row.code)}
                  >
                    <Button danger loading={remove.isPending && remove.variables === row.code}>{tx('删除', 'Delete')}</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <Modal
        open={open}
        title={editing ? tx('编辑门店', 'Edit Store') : tx('新增门店', 'New Store')}
        onCancel={close}
        onOk={() => form.submit()}
        confirmLoading={save.isPending}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
          <Form.Item name="name" label={tx('门店名称', 'Store Name')} rules={[{ required: true, message: tx('请输入门店名称', 'Enter store name') }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="code"
            label={tx('门店号', 'Store Code')}
            rules={[
              { required: true, message: tx('请输入门店号', 'Enter store code') },
              { pattern: /^\d+$/, message: tx('门店号只能为数字', 'Store code must contain digits only') },
            ]}
          >
            <Input inputMode="numeric" />
          </Form.Item>
          {isAdmin && !editing ? (
            <Form.Item name="ownerUserId" label={tx('归属账号', 'Owner')}>
              <Select allowClear options={userOptions} placeholder={tx('默认当前账号', 'Default to current user')} />
            </Form.Item>
          ) : null}
          <Form.Item name="address" label={tx('门店地址', 'Store Address')}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
};
