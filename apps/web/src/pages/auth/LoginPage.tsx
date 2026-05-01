import { App, Button, Card, Form, Input, Typography } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { useAppStore } from '../../app/store';
import { useI18n } from '../../i18n';
import brandLogo from '../../images/logo/logo.jpg';

export const LoginPage = () => {
  const { message } = App.useApp();
  const { tx } = useI18n();
  const navigate = useNavigate();
  const setUser = useAppStore((state) => state.setUser);

  useEffect(() => {
    const authMessage = sessionStorage.getItem('authMessage');
    if (!authMessage) return;
    sessionStorage.removeItem('authMessage');
    message.warning(authMessage);
  }, [message]);

  const mutation = useMutation({
    mutationFn: api.login,
    onSuccess: (data) => {
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      setUser(data.user);
      message.success(tx('登录成功', 'Login successful'));
      navigate('/dashboard');
    },
    onError: (error: any) => {
      message.error(error?.response?.data?.message ?? error?.message ?? tx('登录失败，请检查后端服务或账号密码', 'Login failed. Please check the server, username, or password.'));
    },
  });

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'radial-gradient(circle at top, #f0d9a8, #eef3f8 55%, #ffffff)' }}>
      <Card style={{ width: 420, borderRadius: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <img
            src={brandLogo}
            alt="Karsen Tech Limited"
            style={{ width: '100%', maxWidth: 300, height: 'auto', objectFit: 'contain' }}
          />
        </div>
        <Typography.Title level={2} style={{ textAlign: 'center', marginBottom: 8 }}>
          {tx('Karsen 显示管理平台', 'Karsen Display Platform')}
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center', marginBottom: 24 }}>
          {tx('无线显示管理', 'Wireless display management')}
        </Typography.Paragraph>
        <Form layout="vertical" initialValues={{ username: 'admin', password: '123456' }} onFinish={(values) => mutation.mutate(values)}>
          <Form.Item name="username" label={tx('用户名', 'Username')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label={tx('密码', 'Password')} rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Button block type="primary" htmlType="submit" loading={mutation.isPending}>
            {tx('登录', 'Sign in')}
          </Button>
          <Typography.Paragraph style={{ marginTop: 16, marginBottom: 0 }}>
            {tx('收到管理员邀请链接后，可前往', 'If you received an invite link from an admin, go to')} <Link to="/register">{tx('受控注册', 'Controlled registration')}</Link>
          </Typography.Paragraph>
        </Form>
      </Card>
    </div>
  );
};
