import { Card, Col, List, Row, Statistic, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '../../api';
import { useI18n } from '../../i18n';
import { queryKeys } from '../../utils/constants';

export const DashboardPage = () => {
  const { tx } = useI18n();
  const { data, isPending } = useQuery({ queryKey: queryKeys.dashboard, queryFn: api.dashboard });
  return (
    <Row gutter={[16, 16]}>
      <Col span={6}><Card loading={isPending}><Statistic title={tx('AP 在线', 'AP Online')} value={data?.apOnlineCount ?? 0} /></Card></Col>
      <Col span={6}><Card loading={isPending}><Statistic title={tx('AP 离线', 'AP Offline')} value={data?.apOfflineCount ?? 0} /></Card></Col>
      <Col span={6}><Card loading={isPending}><Statistic title={tx('设备在线', 'Dispaly Nodes Online')} value={data?.deviceOnlineCount ?? 0} /></Card></Col>
      <Col span={6}><Card loading={isPending}><Statistic title={tx('今日成功任务', 'Successful Tasks Today')} value={data?.todayTaskSuccess ?? 0} /></Card></Col>
      <Col span={12}>
        <Card title={tx('最近 AP 事件', 'Recent AP Events')} loading={isPending}>
          <List
            dataSource={data?.recentApEvents ?? []}
            renderItem={(item: any) => (
              <List.Item>
                <List.Item.Meta
                  title={item.title}
                  description={(
                    <div>
                      <div>{item.message}</div>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {dayjs(item.timestamp).format('YYYY-MM-DD HH:mm:ss')}
                      </Typography.Text>
                    </div>
                  )}
                />
              </List.Item>
            )}
          />
        </Card>
      </Col>
      <Col span={12}>
        <Card title={tx('最近失败任务', 'Recent Failed Tasks')} loading={isPending}>
          <List
            dataSource={data?.recentFailedTasks ?? []}
            renderItem={(item: any) => (
              <List.Item>
                <List.Item.Meta
                  title={item.title}
                  description={(
                    <div>
                      <div>{item.message}</div>
                      {item.related ? <div>{item.related}</div> : null}
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {dayjs(item.timestamp).format('YYYY-MM-DD HH:mm:ss')}
                      </Typography.Text>
                    </div>
                  )}
                />
              </List.Item>
            )}
          />
        </Card>
      </Col>
    </Row>
  );
};
