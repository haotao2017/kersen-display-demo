import { Card, Space, Typography } from 'antd';
import type { ReactNode } from 'react';

export const PageHeaderCard = ({ title, extra, children }: { title: string; extra?: ReactNode; children?: ReactNode }) => (
  <Card styles={{ body: { padding: 20 } }}>
    <Space direction="vertical" size={4} style={{ width: '100%' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {title}
        </Typography.Title>
        {extra}
      </Space>
      {children}
    </Space>
  </Card>
);
