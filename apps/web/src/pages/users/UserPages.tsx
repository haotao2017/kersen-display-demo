import { ArrowLeftOutlined, EyeOutlined } from '@ant-design/icons';
import { Button, Card, Descriptions, Empty, Space, Statistic, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import dayjs from 'dayjs';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { useAppStore } from '../../app/store';
import { PageHeaderCard } from '../../components/common/PageHeaderCard';
import { useI18n } from '../../i18n';
import type { Ap, EslDevice, Product, PushTask, Store, Template, User } from '../../types/domain';
import { queryKeys } from '../../utils/constants';
import { getTaskStatusLabel, getTaskUserText } from '../../utils/taskText';

const formatDateTime = (value?: string | null) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-');

const UserStatusTag = ({ status, tx }: { status?: User['status']; tx: (zh: string, en: string) => string }) => (
  <Tag color={status === 'disabled' ? 'default' : 'green'}>{status === 'disabled' ? tx('禁用', 'Disabled') : tx('启用', 'Active')}</Tag>
);

const EmptyText = () => <Typography.Text type="secondary">-</Typography.Text>;

export const UserListPage = () => {
  const { tx } = useI18n();
  const currentUser = useAppStore((state) => state.user);
  const isAdmin = currentUser?.role === 'ADMIN';
  const [pagination, setPagination] = useState({ current: 1, pageSize: 50 });
  const { data, isPending } = useQuery({
    queryKey: [...queryKeys.users, pagination],
    queryFn: () => api.users({ page: pagination.current, pageSize: pagination.pageSize }),
    enabled: isAdmin,
    placeholderData: (previous) => previous,
  });
  const users = (data?.items ?? []).filter((user) => user.role !== 'ADMIN');

  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <PageHeaderCard title={tx('用户', 'Users')}>
        {tx('这里展示所有非管理员账号。进入详情后可以查看该账号名下的门店、基站、标签、模板、商品和任务。', 'This page lists all non-admin accounts. Open a user to view the stores, stations, labels, templates, products, and tasks owned by that account.')}
      </PageHeaderCard>
      <Card>
        <Table<User>
          rowKey="id"
          loading={isPending}
          dataSource={users}
          pagination={{
            current: data?.page ?? pagination.current,
            pageSize: data?.pageSize ?? pagination.pageSize,
            total: data?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [20, 50, 100, 200],
          }}
          onChange={(next) => setPagination({
            current: next.current ?? 1,
            pageSize: next.pageSize ?? 50,
          })}
          locale={{ emptyText: <Empty description={tx('暂无非管理员账号', 'No non-admin users yet')} /> }}
          columns={[
            { title: tx('用户名', 'Username'), dataIndex: 'username' },
            { title: tx('显示名称', 'Display Name'), dataIndex: 'displayName', render: (value) => value || <EmptyText /> },
            { title: tx('邮箱', 'Email'), dataIndex: 'email', render: (value) => value || <EmptyText /> },
            { title: tx('角色', 'Role'), dataIndex: 'role', render: (value) => <Tag>{value}</Tag> },
            { title: tx('状态', 'Status'), render: (_, row) => <UserStatusTag status={row.status} tx={tx} /> },
            { title: tx('最后登录', 'Last Login'), render: (_, row) => formatDateTime(row.lastLoginAt) },
            { title: tx('创建时间', 'Created At'), render: (_, row) => formatDateTime(row.createdAt) },
            {
              title: tx('操作', 'Actions'),
              render: (_, row) => (
                <Link to={`/users/${row.id}`}>
                  <Button icon={<EyeOutlined />}>{tx('查看数据', 'View Data')}</Button>
                </Link>
              ),
            },
          ]}
        />
      </Card>
    </Space>
  );
};

export const UserDetailPage = () => {
  const { tx } = useI18n();
  const { id } = useParams();
  const currentUser = useAppStore((state) => state.user);
  const isAdmin = currentUser?.role === 'ADMIN';
  const { data, isPending } = useQuery({
    queryKey: id ? queryKeys.userDetail(id) : ['user-empty'],
    queryFn: () => api.userDetail(id!),
    enabled: isAdmin && Boolean(id),
    refetchInterval: 10_000,
  });

  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  const user = data?.user;
  const counts = data?.counts;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <PageHeaderCard
        title={user ? `${user.displayName || user.username} / ${user.username}` : tx('用户详情', 'User Details')}
        extra={(
          <Link to="/users">
            <Button icon={<ArrowLeftOutlined />}>{tx('返回用户列表', 'Back to Users')}</Button>
          </Link>
        )}
      >
        {tx('当前页面只展示这个账号归属的数据。管理员可以在各业务模块中为该账号新增或调整数据归属。', 'This page only shows records owned by this account. Admins can create or adjust ownership for this user from each business module.')}
      </PageHeaderCard>

      <Card loading={isPending}>
        <Descriptions column={{ xs: 1, md: 2, xl: 4 }}>
          <Descriptions.Item label={tx('用户名', 'Username')}>{user?.username ?? '-'}</Descriptions.Item>
          <Descriptions.Item label={tx('显示名称', 'Display Name')}>{user?.displayName || '-'}</Descriptions.Item>
          <Descriptions.Item label={tx('邮箱', 'Email')}>{user?.email || '-'}</Descriptions.Item>
          <Descriptions.Item label={tx('状态', 'Status')}>{user ? <UserStatusTag status={user.status} tx={tx} /> : '-'}</Descriptions.Item>
          <Descriptions.Item label={tx('角色', 'Role')}>{user?.role ? <Tag>{user.role}</Tag> : '-'}</Descriptions.Item>
          <Descriptions.Item label={tx('最后登录', 'Last Login')}>{formatDateTime(user?.lastLoginAt)}</Descriptions.Item>
          <Descriptions.Item label={tx('创建时间', 'Created At')}>{formatDateTime(user?.createdAt)}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Space size={16} wrap>
        <Card><Statistic title={tx('门店', 'Stores')} value={counts?.stores ?? 0} /></Card>
        <Card><Statistic title={tx('AP 基站', 'AP Stations')} value={counts?.aps ?? 0} /></Card>
        <Card><Statistic title={tx('显示节点', 'Display Nodes')} value={counts?.devices ?? 0} /></Card>
        <Card><Statistic title={tx('模板', 'Templates')} value={counts?.templates ?? 0} /></Card>
        <Card><Statistic title={tx('商品', 'Data Sources')} value={counts?.products ?? 0} /></Card>
        <Card><Statistic title={tx('任务', 'Tasks')} value={counts?.tasks ?? 0} /></Card>
      </Space>

      <Card title={tx('门店', 'Stores')} loading={isPending}>
        <Table<Store>
          rowKey="code"
          dataSource={data?.stores ?? []}
          pagination={{ pageSize: 5 }}
          columns={[
            { title: tx('门店名称', 'Store Name'), dataIndex: 'name' },
            { title: tx('门店号', 'Store Code'), dataIndex: 'code' },
            { title: tx('地址', 'Address'), dataIndex: 'address', render: (value) => value || '-' },
            { title: tx('基站', 'APs'), render: (_, row) => `${row.onlineApCount ?? 0}/${row.apCount ?? 0}` },
            { title: tx('显示节点', 'Display Nodes'), dataIndex: 'deviceCount' },
          ]}
        />
      </Card>

      <Card title={tx('AP 基站', 'AP Stations')} loading={isPending}>
        <Table<Ap>
          rowKey="id"
          dataSource={data?.aps ?? []}
          pagination={{ pageSize: 5 }}
          columns={[
            { title: tx('名称', 'Name'), dataIndex: 'name' },
            { title: tx('基站编号', 'Station Code'), dataIndex: 'apCode' },
            { title: tx('门店号', 'Store Code'), dataIndex: 'storeCode', render: (value) => value || '-' },
            { title: tx('状态', 'Status'), render: (_, row) => <Tag color={row.status === 'online' ? 'green' : 'default'}>{row.status === 'online' ? tx('在线', 'Online') : tx('离线', 'Offline')}</Tag> },
            { title: tx('显示节点', 'Display Nodes'), dataIndex: 'deviceCount' },
            { title: tx('最后在线', 'Last Online'), render: (_, row) => formatDateTime(row.lastOnlineAt) },
          ]}
        />
      </Card>

      <Card title={tx('显示节点', 'Display Nodes')} loading={isPending}>
        <Table<EslDevice>
          rowKey="id"
          dataSource={data?.devices ?? []}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: tx('节点码', 'Node Code'), dataIndex: 'eslCode' },
            { title: tx('名称', 'Name'), dataIndex: 'name', render: (value) => value || '-' },
            { title: tx('AP 基站', 'AP Station'), dataIndex: 'apId', render: (value) => value || '-' },
            { title: tx('门店号', 'Store Code'), dataIndex: 'storeCode', render: (value) => value || '-' },
            { title: tx('绑定状态', 'Binding'), render: (_, row) => <Tag color={row.bindStatus === 'bound' ? 'green' : 'default'}>{row.bindStatus === 'bound' ? tx('已绑定', 'Bound') : tx('未绑定', 'Unbound')}</Tag> },
            { title: tx('更新时间', 'Updated At'), render: (_, row) => formatDateTime(row.updatedAt) },
          ]}
        />
      </Card>

      <Card title={tx('模板', 'Templates')} loading={isPending}>
        <Table<Template>
          rowKey="id"
          dataSource={data?.templates ?? []}
          pagination={{ pageSize: 5 }}
          columns={[
            { title: tx('模板名称', 'Template Name'), dataIndex: 'name' },
            { title: tx('编码', 'Code'), dataIndex: 'code' },
            { title: tx('尺寸', 'Size'), render: (_, row) => `${row.width} x ${row.height}` },
            { title: tx('使用设备数', 'Devices Using It'), dataIndex: 'useDeviceCount' },
            { title: tx('状态', 'Status'), render: (_, row) => <Tag color={row.status === 'published' ? 'green' : 'default'}>{row.status}</Tag> },
          ]}
        />
      </Card>

      <Card title={tx('商品', 'Data Sources')} loading={isPending}>
        <Table<Product>
          rowKey="id"
          dataSource={data?.products ?? []}
          pagination={{ pageSize: 5 }}
          columns={[
            { title: tx('名称', 'Name'), dataIndex: 'name' },
            { title: tx('SKU', 'SKU'), dataIndex: 'sku' },
            { title: tx('价格', 'Price'), dataIndex: 'price' },
            { title: tx('默认模板', 'Default Template'), dataIndex: 'defaultTemplateId', render: (value) => value || '-' },
            { title: tx('状态', 'Status'), render: (_, row) => <Tag color={row.status === 'active' ? 'green' : 'default'}>{row.status}</Tag> },
          ]}
        />
      </Card>

      <Card title={tx('最近任务', 'Recent Tasks')} loading={isPending}>
        <Table<PushTask>
          rowKey="id"
          dataSource={data?.tasks ?? []}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: tx('任务 ID', 'Task ID'), dataIndex: 'id' },
            { title: tx('显示节点', 'Display Node'), render: (_, row) => row.eslDeviceId || '-' },
            { title: tx('AP 基站', 'AP Station'), render: (_, row) => row.apId || '-' },
            { title: tx('状态', 'Status'), render: (_, row) => getTaskStatusLabel(row, tx) },
            { title: tx('结果', 'Result'), render: (_, row) => getTaskUserText(row, tx) },
            { title: tx('创建时间', 'Created At'), render: (_, row) => formatDateTime(row.createdAt) },
          ]}
        />
      </Card>
    </Space>
  );
};
