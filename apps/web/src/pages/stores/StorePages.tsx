import { App, Button, Card, Form, Input, Modal, Popconfirm, Space, Table, Tag } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api';
import { PageHeaderCard } from '../../components/common/PageHeaderCard';
import { useI18n } from '../../i18n';
import { queryKeys } from '../../utils/constants';
import type { Store } from '../../types/domain';

export const StoreListPage = () => {
  const { tx } = useI18n();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Store | null>(null);
  const { data, isPending } = useQuery({ queryKey: queryKeys.stores, queryFn: () => api.stores({}), refetchInterval: 10_000 });

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

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <PageHeaderCard
        title={tx('门店管理', 'Stores')}
        extra={<Button type="primary" onClick={() => setOpen(true)}>{tx('新增门店', 'New Store')}</Button>}
      >
        {tx('基站配置里的门店号必须先在这里创建。未匹配门店号的基站不会登记，也不会显示在基站列表。', 'AP store codes must be created here first. Stations with unmatched store codes are rejected and hidden.')}
      </PageHeaderCard>
      <Card>
        <Table
          rowKey="code"
          loading={isPending}
          dataSource={data?.items ?? []}
          columns={[
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
                    description={tx('删除后该门店下的基站、标签和任务都会从系统中消失。', 'APs, labels, and tasks under this store will disappear from the system.')}
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
          <Form.Item name="address" label={tx('门店地址', 'Store Address')}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
};
