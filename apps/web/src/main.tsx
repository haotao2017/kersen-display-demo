import React from 'react';
import ReactDOM from 'react-dom/client';
import { Activity, BadgeDollarSign, ClipboardList, RadioTower, RefreshCcw, Send, Server, ShieldCheck, Store } from 'lucide-react';
import { api, getToken, setToken } from './lib/api';
import './styles.css';

type StoreConfig = {
  code: string;
  name: string;
  serverUrl: string;
  mqttTcpPort: number;
  mqttWsPath: string;
};

type BaseStation = {
  id: string;
  storeCode: string;
  name: string;
  mac?: string;
  ip?: string;
  firmware?: string;
  os?: string;
  hostAddr?: string;
  channels?: Array<Record<string, unknown>>;
  status: 'offline' | 'online' | 'warning';
  lastSeenAt?: string;
  metrics?: {
    rssi?: number;
    labelsOnline?: number;
    labelsTotal?: number;
  };
};

type Label = {
  id: string;
  storeCode: string;
  apId?: string;
  sku?: string;
  title: string;
  price: number;
  currency: string;
  status: string;
  battery?: number;
  rssi?: number;
  updatedAt: string;
};

type DeviceLog = {
  id: string;
  time: string;
  method: string;
  path: string;
  statusCode?: number;
  ip?: string;
  userAgent?: string;
  body?: unknown;
};

type WsStatus = {
  apId: string;
  connected: boolean;
  connectedAt?: string;
  lastMessageAt?: string;
  remoteAddress?: string;
};

type MqttStats = {
  mode: 'embedded' | 'external';
  external: {
    host?: string;
    port: number;
    connected: boolean;
    clientId: string;
  };
};

type LabelCommandResult = {
  id: string;
  status: string;
  transport?: 'websocket' | 'mqtt';
  delivery?: {
    ok?: boolean;
    reason?: string;
    bytes?: number;
    execution?: string;
  };
  mqtt?: {
    ok?: boolean;
    reason?: string;
  };
  execution?: {
    confirmed: boolean;
    reason: string;
  };
};

type LabelRender = {
  labelId: string;
  width: number;
  height: number;
  colors: string[];
  preview: {
    dataUri: string;
  };
  bitmap: {
    format: string;
    bytes: number;
    bitmap_b64: string;
  };
};

function App() {
  const [activeView, setActiveView] = React.useState<'overview' | 'stations' | 'labels' | 'cloud' | 'logs'>('overview');
  const [tokenReady, setTokenReady] = React.useState(Boolean(getToken()));
  const [storeCode, setStoreCode] = React.useState(localStorage.getItem('storeCode') ?? '20248517');
  const [username, setUsername] = React.useState(localStorage.getItem('username') ?? 'admin');
  const [password, setPassword] = React.useState('admin123456');
  const [store, setStore] = React.useState<StoreConfig | null>(null);
  const [aps, setAps] = React.useState<BaseStation[]>([]);
  const [labels, setLabels] = React.useState<Label[]>([]);
  const [logs, setLogs] = React.useState<DeviceLog[]>([]);
  const [labelRenders, setLabelRenders] = React.useState<Record<string, LabelRender>>({});
  const [wsStatuses, setWsStatuses] = React.useState<Record<string, WsStatus>>({});
  const [mqttStats, setMqttStats] = React.useState<MqttStats | null>(null);
  const [selectedApId, setSelectedApId] = React.useState('');
  const [rawWsCommand, setRawWsCommand] = React.useState('{\n  "type": "DEVICE_RETRIEVE"\n}');
  const [rawCommandStatus, setRawCommandStatus] = React.useState('未发送');
  const [sendingRawCommand, setSendingRawCommand] = React.useState(false);
  const [labelCommandStatus, setLabelCommandStatus] = React.useState<Record<string, string>>({});
  const [sendingLabels, setSendingLabels] = React.useState<Record<string, boolean>>({});
  const [showAllLogs, setShowAllLogs] = React.useState(false);
  const [logsLoadedAt, setLogsLoadedAt] = React.useState<string>('-');
  const [message, setMessage] = React.useState(getToken() ? '已恢复登录状态' : '等待登录');
  const [draftLabel, setDraftLabel] = React.useState({ id: 'label-demo-001', title: 'Demo Product', price: 19.9 });

  async function login() {
    const result = await api<{ accessToken: string; store: StoreConfig }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ storeCode, username, password }),
    });
    setToken(result.accessToken);
    localStorage.setItem('storeCode', storeCode);
    localStorage.setItem('username', username);
    setStore(result.store);
    setTokenReady(true);
    setMessage('已连接到自建云平台');
  }

  async function refresh() {
    const [storeResult, apsResult, labelsResult, mqttResult] = await Promise.all([
      api<StoreConfig>(`/api/stores/${storeCode}`),
      api<BaseStation[]>('/api/base-stations'),
      api<Label[]>('/api/labels'),
      api<MqttStats>('/api/mqtt/stats'),
    ]);
    setStore(storeResult);
    setAps(apsResult);
    setLabels(labelsResult);
    setMqttStats(mqttResult);
    setSelectedApId((current) => current || apsResult.find((ap) => ap.status === 'online')?.id || apsResult[0]?.id || '');
    setMessage(`刷新完成：${new Date().toLocaleTimeString()}`);
    void refreshLabelRenders(labelsResult);
  }

  async function refreshLabelRenders(nextLabels = labels) {
    const results = await Promise.allSettled(
      nextLabels.map(async (label) => api<LabelRender>(`/api/labels/${encodeURIComponent(label.id)}/render`)),
    );
    const rendered = Object.fromEntries(
      results
        .filter((result): result is PromiseFulfilledResult<LabelRender> => result.status === 'fulfilled')
        .map((result) => [result.value.labelId, result.value]),
    );
    setLabelRenders(rendered);
  }

  async function refreshWsStatus(apIds = aps.map((ap) => ap.id)) {
    const statuses = await Promise.all(
      apIds.map(async (apId) => api<WsStatus>(`/api/base-stations/${encodeURIComponent(apId)}/ws-status`)),
    );
    setWsStatuses(Object.fromEntries(statuses.map((status) => [status.apId, status])));
  }

  async function refreshLogs() {
    const logsResult = await api<DeviceLog[]>(`/api/device-logs${showAllLogs ? '?all=1' : ''}`);
    setLogs(Array.isArray(logsResult) ? logsResult : []);
    setLogsLoadedAt(new Date().toLocaleTimeString());
  }

  async function saveLabel() {
    const label = await api<Label>('/api/labels', {
      method: 'POST',
      body: JSON.stringify({
        id: draftLabel.id,
        storeCode,
        title: draftLabel.title,
        price: Number(draftLabel.price),
        currency: 'CNY',
        apId: aps[0]?.id,
      }),
    });
    setLabels((current) => [label, ...current.filter((item) => item.id !== label.id)]);
    setMessage(`价签 ${label.id} 已保存`);
  }

  async function publish(label: Label) {
    setSendingLabels((current) => ({ ...current, [label.id]: true }));
    setLabelCommandStatus((current) => ({ ...current, [label.id]: '下发中...' }));
    setMessage(`正在下发：${label.id}`);

    try {
      const result = await api<LabelCommandResult>(`/api/labels/${label.id}/commands`, {
        method: 'POST',
        body: JSON.stringify({
          storeCode: label.storeCode,
          type: 'refresh_label',
          payload: {
            title: label.title,
            price: label.price,
            currency: label.currency,
          },
        }),
      });
      const statusText = result.transport === 'websocket'
        ? `图像已送达基站连接，${result.delivery?.bytes ?? 0} bytes；未收到刷屏确认`
        : `图像已发布到 EMQX：${result.status}`;
      setLabelCommandStatus((current) => ({ ...current, [label.id]: statusText }));
      setMessage(`${label.id}：${statusText}${result.execution?.reason ? `。${result.execution.reason}` : ''}`);
      await Promise.all([refreshLogs(), refresh()]);
    } catch (error) {
      const text = error instanceof Error ? error.message : '未知错误';
      setLabelCommandStatus((current) => ({ ...current, [label.id]: text }));
      setMessage(`${label.id} 下发失败：${text}`);
    } finally {
      setSendingLabels((current) => ({ ...current, [label.id]: false }));
    }
  }

  async function sendRawWsCommand() {
    if (!selectedApId) {
      setRawCommandStatus('没有选择目标基站');
      setMessage('没有选择目标基站');
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawWsCommand) as Record<string, unknown>;
    } catch {
      setRawCommandStatus('JSON 格式错误');
      setMessage('原始命令不是合法 JSON');
      return;
    }

    setSendingRawCommand(true);
    setRawCommandStatus('发送中...');
    try {
      const result = await api<{ ok: boolean; reason?: string; bytes?: number }>(
        `/api/base-stations/${encodeURIComponent(selectedApId)}/ws-command`,
        {
          method: 'POST',
          body: JSON.stringify({ payload }),
        },
      );
      const nextStatus = result.ok ? `已发送，${result.bytes ?? 0} bytes` : `未发送：${result.reason ?? '未知原因'}`;
      setRawCommandStatus(nextStatus);
      setMessage(result.ok ? `WS 命令已发送，${result.bytes ?? 0} bytes` : `WS 命令未发送：${result.reason ?? '未知原因'}`);
      await Promise.all([refreshLogs(), refreshWsStatus()]);
    } catch (error) {
      const text = error instanceof Error ? error.message : '未知错误';
      setRawCommandStatus(text);
      setMessage(text);
    } finally {
      setSendingRawCommand(false);
    }
  }

  React.useEffect(() => {
    if (tokenReady) {
      Promise.all([refresh(), refreshLogs()]).catch((error: Error) => setMessage(error.message));
    }
  }, [tokenReady]);

  React.useEffect(() => {
    if (tokenReady && aps.length > 0) {
      refreshWsStatus(aps.map((ap) => ap.id)).catch((error: Error) => setMessage(error.message));
    }
  }, [tokenReady, aps.length]);

  React.useEffect(() => {
    if (tokenReady && activeView === 'logs') {
      refreshLogs().catch((error: Error) => setMessage(error.message));
    }
  }, [showAllLogs, activeView]);

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <RadioTower size={28} />
          <div>
            <strong>Kersen ESL</strong>
            <span>Cloud Console</span>
          </div>
        </div>
        <nav>
          <button className={activeView === 'overview' ? 'active' : ''} onClick={() => setActiveView('overview')}><Activity size={18} /> 总览</button>
          <button className={activeView === 'stations' ? 'active' : ''} onClick={() => setActiveView('stations')}><RadioTower size={18} /> 基站</button>
          <button className={activeView === 'labels' ? 'active' : ''} onClick={() => setActiveView('labels')}><BadgeDollarSign size={18} /> 价签</button>
          <button className={activeView === 'cloud' ? 'active' : ''} onClick={() => setActiveView('cloud')}><Server size={18} /> 云配置</button>
          <button className={activeView === 'logs' ? 'active' : ''} onClick={() => setActiveView('logs')}><ClipboardList size={18} /> 接入日志</button>
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p>电子价签云平台</p>
            <h1>基站、价签与 MQTT 链路控制台</h1>
            <span className="globalStatus">{message}</span>
          </div>
          <button className="iconButton" onClick={() => refresh()} disabled={!tokenReady} title="刷新">
            <RefreshCcw size={18} />
          </button>
        </header>

        {activeView === 'overview' && (
          <>
            <section className="metrics">
              <article>
                <Store size={20} />
                <span>门店</span>
                <strong>{store?.code ?? storeCode}</strong>
              </article>
              <article>
                <RadioTower size={20} />
                <span>在线基站</span>
                <strong>{aps.filter((ap) => ap.status === 'online').length}/{aps.length}</strong>
              </article>
              <article>
                <BadgeDollarSign size={20} />
                <span>价签</span>
                <strong>{labels.length}</strong>
              </article>
              <article>
                <ShieldCheck size={20} />
                <span>状态</span>
                <strong>{tokenReady ? '已认证' : '未登录'}</strong>
              </article>
            </section>

            <section className="grid">
              <div className="panel loginPanel">
                <h2>平台登录</h2>
                <div className="formGrid">
                  <label>门店编号<input value={storeCode} onChange={(event) => setStoreCode(event.target.value)} /></label>
                  <label>用户名<input value={username} onChange={(event) => setUsername(event.target.value)} /></label>
                  <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
                </div>
                <button className="primary" onClick={() => login().catch((error: Error) => setMessage(error.message))}>
                  <ShieldCheck size={18} /> 登录控制台
                </button>
                <p className="statusLine">{message}</p>
              </div>

              <CloudConfig store={store} storeCode={storeCode} mqttStats={mqttStats} />
            </section>
          </>
        )}

        {activeView === 'cloud' && <CloudConfig store={store} storeCode={storeCode} mqttStats={mqttStats} detailed />}

        {activeView === 'stations' && (
          <>
            <section className="panel">
              <div className="sectionHead">
                <h2>基站</h2>
                <button className="smallButton" onClick={() => refreshWsStatus().catch((error: Error) => setMessage(error.message))}>刷新 WS 状态</button>
              </div>
              <div className="table">
                <span>名称</span><span>状态</span><span>IP</span><span>固件/通道</span><span>最后心跳</span>
                {aps.map((ap) => (
                  <React.Fragment key={ap.id}>
                    <b>{ap.name}</b>
                    <i className={ap.status}>{ap.status} · {wsStatuses[ap.id]?.connected ? 'WS在线' : 'WS离线'}</i>
                    <span>{ap.ip ?? '-'}</span>
                    <span>{ap.firmware ?? '-'} · {ap.channels?.length ?? 0} 通道 · {ap.metrics?.labelsOnline ?? 0} 价签</span>
                    <span>{ap.lastSeenAt ? new Date(ap.lastSeenAt).toLocaleString() : '-'}</span>
                  </React.Fragment>
                ))}
              </div>
            </section>

            <section className="panel">
              <h2>WebSocket 原始命令</h2>
              <div className="commandGrid">
                <label>目标基站
                  <select value={selectedApId} onChange={(event) => setSelectedApId(event.target.value)}>
                    {aps.map((ap) => <option key={ap.id} value={ap.id}>{ap.name} · {ap.id}</option>)}
                  </select>
                </label>
                <label>JSON 命令
                  <textarea value={rawWsCommand} onChange={(event) => setRawWsCommand(event.target.value)} />
                </label>
                <button className="primary" disabled={!selectedApId || sendingRawCommand} onClick={() => sendRawWsCommand()}>
                  <Send size={18} /> {sendingRawCommand ? '发送中' : '发送到基站 WS'}
                </button>
              </div>
              <p className="statusLine">发送状态：{rawCommandStatus}</p>
              <p className="statusLine">这块用于逆向验证云端下发格式。发送后去“接入日志”看 `WS-OUT /ws` 和基站后续返回。</p>
            </section>
          </>
        )}

        {activeView === 'labels' && (
          <section className="panel">
            <div className="sectionHead">
              <h2>价签</h2>
              <div className="inlineForm">
                <input value={draftLabel.id} onChange={(event) => setDraftLabel({ ...draftLabel, id: event.target.value })} />
                <input value={draftLabel.title} onChange={(event) => setDraftLabel({ ...draftLabel, title: event.target.value })} />
                <input type="number" value={draftLabel.price} onChange={(event) => setDraftLabel({ ...draftLabel, price: Number(event.target.value) })} />
                <button onClick={() => saveLabel().catch((error: Error) => setMessage(error.message))}>保存</button>
              </div>
            </div>
            <div className="labelGrid">
              {labels.map((label) => (
                <article className="labelCard" key={label.id}>
                  {labelRenders[label.id] && (
                    <img
                      className="labelPreview"
                      src={labelRenders[label.id].preview.dataUri}
                      alt={`${label.id} preview`}
                    />
                  )}
                  <span>{label.sku ?? label.id}</span>
                  <h3>{label.title}</h3>
                  <strong>{label.currency} {label.price.toFixed(2)}</strong>
                  <p>
                    {label.status} · 电量 {label.battery ?? '-'}% · RSSI {label.rssi ?? '-'}
                    {labelRenders[label.id] ? ` · ${labelRenders[label.id].width}x${labelRenders[label.id].height} · ${labelRenders[label.id].bitmap.format}` : ''}
                  </p>
                  <button disabled={Boolean(sendingLabels[label.id])} onClick={() => publish(label)}>
                    <Send size={16} /> {sendingLabels[label.id] ? '下发中' : '下发'}
                  </button>
                  <small>{labelCommandStatus[label.id] ?? '未下发'}</small>
                </article>
              ))}
            </div>
          </section>
        )}

        {activeView === 'logs' && (
          <section className="panel">
            <div className="sectionHead">
              <div>
                <h2>接入日志</h2>
                <p className="statusLine">当前 {logs.length} 条，最后刷新 {logsLoadedAt}</p>
              </div>
              <div className="toolbar">
                <label className="checkLabel"><input type="checkbox" checked={showAllLogs} onChange={(event) => setShowAllLogs(event.target.checked)} /> 显示控制台请求</label>
                <button className="smallButton" onClick={() => refreshLogs().catch((error: Error) => setMessage(error.message))}>刷新日志</button>
              </div>
            </div>
            <div className="logList">
              {logs.length === 0 && <p className="statusLine">还没有收到除控制台外的请求。基站如果真的打到 4000，这里会立刻出现路径、IP 和状态码。</p>}
              {logs.map((log) => (
                <article key={log.id}>
                  <b>{log.method} {log.path}</b>
                  <span>{log.statusCode ?? '-'} · {log.ip ?? '-'} · {new Date(log.time).toLocaleString()}</span>
                  <code>{log.userAgent ?? 'no user-agent'}</code>
                  {log.body ? <pre>{JSON.stringify(log.body, null, 2)}</pre> : null}
                </article>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

function CloudConfig({ store, storeCode, mqttStats, detailed = false }: { store: StoreConfig | null; storeCode: string; mqttStats: MqttStats | null; detailed?: boolean }) {
  return (
    <div className="panel">
      <h2>基站填写参数</h2>
      <dl className="configList">
        <dt>服务器地址</dt><dd>{store?.serverUrl ?? 'http://localhost:4000'}</dd>
        <dt>门店编号</dt><dd>{store?.code ?? storeCode}</dd>
        <dt>用户名</dt><dd>admin</dd>
        <dt>密码</dt><dd>admin123456</dd>
        <dt>MQTT TCP</dt><dd>{store?.mqttTcpPort ?? 1883}</dd>
        <dt>MQTT WebSocket</dt><dd>ws://服务器IP:4001{store?.mqttWsPath ?? '/mqtt'}</dd>
        <dt>MQTT 模式</dt><dd>{mqttStats?.mode === 'external' ? '外部 EMQX' : '内置本地 Broker'}</dd>
        <dt>EMQX 状态</dt><dd>{mqttStats?.mode === 'external' ? `${mqttStats.external.host}:${mqttStats.external.port} · ${mqttStats.external.connected ? '已连接' : '未连接'}` : '未启用外部 EMQX'}</dd>
      </dl>
      {detailed && (
        <div className="notice">
          <strong>注意</strong>
          <p>真实基站不能填 localhost。localhost 指的是基站自己，不是你的电脑或云服务器。局域网测试要填电脑 IP，例如 http://192.168.1.23:4000；AWS 上线后填你的公网域名。</p>
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
