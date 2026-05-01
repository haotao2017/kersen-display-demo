import { App, Button, Card, Form, Input, Typography } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAppStore } from '../../app/store';
import { useI18n } from '../../i18n';

export const RegisterPage = () => {
  const { message } = App.useApp();
  const { tx } = useI18n();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  const setUser = useAppStore((state) => state.setUser);
  const [form] = Form.useForm();

  const { data: invite } = useQuery({
    queryKey: ['invite-detail', token],
    queryFn: () => api.inviteDetail(token),
    enabled: Boolean(token),
  });

  useEffect(() => {
    if (!invite) return;
    form.setFieldsValue({
      token,
      displayName: invite.displayName ?? '',
      email: invite.email ?? '',
    });
  }, [form, invite, token]);

  const mutation = useMutation({
    mutationFn: api.register,
    onSuccess: (data: any) => {
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      setUser(data.user);
      message.success(tx('注册成功，已自动登录', 'Registration successful. Signed in automatically.'));
      navigate('/dashboard');
    },
    onError: (error: any) => message.error(error?.response?.data?.message ?? tx('注册失败', 'Registration failed')),
  });

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'radial-gradient(circle at top, #f0d9a8, #eef3f8 55%, #ffffff)' }}>
      <Card style={{ width: 460, borderRadius: 20 }}>
        <Typography.Title level={2}>{tx('受控注册', 'Controlled Registration')}</Typography.Title>
        <Typography.Paragraph type="secondary">
          {tx('请输入管理员发放的邀请码或通过邀请链接进入注册。', 'Enter the invitation code from an administrator or register through an invite link.')}
        </Typography.Paragraph>
        <Form form={form} layout="vertical" initialValues={{ token }} onFinish={(values) => mutation.mutate(values)}>
          <Form.Item name="token" label={tx('邀请码', 'Invitation Code')} rules={[{ required: true }]}>
            <Input placeholder={tx('请输入邀请码', 'Enter invitation code')} />
          </Form.Item>
          <Form.Item label={tx('邀请用户名', 'Invited Username')}>
            <Input value={invite?.username ?? ''} disabled />
          </Form.Item>
          <Form.Item name="displayName" label={tx('显示名称', 'Display Name')}>
            <Input placeholder={tx('例如 店长王丽', 'e.g. Store Manager Lisa')} />
          </Form.Item>
          <Form.Item name="email" label={tx('邮箱', 'Email')}>
            <Input placeholder={tx('可选', 'Optional')} />
          </Form.Item>
          <Form.Item name="password" label={tx('密码', 'Password')} rules={[{ required: true }, { min: 6 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label={tx('确认密码', 'Confirm Password')}
            dependencies={['password']}
            rules={[
              { required: true },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  return !value || getFieldValue('password') === value ? Promise.resolve() : Promise.reject(new Error(tx('两次输入的密码不一致', 'Passwords do not match')));
                },
              }),
            ]}
          >
            <Input.Password />
          </Form.Item>
          <Button block type="primary" htmlType="submit" loading={mutation.isPending}>
            {tx('注册并登录', 'Register and Sign In')}
          </Button>
        </Form>
      </Card>
    </div>
  );
};
