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
  const [wsStatuses, setWsStatuses] = React.useState<Record<string, WsStatus>>({});
  const [selectedApId, setSelectedApId] = React.useState('');
  const [rawWsCommand, setRawWsCommand] = React.useState('{\n  "type": "DEVICE_RETRIEVE"\n}');
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
    const [storeResult, apsResult, labelsResult] = await Promise.all([
      api<StoreConfig>(`/api/stores/${storeCode}`),
      api<BaseStation[]>('/api/base-stations'),
      api<Label[]>('/api/labels'),
    ]);
    setStore(storeResult);
    setAps(apsResult);
    setLabels(labelsResult);
    setSelectedApId((current) => current || apsResult.find((ap) => ap.status === 'online')?.id || apsResult[0]?.id || '');
    setMessage(`刷新完成：${new Date().toLocaleTimeString()}`);
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
    const result = await api<{ transport?: string; delivery?: { ok?: boolean; reason?: string } }>(`/api/labels/${label.id}/commands`, {
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
    setMessage(result?.delivery?.ok ? `已通过 WebSocket 下发：${label.id}` : `已排队下发：${label.id}`);
  }

  async function sendRawWsCommand() {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawWsCommand) as Record<string, unknown>;
    } catch {
      setMessage('原始命令不是合法 JSON');
      return;
    }

    const result = await api<{ ok: boolean; reason?: string; bytes?: number }>(
      `/api/base-stations/${encodeURIComponent(selectedApId)}/ws-command`,
      {
        method: 'POST',
        body: JSON.stringify({ payload }),
      },
    );
    setMessage(result.ok ? `WS 命令已发送，${result.bytes ?? 0} bytes` : `WS 命令未发送：${result.reason ?? '未知原因'}`);
    await Promise.all([refreshLogs(), refreshWsStatus()]);
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

              <CloudConfig store={store} storeCode={storeCode} />
            </section>
          </>
        )}

        {activeView === 'cloud' && <CloudConfig store={store} storeCode={storeCode} detailed />}

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
                <button className="primary" disabled={!selectedApId} onClick={() => sendRawWsCommand().catch((error: Error) => setMessage(error.message))}>
                  <Send size={18} /> 发送到基站 WS
                </button>
              </div>
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
                  <span>{label.sku ?? label.id}</span>
                  <h3>{label.title}</h3>
                  <strong>{label.currency} {label.price.toFixed(2)}</strong>
                  <p>{label.status} · 电量 {label.battery ?? '-'}% · RSSI {label.rssi ?? '-'}</p>
                  <button onClick={() => publish(label).catch((error: Error) => setMessage(error.message))}>
                    <Send size={16} /> 下发
                  </button>
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

function CloudConfig({ store, storeCode, detailed = false }: { store: StoreConfig | null; storeCode: string; detailed?: boolean }) {
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
