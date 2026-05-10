import { DesktopOutlined, DeploymentUnitOutlined, HomeOutlined, InboxOutlined, SettingOutlined, ShopOutlined, ShoppingOutlined, TagsOutlined } from '@ant-design/icons';
import { App, Badge, Button, Layout, Menu, Select, Space, Tag, Typography } from 'antd';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { queryKeys } from '../utils/constants';
import { useAppStore } from '../app/store';
import { useWebSocket } from '../hooks/useWebSocket';
import { useI18n } from '../i18n';
import brandLogo from '../images/logo/logo_line.png';

const { Header, Sider, Content } = Layout;

export const MainLayout = () => {
  const { message } = App.useApp();
  const { language, setLanguage, tx } = useI18n();
  const location = useLocation();
  const queryClient = useQueryClient();
  const user = useAppStore((state) => state.user);
  const setUser = useAppStore((state) => state.setUser);
  const wsConnected = useAppStore((state) => state.wsConnected);
  useWebSocket();
  const hasToken = Boolean(localStorage.getItem('accessToken'));
  const { data, isError, isFetched } = useQuery({
    queryKey: queryKeys.me,
    queryFn: api.me,
    enabled: hasToken && !user,
    retry: false,
  });
  const isAuthFailed = hasToken && !user && isFetched && isError;

  useEffect(() => {
    if (data) setUser(data);
  }, [data, setUser]);

  useEffect(() => {
    if (!hasToken) {
      setUser(null);
    }
  }, [hasToken, setUser]);

  const logout = useMutation({
    mutationFn: () => api.logout({ refreshToken: localStorage.getItem('refreshToken') ?? '' }),
    onSettled: async () => {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      setUser(null);
      await queryClient.clear();
      message.success(tx('已退出登录', 'Signed out'));
    },
  });

  const items = [
    { key: '/dashboard', icon: <HomeOutlined />, label: <Link to="/dashboard">{tx('仪表盘', 'Dashboard')}</Link> },
    { key: '/stores', icon: <ShopOutlined />, label: <Link to="/stores">{tx('门店管理', 'Stores')}</Link> },
    { key: '/products', icon: <ShoppingOutlined />, label: <Link to="/products">{tx('商品管理', 'Data Source')}</Link> },
    { key: '/templates', icon: <TagsOutlined />, label: <Link to="/templates">{tx('模板管理', 'Templates')}</Link> },
    { key: '/esl-devices', icon: <DesktopOutlined />, label: <Link to="/esl-devices">{tx('ESL 设备', 'Display Nodes')}</Link> },
    { key: '/aps', icon: <DeploymentUnitOutlined />, label: <Link to="/aps">{tx('AP 基站', 'AP Stations')}</Link> },
    { key: '/tasks', icon: <InboxOutlined />, label: <Link to="/tasks">{tx('任务中心', 'Tasks')}</Link> },
    { key: '/settings', icon: <SettingOutlined />, label: <Link to="/settings">{tx('系统设置', 'Settings')}</Link> },
  ];

  if (!hasToken || isAuthFailed) {
    if (isAuthFailed) {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
    }
    return <Navigate to="/login" replace />;
  }

  return (
    <Layout style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #f4efe7 0%, #f7f8fb 60%, #eef3f8 100%)' }}>
      <Sider theme="light" width={240} style={{ borderRight: '1px solid #ece6dd' }}>
        <div style={{ padding: 24 }}>
          <img
              src={brandLogo}
              alt="Karsen Tech Limited"
              style={{ width: 200, height: 88, objectFit: 'contain', borderRadius: 12, background: '#fff' }}
            />
          {/* <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            
            <div style={{ minWidth: 0 }}>
              <Typography.Title level={2} style={{ textAlign: 'center', marginBottom: 8 }}>
                {tx('显示云', 'Display Cloud')}
              </Typography.Title>
              <Typography.Text type="secondary" style={{ textAlign: 'center', marginBottom: 24 }}>
                {tx('无线显示管理', 'Wireless display management')}
              </Typography.Text>
            </div>
          </div> */}
        </div>
        <Menu mode="inline" selectedKeys={[location.pathname.startsWith('/templates/') ? '/templates' : location.pathname.startsWith('/stores') ? '/stores' : location.pathname]} items={items} />
      </Sider>
      <Layout>
        <Header style={{ background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(12px)', borderBottom: '1px solid #ece6dd' }}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Space>
              <Tag color="gold">dev</Tag>
              <Badge status={wsConnected ? 'success' : 'default'} text={wsConnected ? tx('实时连接中', 'Realtime connected') : tx('实时连接断开', 'Realtime disconnected')} />
            </Space>
            <Space>
              <Select
                size="small"
                value={language}
                onChange={(value) => setLanguage(value)}
                style={{ width: 120 }}
                options={[
                  { value: 'zh', label: '中文' },
                  { value: 'en', label: 'English' },
                ]}
              />
              <Typography.Text>{user?.displayName || user?.username || tx('未登录', 'Guest')}</Typography.Text>
              <Button size="small" onClick={() => logout.mutate()} loading={logout.isPending}>
                {tx('退出登录', 'Sign out')}
              </Button>
            </Space>
          </Space>
        </Header>
        <Content style={{ padding: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};
