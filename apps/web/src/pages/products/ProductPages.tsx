import { DownOutlined } from '@ant-design/icons';
import { App, Button, Card, Dropdown, Form, Image, Input, InputNumber, Modal, Select, Space, Table, Tag, Upload, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { UploadProps } from 'antd';
import { api, type ProductRefreshResult, type ProductUpdateResult } from '../../api';
import { useAppStore } from '../../app/store';
import { PageHeaderCard } from '../../components/common/PageHeaderCard';
import { useI18n } from '../../i18n';
import { queryKeys } from '../../utils/constants';

type ProductFieldConfig = {
  key: string;
  labelZh: string;
  labelEn: string;
  type: 'input' | 'number' | 'select' | 'image';
  required?: boolean;
  name: string | [string, string];
};

const BASE_PRODUCT_FIELDS: ProductFieldConfig[] = [
  { key: 'name', name: 'name', labelZh: '名称 (#name)', labelEn: 'Name (#name)', type: 'input', required: true },
  { key: 'sku', name: 'sku', labelZh: '来源编号 (#sourceId)', labelEn: 'Source ID (#sourceId)', type: 'input', required: true },
  { key: 'status', name: 'status', labelZh: '状态', labelEn: 'Status', type: 'select' },
  { key: 'barcode', name: 'barcode', labelZh: '参考值 (#reference)', labelEn: 'Reference (#reference)', type: 'input' },
  { key: 'price', name: 'price', labelZh: '字段 1 (#field1)', labelEn: 'Field 1 (#field1)', type: 'number' },
  { key: 'promotionPrice', name: 'promotionPrice', labelZh: '字段 2 (#field2)', labelEn: 'Field 2 (#field2)', type: 'number' },
  { key: 'defaultTemplateId', name: 'defaultTemplateId', labelZh: '模板', labelEn: 'Template', type: 'select' },
  { key: 'subName', name: 'subName', labelZh: '副标题 (#subName)', labelEn: 'Subtitle (#subName)', type: 'input' },
  { key: 'specification', name: 'specification', labelZh: '规格 (#specification)', labelEn: 'Specification (#specification)', type: 'input' },
  { key: 'unit', name: 'unit', labelZh: '单位 (#unit)', labelEn: 'Unit (#unit)', type: 'input' },
  { key: 'memberPrice', name: 'memberPrice', labelZh: '会员价 (#memberPrice)', labelEn: 'Member Price (#memberPrice)', type: 'number' },
  { key: 'originalPrice', name: 'originalPrice', labelZh: '原价 (#originalPrice)', labelEn: 'Original Price (#originalPrice)', type: 'number' },
  { key: 'promotionText', name: 'promotionText', labelZh: '促销文案 (#promotionText)', labelEn: 'Promotion Text (#promotionText)', type: 'input' },
  { key: 'brand', name: 'brand', labelZh: '品牌 / 厂商 (#brand)', labelEn: 'Brand / Vendor (#brand)', type: 'input' },
  { key: 'imageUrl', name: 'imageUrl', labelZh: '商品图片 (#imageUrl)', labelEn: 'Product Image (#imageUrl)', type: 'image' },
];

const CUSTOM_PRODUCT_FIELDS: ProductFieldConfig[] = Array.from({ length: 22 }, (_, index) => ({
  key: `customField${index + 1}`,
  name: ['customFields', `customField${index + 1}`],
  labelZh: `自定义${index + 1} (#customField${index + 1})`,
  labelEn: `Custom ${index + 1} (#customField${index + 1})`,
  type: 'input',
}));

const PRODUCT_FIELDS = [...BASE_PRODUCT_FIELDS, ...CUSTOM_PRODUCT_FIELDS];
const DEFAULT_CREATE_VISIBLE_FIELDS = ['name', 'sku', 'status'];

const hasFieldValue = (value: unknown) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return true;
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
};

const getVisibleFieldKeys = (detail: Record<string, any> | undefined) => {
  if (!detail) return DEFAULT_CREATE_VISIBLE_FIELDS;

  const visible = PRODUCT_FIELDS
    .filter((field) => {
      if (Array.isArray(field.name)) {
        return hasFieldValue(detail[field.name[0]]?.[field.name[1]]);
      }
      return hasFieldValue(detail[field.name]);
    })
    .map((field) => field.key);

  return visible.length ? visible : DEFAULT_CREATE_VISIBLE_FIELDS;
};

export const ProductListPage = () => {
  const { tx } = useI18n();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUser = useAppStore((state) => state.user);
  const isAdmin = currentUser?.role === 'ADMIN';
  const [filters, setFilters] = useState<{ ownerUserId?: string; keyword?: string }>({});
  const { data, isPending } = useQuery({ queryKey: [...queryKeys.products, filters], queryFn: () => api.products(filters) });
  const { data: users } = useQuery({ queryKey: queryKeys.users, queryFn: () => api.users({ pageSize: 200 }), enabled: isAdmin });
  const userOptions = useMemo(() => (users?.items ?? []).map((user) => ({ label: `${user.displayName || user.username} / ${user.username}`, value: user.id })), [users]);
  const refresh = useMutation({
    mutationFn: api.refreshProduct,
    onSuccess: (result: ProductRefreshResult) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      if (result.createdTaskCount > 0) {
        message.success(
          tx(
            `刷新完成，已为 ${result.createdTaskCount} 个显示节点创建任务，跳过 ${result.skippedDeviceCount} 个`,
            `Refresh queued for ${result.createdTaskCount} display node(s), skipped ${result.skippedDeviceCount}`,
          ),
        );
      } else if (result.reasonCode === 'no_bound_devices') {
        message.warning(tx('刷新未执行，当前数据源还没有绑定显示节点', 'No refresh ran because this data source has no bound display nodes'));
      } else if (result.reasonCode === 'no_template') {
        message.warning(tx('刷新未执行，已绑定的显示节点没有可用模板', 'No refresh ran because the bound display nodes do not have an effective template'));
      } else {
        message.info(tx('刷新已提交，但这次没有生成任务', 'Refresh submitted without creating tasks'));
      }
    },
  });
  const remove = useMutation({
    mutationFn: api.deleteProduct,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.products });
      queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      message.success(tx('数据源已删除', 'Data source deleted'));
    },
    onError: (error: any) => message.error(error?.response?.data?.message ?? tx('删除数据源失败', 'Failed to delete data source')),
  });
  const describeProductImpact = (row: any) => tx(
    `删除后只删除这个数据源，并解除 ${row.bindDeviceCount ?? 0} 个显示节点与它的绑定；不会删除显示节点、模板或任务记录。`,
    `This deletes only this data source and clears bindings from ${row.bindDeviceCount ?? 0} display node(s). Display nodes, templates, and task records are kept.`,
  );

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <PageHeaderCard title={tx('商品管理', 'Data Source')} extra={<Button type="primary" onClick={() => navigate('/products/create')}>{tx('新增商品', 'New Data Source')}</Button>} />
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
            placeholder={tx('搜索名称/来源编号/参考值', 'Search name/source/reference')}
            style={{ width: 280 }}
            onSearch={(keyword) => setFilters((current) => ({ ...current, keyword: keyword.trim() || undefined }))}
          />
        </Space>
        <Table
          rowKey="id"
          loading={isPending}
          dataSource={data?.items ?? []}
          columns={[
            ...(isAdmin ? [{ title: tx('归属账号', 'Owner'), render: (_: unknown, row: any) => row.owner?.displayName || row.owner?.username || row.ownerUserId || '-' }] : []),
            { title: tx('名称', 'Name'), dataIndex: 'name' },
            { title: tx('来源编号', 'Source ID'), dataIndex: 'sku' },
            { title: tx('参考值', 'Reference'), dataIndex: 'barcode' },
            { title: tx('字段 1', 'Field 1'), dataIndex: 'price' },
            { title: tx('字段 2', 'Field 2'), dataIndex: 'promotionPrice' },
            { title: tx('模板', 'Template'), render: (_, row: any) => row.defaultTemplate?.name ?? '-' },
            { title: tx('绑定节点数', 'Bound Nodes'), dataIndex: 'bindDeviceCount' },
            { title: tx('状态', 'Status'), render: (_, row: any) => <Tag color={row.status === 'active' ? 'green' : 'default'}>{row.status}</Tag> },
            {
              title: tx('操作', 'Actions'),
              render: (_, row: any) => (
                <Space>
                  <Button onClick={() => navigate(`/products/${row.id}`)}>{tx('查看 / 编辑', 'View / Edit')}</Button>
                  <Button onClick={() => refresh.mutate(row.id)} loading={refresh.isPending && refresh.variables === row.id}>{tx('触发刷新', 'Refresh')}</Button>
                  <Button
                    danger
                    loading={remove.isPending && remove.variables === row.id}
                    onClick={() => {
                      Modal.confirm({
                        title: tx('删除数据源？', 'Delete data source?'),
                        content: describeProductImpact(row),
                        okText: tx('删除', 'Delete'),
                        cancelText: tx('取消', 'Cancel'),
                        okButtonProps: { danger: true },
                        width: 620,
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
    </Space>
  );
};

export const ProductFormPage = () => {
  const { tx } = useI18n();
  const { message } = App.useApp();
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUser = useAppStore((state) => state.user);
  const isAdmin = currentUser?.role === 'ADMIN';
  const [form] = Form.useForm();
  const isEdit = Boolean(id);
  const [visibleFieldKeys, setVisibleFieldKeys] = useState<string[]>(DEFAULT_CREATE_VISIBLE_FIELDS);
  const { data: detail, isPending: isDetailPending } = useQuery({ queryKey: id ? queryKeys.product(id) : ['product-create'], queryFn: () => api.product(id!), enabled: isEdit });
  const [boundPagination, setBoundPagination] = useState({ current: 1, pageSize: 50 });
  const { data: boundDevices, isPending: isBoundDevicesPending } = useQuery({
    queryKey: id ? [...queryKeys.productDevices(id), boundPagination] : ['product-devices-empty'],
    queryFn: () => api.productDevices(id!, { page: boundPagination.current, pageSize: boundPagination.pageSize }),
    enabled: isEdit,
  });
  const { data: templates } = useQuery({ queryKey: queryKeys.templates, queryFn: () => api.templates({}) });
  const { data: users } = useQuery({ queryKey: queryKeys.users, queryFn: () => api.users({ pageSize: 200 }), enabled: isAdmin && !isEdit });
  const mutation = useMutation({
    mutationFn: (values: any) => (isEdit ? api.updateProduct(id!, values) : api.createProduct(values)),
    onSuccess: (result: ProductUpdateResult | any) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.products });
      if (isEdit && result.refresh) {
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
        if (result.refresh.createdTaskCount > 0) {
          message.success(
            tx(
              `数据源已更新，并创建 ${result.refresh.createdTaskCount} 个标签刷新任务`,
              `Updated data source and queued ${result.refresh.createdTaskCount} label refresh task(s)`,
            ),
          );
        } else if (result.refresh.reasonCode === 'no_bound_devices') {
          message.warning(tx('数据源已更新，但当前没有绑定节点，因此未触发刷新', 'Updated data source, but no bound nodes were found, so no refresh task was created'));
        } else if (result.refresh.reasonCode === 'no_template') {
          message.warning(tx('数据源已更新，但绑定节点没有可用模板，因此未触发刷新', 'Updated data source, but bound nodes have no effective template, so no refresh task was created'));
        } else {
          message.info(tx('数据源已更新，本次没有生成刷新任务', 'Updated data source without creating refresh tasks'));
        }
      } else {
        message.success(tx('数据源已保存', 'Data source saved'));
      }
      navigate(`/products/${result.id}`);
    },
  });
  const uploadImage = useMutation({ mutationFn: api.uploadImage });

  useEffect(() => {
    form.setFieldsValue(detail ?? { status: 'active', price: 0, customFields: {} });
  }, [detail, form]);

  useEffect(() => {
    setVisibleFieldKeys(getVisibleFieldKeys(detail));
  }, [detail]);

  const hiddenFields = useMemo(
    () => PRODUCT_FIELDS.filter((field) => !visibleFieldKeys.includes(field.key)),
    [visibleFieldKeys],
  );

  const templateOptions = useMemo(
    () => (templates?.items ?? []).map((item: any) => ({ label: item.name, value: item.id })),
    [templates],
  );
  const userOptions = useMemo(
    () => (users?.items ?? []).map((user) => ({ label: `${user.displayName || user.username} / ${user.username}`, value: user.id })),
    [users],
  );

  const uploadProps: UploadProps = {
    accept: 'image/*',
    maxCount: 1,
    showUploadList: false,
    customRequest: async ({ file, onError, onSuccess }) => {
      try {
        const result = await uploadImage.mutateAsync(file as File);
        form.setFieldValue('imageUrl', result.url);
        message.success(tx('图片已上传到后端', 'Image uploaded'));
        onSuccess?.(result);
      } catch (error) {
        message.error(tx('图片上传失败', 'Image upload failed'));
        onError?.(error as Error);
      }
    },
  };

  const renderField = (field: ProductFieldConfig) => {
    const label = tx(field.labelZh, field.labelEn);

    if (field.type === 'number') {
      return (
        <Form.Item key={field.key} name={field.name} label={label} rules={field.required ? [{ required: true }] : undefined}>
          <InputNumber style={{ width: '100%' }} min={0} />
        </Form.Item>
      );
    }

    if (field.type === 'select') {
      if (field.key === 'status') {
        return (
          <Form.Item key={field.key} name={field.name} label={label} rules={field.required ? [{ required: true }] : undefined}>
            <Select options={[{ label: 'active', value: 'active' }, { label: 'inactive', value: 'inactive' }]} />
          </Form.Item>
        );
      }

      return (
        <Form.Item key={field.key} name={field.name} label={label} rules={field.required ? [{ required: true }] : undefined}>
          <Select allowClear options={templateOptions} />
        </Form.Item>
      );
    }

    if (field.type === 'image') {
      return (
        <div key={field.key}>
          <Form.Item name={field.name} label={label}>
            <Input
              addonAfter={(
                <Upload {...uploadProps}>
                  <Button loading={uploadImage.isPending}>{tx('上传图片', 'Upload Image')}</Button>
                </Upload>
              )}
            />
          </Form.Item>
          <Form.Item shouldUpdate={(prev, next) => prev.imageUrl !== next.imageUrl} noStyle>
            {() => {
              const imageUrl = form.getFieldValue('imageUrl');
              return imageUrl ? (
                <div style={{ marginBottom: 16 }}>
                  <Image src={imageUrl} width={160} />
                </div>
              ) : null;
            }}
          </Form.Item>
        </div>
      );
    }

    return (
      <Form.Item key={field.key} name={field.name} label={label} rules={field.required ? [{ required: true }] : undefined}>
        <Input />
      </Form.Item>
    );
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <PageHeaderCard
        title={isEdit ? `${tx('数据源详情', 'Data Source Details')} · ${detail?.name ?? ''}` : tx('新增数据源', 'New Data Source')}
        extra={
          <Space>
            {hiddenFields.length ? (
              <Dropdown
                menu={{
                  items: hiddenFields.map((field) => ({
                    key: field.key,
                    label: tx(field.labelZh, field.labelEn),
                  })),
                  onClick: ({ key }) => {
                    setVisibleFieldKeys((current) => PRODUCT_FIELDS
                      .map((field) => field.key)
                      .filter((fieldKey) => current.includes(fieldKey) || fieldKey === key));
                  },
                }}
              >
                <Button>
                  {tx('添加字段', 'Add Field')} <DownOutlined />
                </Button>
              </Dropdown>
            ) : null}
          </Space>
        }
      >
        {isEdit && detail?.id ? (
          <Typography.Text style={{ color: 'rgba(107, 114, 128, 0.62)', fontSize: 12 }}>
            {tx('DataSource ID', 'DataSource ID')}: {detail.id}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">
            {tx('创建时仅展示必要字段，其他字段可按需添加。', 'Only required fields are shown first. Add more fields when needed.')}
          </Typography.Text>
        )}
      </PageHeaderCard>
      <Card loading={isEdit && isDetailPending}>
        <Form form={form} layout="vertical" initialValues={{ status: 'active', price: 0, customFields: {} }} onFinish={(values) => mutation.mutate(values)}>
          {isAdmin && !isEdit ? (
            <Form.Item name="ownerUserId" label={tx('归属账号', 'Owner')}>
              <Select allowClear options={userOptions} placeholder={tx('默认当前账号', 'Default to current user')} />
            </Form.Item>
          ) : null}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
            {PRODUCT_FIELDS.filter((field) => visibleFieldKeys.includes(field.key)).map((field) => renderField(field))}
          </div>
          <Button type="primary" htmlType="submit" loading={mutation.isPending}>
            {tx('保存数据源', 'Save Data Source')}
          </Button>
        </Form>
      </Card>
      {isEdit ? (
        <Card title={`${tx('绑定节点', 'Bound Nodes')} · ${detail?.bindDeviceCount ?? boundDevices?.total ?? 0}`}>
          <Table
            rowKey="id"
            loading={isBoundDevicesPending}
            dataSource={boundDevices?.items ?? detail?.boundDevices ?? []}
            columns={[{ title: tx('节点编号', 'Node Code'), dataIndex: 'eslCode' }, { title: tx('状态', 'Status'), dataIndex: 'status' }]}
            pagination={{
              current: boundPagination.current,
              pageSize: boundPagination.pageSize,
              total: boundDevices?.total ?? detail?.bindDeviceCount ?? 0,
              showSizeChanger: true,
            }}
            onChange={(pagination) => setBoundPagination({
              current: pagination.current ?? 1,
              pageSize: pagination.pageSize ?? 50,
            })}
          />
        </Card>
      ) : null}
    </Space>
  );
};

export const ProductDetailPage = ProductFormPage;
