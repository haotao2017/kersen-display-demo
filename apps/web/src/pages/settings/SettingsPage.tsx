import { App, Button, Card, Form, Input, InputNumber, List, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { useI18n } from '../../i18n';
import { queryKeys } from '../../utils/constants';
import { useAppStore } from '../../app/store';
import { useState } from 'react';
import type { User } from '../../types/domain';

export const SettingsPage = () => {
  const { tx } = useI18n();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const user = useAppStore((state) => state.user);
  const [form] = Form.useForm();
  const [resetForm] = Form.useForm();
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const isAdmin = user?.role === 'ADMIN';
  const { data: users, isPending: isUsersPending } = useQuery({ queryKey: queryKeys.users, queryFn: api.users, enabled: isAdmin });
  const { data: stores } = useQuery({ queryKey: queryKeys.stores, queryFn: () => api.stores({}), enabled: isAdmin });
  const { data: invites, isPending: isInvitesPending } = useQuery({ queryKey: queryKeys.userInvites, queryFn: api.userInvites, enabled: isAdmin });
  const { data: auditLogs, isPending: isAuditLogsPending } = useQuery({ queryKey: queryKeys.auditLogs, queryFn: api.auditLogs, enabled: isAdmin });
  const createInvite = useMutation({
    mutationFn: api.createUserInvite,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.userInvites });
      form.resetFields();
      const registerUrl = `${window.location.origin}${result.registerPath}`;
      navigator.clipboard?.writeText(registerUrl).catch(() => undefined);
      message.success(`${tx('邀请已创建，注册链接已复制：', 'Invite created and link copied: ')}${registerUrl}`);
    },
    onError: (error: any) => message.error(error?.response?.data?.message ?? tx('创建邀请失败', 'Failed to create invite')),
  });
  const disableUser = useMutation({
    mutationFn: api.disableUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users });
      queryClient.invalidateQueries({ queryKey: queryKeys.auditLogs });
      message.success(tx('用户已禁用', 'User disabled'));
    },
  });
  const enableUser = useMutation({
    mutationFn: api.enableUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users });
      queryClient.invalidateQueries({ queryKey: queryKeys.auditLogs });
      message.success(tx('用户已启用', 'User enabled'));
    },
  });
  const resetPassword = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) => api.resetUserPassword(id, { password }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users });
      queryClient.invalidateQueries({ queryKey: queryKeys.auditLogs });
      setResetTarget(null);
      resetForm.resetFields();
      message.success(tx('密码已重置，原登录会话已失效', 'Password reset. Existing sessions were invalidated.'));
    },
    onError: (error: any) => message.error(error?.response?.data?.message ?? tx('重置密码失败', 'Failed to reset password')),
  });
  const revokeInvite = useMutation({
    mutationFn: api.revokeUserInvite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.userInvites });
      queryClient.invalidateQueries({ queryKey: queryKeys.auditLogs });
      message.success(tx('邀请已撤销', 'Invite revoked'));
    },
    onError: (error: any) => message.error(error?.response?.data?.message ?? tx('撤销邀请失败', 'Failed to revoke invite')),
  });

  if (!isAdmin) {
    return (
        <Card title={tx('系统设置', 'Settings')}>
          <Typography.Text type="secondary">{tx('仅管理员可管理账号与受控注册邀请。', 'Only administrators can manage accounts and controlled registration invites.')}</Typography.Text>
        </Card>
    );
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Card title={tx('创建受控注册邀请', 'Create Controlled Registration Invite')}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ role: 'OPERATOR', expiresInDays: 7 }}
          onFinish={(values) => createInvite.mutate(values)}
        >
          <Form.Item name="username" label={tx('用户名', 'Username')} rules={[{ required: true }]}>
            <Input placeholder={tx('例如 store_manager_01', 'e.g. store_manager_01')} />
          </Form.Item>
          <Form.Item name="displayName" label={tx('显示名称', 'Display Name')}>
            <Input placeholder={tx('例如 门店店长', 'e.g. Store Manager')} />
          </Form.Item>
          <Form.Item name="email" label={tx('邮箱', 'Email')}>
            <Input placeholder={tx('可选', 'Optional')} />
          </Form.Item>
          <Form.Item name="role" label={tx('角色', 'Role')}>
            <Select options={[{ label: 'ADMIN', value: 'ADMIN' }, { label: 'OPERATOR', value: 'OPERATOR' }, { label: 'VIEWER', value: 'VIEWER' }]} />
          </Form.Item>
          <Form.Item name="storeCode" label={tx('默认门店', 'Default Store')}>
            <Select
              allowClear
              options={(stores?.items ?? []).map((store: any) => ({ label: `${store.name} / ${store.code}`, value: store.code }))}
              placeholder={tx('可不绑定门店', 'No store required')}
            />
          </Form.Item>
          <Form.Item name="expiresInDays" label={tx('有效天数', 'Valid Days')}>
            <InputNumber min={1} max={30} style={{ width: '100%' }} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createInvite.isPending}>
            {tx('创建邀请并复制注册链接', 'Create Invite and Copy Link')}
          </Button>
        </Form>
      </Card>

      <Card title={tx('用户列表', 'Users')}>
        <Table
          rowKey="id"
          loading={isUsersPending}
          dataSource={users ?? []}
          pagination={false}
          columns={[
            { title: tx('用户名', 'Username'), dataIndex: 'username' },
            { title: tx('显示名称', 'Display Name'), dataIndex: 'displayName' },
            { title: tx('邮箱', 'Email'), dataIndex: 'email' },
            { title: tx('角色', 'Role'), dataIndex: 'role' },
            {
              title: tx('状态', 'Status'),
              render: (_, row: any) => <Tag color={row.status === 'active' ? 'green' : 'default'}>{row.status === 'active' ? tx('启用', 'Active') : tx('禁用', 'Disabled')}</Tag>,
            },
            { title: tx('最后登录', 'Last Login'), dataIndex: 'lastLoginAt' },
            {
              title: tx('操作', 'Actions'),
              render: (_, row: User) => (
                <Space>
                  <Button onClick={() => { setResetTarget(row); resetForm.setFieldsValue({ password: '' }); }}>
                    {tx('重置密码', 'Reset Password')}
                  </Button>
                  <Button
                    onClick={() => (row.status === 'active' ? disableUser.mutate(row.id) : enableUser.mutate(row.id))}
                    loading={(disableUser.isPending && disableUser.variables === row.id) || (enableUser.isPending && enableUser.variables === row.id)}
                  >
                    {row.status === 'active' ? tx('禁用', 'Disable') : tx('启用', 'Enable')}
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Card title={tx('邀请记录', 'Invites')}>
        <Table
          rowKey="id"
          loading={isInvitesPending}
          dataSource={invites ?? []}
          pagination={false}
          columns={[
            { title: tx('用户名', 'Username'), dataIndex: 'username' },
            { title: tx('显示名称', 'Display Name'), dataIndex: 'displayName' },
            { title: tx('角色', 'Role'), dataIndex: 'role' },
            { title: tx('过期时间', 'Expires At'), dataIndex: 'expiresAt' },
            {
              title: tx('状态', 'Status'),
              render: (_, row: any) => (
                <Tag color={row.revokedAt ? 'red' : row.usedAt ? 'default' : 'blue'}>
                  {row.revokedAt ? tx('已撤销', 'Revoked') : row.usedAt ? tx('已使用', 'Used') : tx('待使用', 'Pending')}
                </Tag>
              ),
            },
            {
              title: tx('注册链接', 'Registration Link'),
              render: (_, row: any) => (
                <Typography.Text copyable={{ text: `${window.location.origin}${row.registerPath || `/register?token=${row.token}`}` }}>
                  {tx('复制链接', 'Copy Link')}
                </Typography.Text>
              ),
            },
            {
              title: tx('操作', 'Actions'),
              render: (_, row: any) => (
                <Popconfirm
                  title={tx('确认撤销这条邀请？', 'Revoke this invite?')}
                  onConfirm={() => revokeInvite.mutate(row.id)}
                  disabled={Boolean(row.usedAt || row.revokedAt)}
                >
                  <Button disabled={Boolean(row.usedAt || row.revokedAt)} loading={revokeInvite.isPending && revokeInvite.variables === row.id}>{tx('撤销', 'Revoke')}</Button>
                </Popconfirm>
              ),
            },
          ]}
        />
      </Card>

      <Card title={tx('最近审计日志', 'Recent Audit Logs')}>
        <Table
          rowKey="id"
          loading={isAuditLogsPending}
          dataSource={auditLogs ?? []}
          pagination={false}
          columns={[
            { title: tx('时间', 'Time'), dataIndex: 'createdAt', width: 220 },
            { title: tx('模块', 'Module'), dataIndex: 'module', width: 100 },
            { title: tx('动作', 'Action'), dataIndex: 'action', width: 180 },
            { title: tx('操作者', 'Operator'), dataIndex: 'operatorId', width: 220 },
            { title: tx('目标', 'Target'), dataIndex: 'targetId', width: 220 },
            {
              title: tx('摘要', 'Summary'),
              render: (_, row: any) => (
                <Typography.Text type="secondary">
                  {JSON.stringify(row.afterJson ?? row.beforeJson ?? {})}
                </Typography.Text>
              ),
            },
          ]}
        />
      </Card>

      <Card title={tx('说明', 'Notes')}>
        <List
          dataSource={[
            tx('管理员创建邀请后，系统会生成注册链接。', 'After an admin creates an invite, the system generates a registration link.'),
            tx('用户使用链接进入 /register，设置密码后自动完成账号激活并登录。', 'Users can open /register with the link, set a password, and get activated and signed in automatically.'),
            tx('当前版本已支持禁用/启用、重置密码、邀请撤销和基础审计日志。', 'This version supports disable/enable, password reset, invite revoke, and basic audit logs.'),
          ]}
          renderItem={(item) => <List.Item>{item}</List.Item>}
        />
      </Card>

      <Modal
        title={resetTarget ? `${tx('重置密码', 'Reset Password')} · ${resetTarget.username}` : tx('重置密码', 'Reset Password')}
        open={Boolean(resetTarget)}
        onCancel={() => {
          setResetTarget(null);
          resetForm.resetFields();
        }}
        onOk={() => resetForm.submit()}
        confirmLoading={resetPassword.isPending}
        destroyOnClose
      >
        <Form
          form={resetForm}
          layout="vertical"
          onFinish={(values) => {
            if (!resetTarget) return;
            resetPassword.mutate({ id: resetTarget.id, password: values.password });
          }}
        >
          <Form.Item name="password" label={tx('新密码', 'New Password')} rules={[{ required: true }, { min: 6, message: tx('密码至少 6 位', 'Password must be at least 6 characters') }]}>
            <Input.Password placeholder={tx('请输入新密码', 'Enter new password')} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
};
