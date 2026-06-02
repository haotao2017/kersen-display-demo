import { useState, useCallback, useMemo } from 'react';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Modal,
  Progress,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Typography,
  Divider,
  Empty,
} from 'antd';
import { ApiOutlined, BookOutlined, DeleteOutlined, SaveOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { useI18n } from '../../i18n';
import { queryKeys } from '../../utils/constants';
import {
  listTemplates,
  saveTemplate,
  deleteTemplate,
  applyTemplate,
  type MappingTemplate,
} from './mappingTemplates';

// ─── Target product fields ────────────────────────────────────────────────────
const TARGET_FIELDS = [
  { value: '__skip__',       label: '— 跳过 / Skip —' },
  { value: 'name',           label: 'Name (#name) *' },
  { value: 'sku',            label: 'Source ID (#sourceId) *' },
  { value: 'barcode',        label: 'Reference (#reference)' },
  { value: 'price',          label: 'Field 1 / Price (#field1)' },
  { value: 'promotionPrice', label: 'Field 2 / Promo Price (#field2)' },
  { value: 'memberPrice',    label: 'Member Price (#memberPrice)' },
  { value: 'originalPrice',  label: 'Original Price (#originalPrice)' },
  { value: 'subName',        label: 'Subtitle (#subName)' },
  { value: 'specification',  label: 'Specification (#specification)' },
  { value: 'unit',           label: 'Unit (#unit)' },
  { value: 'brand',          label: 'Brand (#brand)' },
  { value: 'promotionText',  label: 'Promotion Text (#promotionText)' },
  { value: 'imageUrl',       label: 'Product Image URL (#imageUrl)' },
  { value: 'status',         label: 'Status' },
  ...Array.from({ length: 22 }, (_, i) => ({
    value: `customField${i + 1}`,
    label: `Custom ${i + 1} (#customField${i + 1})`,
  })),
];

const TARGET_LABEL: Record<string, string> = Object.fromEntries(
  TARGET_FIELDS.map(f => [f.value, f.label]),
);

// ─── Auto-detect common field name aliases ────────────────────────────────────
const AUTO_MAP: Record<string, string> = {
  name: 'name', product_name: 'name', product_name_en: 'name',
  product_name_zh: 'name', title: 'name', item_name: 'name', goods_name: 'name',
  sku: 'sku', source_id: 'sku', sourceid: 'sku', item_code: 'sku',
  code: 'sku', product_code: 'sku', goods_code: 'sku',
  barcode: 'barcode', reference: 'barcode', upc: 'barcode',
  ean: 'barcode', gtin: 'barcode', ean13: 'barcode',
  price: 'price', normal_price: 'price', normalprice: 'price',
  retail_price: 'price', selling_price: 'price', active_price: 'price',
  promotion_price: 'promotionPrice', promotionprice: 'promotionPrice',
  sale_price: 'promotionPrice', promo_price: 'promotionPrice',
  member_price: 'memberPrice', memberprice: 'memberPrice',
  original_price: 'originalPrice', originalprice: 'originalPrice',
  list_price: 'originalPrice', market_price: 'originalPrice',
  brand: 'brand', vendor: 'brand', manufacturer: 'brand',
  unit: 'unit',
  specification: 'specification', spec: 'specification', package_size: 'specification',
  sub_name: 'subName', subname: 'subName', subtitle: 'subName', display_name: 'subName',
  promotion_text: 'promotionText', promotiontext: 'promotionText',
  promo_text: 'promotionText', promo_label: 'promotionText',
  promo_label_en: 'promotionText', promo_label_zh: 'promotionText',
  image_url: 'imageUrl', imageurl: 'imageUrl', image: 'imageUrl',
  img: 'imageUrl', picture: 'imageUrl', photo: 'imageUrl',
  status: 'status', is_active: 'status',
};

function autoDetectMapping(columns: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const col of columns) {
    const key = col.toLowerCase().replace(/[-\s]/g, '_');
    result[col] = AUTO_MAP[key] ?? AUTO_MAP[col.toLowerCase()] ?? '__skip__';
  }
  return result;
}

const NUMERIC_FIELDS = new Set(['price', 'promotionPrice', 'memberPrice', 'originalPrice']);

// When updating an existing product, these optional content fields get explicitly
// set to null if they are NOT part of the current import mapping.
// This ensures that changing a field's mapping (e.g. imageUrl → customField22)
// properly clears the old field instead of leaving a stale value behind.
const CLEARABLE_ON_UPDATE = [
  'imageUrl', 'promotionText', 'subName', 'specification',
  'unit', 'brand', 'barcode',
];

// ─── Types ────────────────────────────────────────────────────────────────────
interface ConnectForm { apiUrl: string; datasetId: string; apiKey: string }
interface PreviewData {
  columns: string[];
  sampleRow: Record<string, unknown>;
  totalRows: number;
}
interface ImportResult { created: number; updated: number; failed: number; errors: string[] }
interface Props { open: boolean; onClose: () => void }

// ─── Template Load Modal ──────────────────────────────────────────────────────
interface TemplateLoadModalProps {
  open: boolean;
  templates: MappingTemplate[];
  onApply: (tpl: MappingTemplate) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const TemplateLoadModal = ({ open, templates, onApply, onDelete, onClose }: TemplateLoadModalProps) => {
  const { tx } = useI18n();

  return (
    <Modal
      title={<Space><BookOutlined />{tx('加载映射模板', 'Load Mapping Template')}</Space>}
      open={open}
      onCancel={onClose}
      footer={<Button onClick={onClose}>{tx('关闭', 'Close')}</Button>}
      width={560}
    >
      {templates.length === 0 ? (
        <Empty description={tx('还没有保存过映射模板', 'No saved templates yet')} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {templates.map(tpl => (
            <div
              key={tpl.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 14px',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                background: '#fafafa',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{tpl.name}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  {tx(`${tpl.fieldCount} 个映射字段`, `${tpl.fieldCount} fields mapped`)}
                  {' · '}
                  {new Date(tpl.savedAt).toLocaleString()}
                </div>
                {/* Preview mapped field targets */}
                <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {Object.entries(tpl.mapping)
                    .filter(([, v]) => v !== '__skip__')
                    .slice(0, 6)
                    .map(([src, tgt]) => (
                      <Tag key={src} style={{ fontSize: 11, margin: 0 }}>
                        <code>{src}</code>
                        {' → '}
                        <span style={{ color: '#1677ff' }}>{TARGET_LABEL[tgt] ?? tgt}</span>
                      </Tag>
                    ))}
                  {Object.values(tpl.mapping).filter(v => v !== '__skip__').length > 6 && (
                    <Tag style={{ fontSize: 11, margin: 0 }}>
                      +{Object.values(tpl.mapping).filter(v => v !== '__skip__').length - 6} more
                    </Tag>
                  )}
                </div>
              </div>
              <Space>
                <Button type="primary" size="small" onClick={() => onApply(tpl)}>
                  {tx('应用', 'Apply')}
                </Button>
                <Button
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() => {
                    Modal.confirm({
                      title: tx(`删除模板「${tpl.name}」？`, `Delete template "${tpl.name}"?`),
                      okText: tx('删除', 'Delete'),
                      cancelText: tx('取消', 'Cancel'),
                      okButtonProps: { danger: true },
                      onOk: () => onDelete(tpl.id),
                    });
                  }}
                />
              </Space>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────
export const DataHubImportModal = ({ open, onClose }: Props) => {
  const { tx } = useI18n();
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);
  const [connectForm] = Form.useForm<ConnectForm>();
  const [saved, setSaved] = useState<ConnectForm>({ apiUrl: '', datasetId: '', apiKey: '' });
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const [fetching, setFetching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importTotal, setImportTotal] = useState(0);
  const [importPhase, setImportPhase] = useState<'loading' | 'importing'>('importing');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Template state
  const [templates, setTemplates] = useState<MappingTemplate[]>(listTemplates);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [showSaveBar, setShowSaveBar] = useState(false);
  const [saveName, setSaveName] = useState('');

  const refreshTemplates = useCallback(() => setTemplates(listTemplates()), []);

  const handleClose = useCallback(() => {
    if (importing) return;
    setStep(0);
    setPreview(null);
    setMapping({});
    setImportProgress(0);
    setImportTotal(0);
    setImportResult(null);
    setShowSaveBar(false);
    setSaveName('');
    connectForm.resetFields();
    onClose();
  }, [importing, connectForm, onClose]);

  // ── Step 0: fetch preview ─────────────────────────────────────────────────
  const handleFetch = useCallback(async (values: ConnectForm) => {
    setFetching(true);
    try {
      const base = values.apiUrl.replace(/\/+$/, '');
      const res = await fetch(
        `${base}/api/datasets/${values.datasetId.trim()}/data?page=1&limit=5`,
        { headers: { 'X-API-Key': values.apiKey.trim() } },
      );
      const json = await res.json() as {
        columns?: string[]; rows?: Record<string, unknown>[];
        error?: string; totalRows?: number;
      };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      const cols = json.columns ?? [];
      setSaved(values);
      setPreview({ columns: cols, sampleRow: json.rows?.[0] ?? {}, totalRows: json.totalRows ?? 0 });
      setMapping(autoDetectMapping(cols));
    } catch (e: any) {
      message.error(`${tx('获取失败', 'Fetch failed')}: ${e.message}`);
    } finally {
      setFetching(false);
    }
  }, [message, tx]);

  // ── Template: save ────────────────────────────────────────────────────────
  const handleSaveTemplate = useCallback(() => {
    if (!saveName.trim()) { message.warning(tx('请输入模板名称', 'Enter a template name')); return; }
    saveTemplate(saveName.trim(), mapping);
    refreshTemplates();
    setSaveName('');
    setShowSaveBar(false);
    message.success(tx(`模板「${saveName.trim()}」已保存`, `Template "${saveName.trim()}" saved`));
  }, [saveName, mapping, refreshTemplates, message, tx]);

  // ── Template: apply ───────────────────────────────────────────────────────
  const handleApplyTemplate = useCallback((tpl: MappingTemplate) => {
    const applied = applyTemplate(tpl, preview?.columns ?? []);
    setMapping(applied);
    setShowLoadModal(false);

    const matchedCount = Object.values(applied).filter(v => v !== '__skip__').length;
    const totalCols = (preview?.columns ?? []).length;
    message.success(
      tx(
        `已应用模板「${tpl.name}」，${totalCols} 个字段中匹配 ${matchedCount} 个`,
        `Template "${tpl.name}" applied — ${matchedCount} of ${totalCols} columns matched`,
      ),
    );
  }, [preview, message, tx]);

  // ── Template: delete ──────────────────────────────────────────────────────
  const handleDeleteTemplate = useCallback((id: string) => {
    deleteTemplate(id);
    refreshTemplates();
    message.success(tx('模板已删除', 'Template deleted'));
  }, [refreshTemplates, message, tx]);

  // ── Step 2: import (upsert by SKU) ───────────────────────────────────────
  const handleImport = useCallback(async () => {
    setImporting(true);
    setImportProgress(0);
    setImportResult(null);

    try {
      // ── Phase 1: fetch DataHub rows ──────────────────────────────────────
      setImportPhase('loading');
      const base = saved.apiUrl.replace(/\/+$/, '');
      let allRows: Record<string, unknown>[] = [];
      let page = 1;

      while (allRows.length < (preview?.totalRows ?? 0) && allRows.length < 5000) {
        const res = await fetch(
          `${base}/api/datasets/${saved.datasetId.trim()}/data?page=${page}&limit=1000`,
          { headers: { 'X-API-Key': saved.apiKey.trim() } },
        );
        if (!res.ok) throw new Error(`Fetch page ${page} failed: HTTP ${res.status}`);
        const json = await res.json() as { rows: Record<string, unknown>[]; totalRows: number };
        if (!json.rows?.length) break;
        allRows = [...allRows, ...json.rows];
        page++;
      }

      // ── Phase 2: load existing products → build sku/barcode→id map ────────
      setImportPhase('importing');
      // 同时索引 sku 和 barcode（均 trim），确保换了字段映射后也能命中已有记录
      const existingProductMap: Record<string, string> = {};
      const addToMap = (val: unknown, id: string) => {
        const k = String(val ?? '').trim();
        if (k) existingProductMap[k] = id;
      };
      let existingPage = 1;
      while (true) {
        const res = await api.products({ pageSize: 1000, page: existingPage }) as unknown as {
          items: { id: string; sku: string; barcode?: string }[];
          total: number;
        };
        for (const prod of res.items) {
          addToMap(prod.sku, prod.id);
          const bar = String(prod.barcode ?? '').trim();
          const sku = String(prod.sku ?? '').trim();
          if (bar && bar !== sku) addToMap(bar, prod.id);
        }
        if (res.items.length < 1000) break;
        existingPage++;
      }

      // ── Phase 3: upsert rows ─────────────────────────────────────────────
      setImportTotal(allRows.length);

      let created = 0, updated = 0, failed = 0;
      const errors: string[] = [];

      for (let i = 0; i < allRows.length; i++) {
        const row = allRows[i];
        const payload: Record<string, any> = { customFields: {} };

        for (const [sourceCol, targetField] of Object.entries(mapping)) {
          if (targetField === '__skip__') continue;
          const strVal = row[sourceCol] === null || row[sourceCol] === undefined
            ? '' : String(row[sourceCol]).trim();   // trim 防止空格导致 lookup miss
          if (targetField.startsWith('customField')) {
            payload.customFields[targetField] = strVal;
          } else if (NUMERIC_FIELDS.has(targetField)) {
            const num = parseFloat(strVal);
            payload[targetField] = Number.isNaN(num) ? 0 : num;
          } else {
            payload[targetField] = strVal;
          }
        }

        try {
          const skuVal: string = String(payload.sku ?? '').trim();
          const barcodeVal: string = String(payload.barcode ?? '').trim();
          // sku 优先匹配，其次 barcode，确保换字段映射也能正确 update
          const existingId = (skuVal && existingProductMap[skuVal])
            || (barcodeVal && existingProductMap[barcodeVal])
            || undefined;

          if (existingId) {
            // Build update payload: for optional content fields that are NOT in
            // the current mapping, send null so stale values (e.g. old imageUrl
            // after remapping to customField22) are cleared on the backend.
            const updatePayload = { ...payload };
            for (const f of CLEARABLE_ON_UPDATE) {
              if (!(f in updatePayload)) {
                updatePayload[f] = null;
              }
            }
            await api.updateProduct(existingId, updatePayload);
            updated++;
          } else {
            // New products default to active if status is not mapped
            if (!('status' in payload)) payload.status = 'active';
            try {
              const newProd = await api.createProduct(payload) as any;
              created++;
              // 回写 map，防止同批次后续行因 sku/barcode 冲突走 create 失败
              if (newProd?.id) {
                addToMap(newProd.sku ?? skuVal, newProd.id);
                addToMap(newProd.barcode ?? barcodeVal, newProd.id);
              }
            } catch (createErr: any) {
              // 如果是重复冲突，在已有 map 里扫描并 update（兜底逻辑）
              const isDup = (createErr?.response?.data?.message ?? '').includes('已存在相同来源编号');
              if (isDup) {
                // 遍历 map，找 payload 中任意标识字段命中的 id
                const candidates = new Set<string>();
                if (skuVal && existingProductMap[skuVal]) candidates.add(existingProductMap[skuVal]);
                if (barcodeVal && existingProductMap[barcodeVal]) candidates.add(existingProductMap[barcodeVal]);
                // 若 map 里还没有（首次在本批新建后被占用），重新拉一页搜索
                if (candidates.size === 0 && (skuVal || barcodeVal)) {
                  const scanRes = await api.products({ pageSize: 200, keyword: skuVal || barcodeVal }) as unknown as {
                    items: { id: string; sku: string; barcode?: string }[];
                  };
                  for (const p of scanRes.items ?? []) {
                    const pSku = String(p.sku ?? '').trim();
                    const pBar = String(p.barcode ?? '').trim();
                    if ((skuVal && (pSku === skuVal || pBar === skuVal))
                      || (barcodeVal && (pSku === barcodeVal || pBar === barcodeVal))) {
                      candidates.add(p.id);
                      addToMap(pSku, p.id);
                      addToMap(pBar, p.id);
                    }
                  }
                }
                if (candidates.size > 0) {
                  const targetId = [...candidates][0];
                  // Use updatePayload (with nulls for unmapped content fields)
                  const updatePayload = { ...payload };
                  for (const f of CLEARABLE_ON_UPDATE) {
                    if (!(f in updatePayload)) updatePayload[f] = null;
                  }
                  await api.updateProduct(targetId, updatePayload);
                  updated++;
                } else {
                  throw createErr;
                }
              } else {
                throw createErr;
              }
            }
          }
        } catch (e: any) {
          failed++;
          if (errors.length < 10) {
            const label = payload.name || payload.sku || `row ${i + 1}`;
            errors.push(`${label}: ${e?.response?.data?.message ?? e.message}`);
          }
        }

        setImportProgress(i + 1);
      }

      setImportResult({ created, updated, failed, errors });
      queryClient.invalidateQueries({ queryKey: queryKeys.products });
    } catch (e: any) {
      message.error(`${tx('导入出错', 'Import error')}: ${e.message}`);
    } finally {
      setImporting(false);
    }
  }, [saved, preview, mapping, queryClient, message, tx]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const mappedValues = Object.values(mapping);
  const needsName = !mappedValues.includes('name');
  const needsSku  = !mappedValues.includes('sku');
  const canProceed = !needsName && !needsSku;
  const mappedFieldCount = mappedValues.filter(v => v !== '__skip__').length;
  const progressPct = importTotal > 0 ? Math.round((importProgress / importTotal) * 100) : 0;

  const mappingRows = useMemo(() =>
    (preview?.columns ?? []).map(col => ({
      key: col,
      col,
      sample: String(preview?.sampleRow[col] ?? '').slice(0, 60),
      target: mapping[col] ?? '__skip__',
    })),
  [preview, mapping]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <Modal
        title={<Space><ApiOutlined />{tx('从 DataHub API 导入数据', 'Import from DataHub API')}</Space>}
        open={open}
        onCancel={handleClose}
        footer={null}
        width={800}
        destroyOnClose
      >
        <Steps
          current={step}
          style={{ marginBottom: 28 }}
          items={[
            { title: tx('连接', 'Connect') },
            { title: tx('映射字段', 'Map Fields') },
            { title: tx('导入', 'Import') },
          ]}
        />

        {/* ── Step 0: Connect ── */}
        {step === 0 && (
          <div>
            <Form
              form={connectForm}
              layout="vertical"
              initialValues={{ apiUrl: 'https://data-hub-api.hunter-hao-t.workers.dev' }}
              onFinish={handleFetch}
            >
              <Form.Item name="apiUrl" label={tx('API 地址', 'API Base URL')} rules={[{ required: true }]}>
                <Input placeholder="https://data-hub-api.xxx.workers.dev" />
              </Form.Item>
              <Form.Item name="datasetId" label={tx('数据集 ID', 'Dataset ID')} rules={[{ required: true }]}>
                <Input placeholder="kaiuwKAoxMK4gvaq" />
              </Form.Item>
              <Form.Item name="apiKey" label="API Key" rules={[{ required: true }]}>
                <Input.Password placeholder="dk_xxxxxxxxxxxxxxxx" />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={fetching}>
                {tx('获取数据预览', 'Fetch Preview')}
              </Button>
            </Form>

            {preview && (
              <div style={{ marginTop: 20 }}>
                <Alert
                  type="success"
                  showIcon
                  message={tx(
                    `获取成功：共 ${preview.totalRows.toLocaleString()} 行，${preview.columns.length} 列`,
                    `Fetched: ${preview.totalRows.toLocaleString()} rows · ${preview.columns.length} columns`,
                  )}
                />
                <div style={{ marginTop: 12 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {tx('包含字段：', 'Columns: ')}
                  </Typography.Text>
                  <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {preview.columns.map(col => (
                      <Tag key={col} style={{ fontFamily: 'monospace', fontSize: 12 }}>{col}</Tag>
                    ))}
                  </div>
                </div>
                <div style={{ marginTop: 20, textAlign: 'right' }}>
                  <Button type="primary" onClick={() => setStep(1)}>
                    {tx('下一步：映射字段', 'Next: Map Fields')} →
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Step 1: Map Fields ── */}
        {step === 1 && (
          <div>
            {/* Template toolbar */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              marginBottom: 12, padding: '8px 12px',
              background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8,
            }}>
              <BookOutlined style={{ color: '#6b7280' }} />
              <Typography.Text style={{ fontSize: 13, color: '#374151' }}>
                {tx('映射模板', 'Templates')}
              </Typography.Text>
              <Button
                size="small"
                onClick={() => { setShowLoadModal(true); refreshTemplates(); }}
              >
                {tx('加载模板', 'Load Template')}
                {templates.length > 0 && (
                  <Tag
                    style={{ marginLeft: 4, fontSize: 11, lineHeight: '16px',
                             padding: '0 4px', borderRadius: 8, marginRight: 0 }}
                  >
                    {templates.length}
                  </Tag>
                )}
              </Button>
              <Button
                size="small"
                icon={<SaveOutlined />}
                onClick={() => { setShowSaveBar(s => !s); setSaveName(''); }}
              >
                {tx('另存为模板', 'Save as Template')}
              </Button>
              <div style={{ marginLeft: 'auto', fontSize: 12, color: '#9ca3af' }}>
                {tx(`已映射 ${mappedFieldCount} / ${(preview?.columns ?? []).length} 个字段`,
                    `${mappedFieldCount} / ${(preview?.columns ?? []).length} fields mapped`)}
              </div>
            </div>

            {/* Inline save bar */}
            {showSaveBar && (
              <div style={{
                display: 'flex', gap: 8, alignItems: 'center',
                padding: '8px 12px', marginBottom: 12,
                background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8,
              }}>
                <Typography.Text style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                  {tx('模板名称：', 'Template name:')}
                </Typography.Text>
                <Input
                  size="small"
                  style={{ flex: 1 }}
                  placeholder={tx('如：超市商品模板', 'e.g. Supermarket Template')}
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                  onPressEnter={handleSaveTemplate}
                  autoFocus
                />
                <Button size="small" type="primary" onClick={handleSaveTemplate}>
                  {tx('保存', 'Save')}
                </Button>
                <Button size="small" onClick={() => setShowSaveBar(false)}>
                  {tx('取消', 'Cancel')}
                </Button>
              </div>
            )}

            {/* Required fields warning */}
            {(needsName || needsSku) && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message={tx(
                  `请映射必填字段：${[needsName && 'Name (#name)', needsSku && 'Source ID (#sourceId)'].filter(Boolean).join('、')}`,
                  `Map required fields: ${[needsName && 'Name (#name)', needsSku && 'Source ID (#sourceId)'].filter(Boolean).join(', ')}`,
                )}
              />
            )}

            {/* Mapping table */}
            <Table
              dataSource={mappingRows}
              pagination={false}
              size="small"
              scroll={{ y: 340 }}
              columns={[
                {
                  title: tx('来源字段', 'Source Field'),
                  dataIndex: 'col',
                  width: 180,
                  render: (v: string) => (
                    <code style={{
                      fontSize: 12, background: '#f3f4f6', padding: '2px 6px',
                      borderRadius: 4, display: 'block', maxWidth: 160,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }} title={v}>{v}</code>
                  ),
                },
                {
                  title: tx('示例值', 'Sample Value'),
                  dataIndex: 'sample',
                  ellipsis: true,
                  render: (v: string) => (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {v || '—'}
                    </Typography.Text>
                  ),
                },
                {
                  title: tx('映射到数据源字段', 'Map To'),
                  dataIndex: 'target',
                  width: 255,
                  render: (val: string, record: { col: string }) => (
                    <Select
                      value={val}
                      size="small"
                      style={{ width: '100%' }}
                      options={TARGET_FIELDS}
                      onChange={v => setMapping(m => ({ ...m, [record.col]: v }))}
                      showSearch
                      filterOption={(input, opt) =>
                        (opt?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
                      }
                    />
                  ),
                },
              ]}
            />

            <Divider style={{ margin: '12px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Button onClick={() => setStep(0)}>{tx('← 返回', '← Back')}</Button>
              <Button type="primary" disabled={!canProceed} onClick={() => setStep(2)}>
                {tx(
                  `下一步：导入 ${(preview?.totalRows ?? 0).toLocaleString()} 条`,
                  `Next: Import ${(preview?.totalRows ?? 0).toLocaleString()} rows`,
                )} →
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2: Import ── */}
        {step === 2 && (
          <div>
            {!importResult && !importing && (
              <div style={{ marginBottom: 20 }}>
                <Alert
                  type="info"
                  showIcon
                  message={tx(
                    `即将导入 ${(preview?.totalRows ?? 0).toLocaleString()} 条数据`,
                    `About to import ${(preview?.totalRows ?? 0).toLocaleString()} rows`,
                  )}
                  description={tx(
                    '导入过程中请勿关闭此窗口。若 Source ID 或 Reference 已存在，将自动更新该记录；未映射的可选字段将被清空。',
                    'Do not close this window. Rows matching an existing Source ID or Reference will be updated automatically. Unmapped optional fields on existing records will be cleared.',
                  )}
                />
                {/* Mapping summary — shows WHICH fields will be imported so user
                    can confirm the mapping is correct (not "N failed"). */}
                <div style={{
                  marginTop: 10, padding: '10px 14px',
                  background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8,
                }}>
                  <Typography.Text style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
                    {tx(
                      `✓ 将写入以下 ${mappedFieldCount} 个字段（其余来源列已跳过）`,
                      `✓ ${mappedFieldCount} fields will be written (other source columns are skipped)`,
                    )}
                  </Typography.Text>
                  <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {Object.entries(mapping)
                      .filter(([, v]) => v !== '__skip__')
                      .map(([src, tgt]) => (
                        <Tag key={src} color="blue" style={{ fontSize: 11, margin: 0 }}>
                          <code style={{ fontSize: 10 }}>{src}</code>
                          {' → '}
                          <span>{TARGET_LABEL[tgt] ?? tgt}</span>
                        </Tag>
                      ))}
                  </div>
                </div>
              </div>
            )}

            {(importing || importResult) && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Typography.Text>
                    {importing
                      ? importPhase === 'loading'
                        ? tx('正在拉取数据…', 'Fetching data…')
                        : tx(`导入中… ${importProgress} / ${importTotal}`, `Importing… ${importProgress} / ${importTotal}`)
                      : tx('导入完成', 'Import complete')}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{progressPct}%</Typography.Text>
                </div>
                <Progress
                  percent={progressPct}
                  status={importing ? 'active' : importResult?.failed === 0 ? 'success' : 'exception'}
                />
              </div>
            )}

            {importResult && (
              <Space direction="vertical" style={{ width: '100%', marginBottom: 20 }}>
                <Alert
                  showIcon
                  type={importResult.failed === 0 ? 'success' : 'warning'}
                  message={tx(
                    `完成：新增 ${importResult.created} 条，更新 ${importResult.updated} 条，失败 ${importResult.failed} 条`,
                    `Done: ${importResult.created} created · ${importResult.updated} updated · ${importResult.failed} failed`,
                  )}
                />
                {importResult.errors.length > 0 && (
                  <div style={{
                    background: '#fff2f0', border: '1px solid #ffccc7',
                    borderRadius: 6, padding: '8px 12px',
                  }}>
                    <Typography.Text style={{ fontSize: 12, color: '#cf1322', display: 'block', marginBottom: 4 }}>
                      {tx('错误详情（最多 10 条）', 'Error details (up to 10 shown)')}
                    </Typography.Text>
                    {importResult.errors.map((err, i) => (
                      <div key={i} style={{ fontSize: 12, color: '#cf1322', lineHeight: '20px' }}>• {err}</div>
                    ))}
                  </div>
                )}
              </Space>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Button onClick={() => setStep(1)} disabled={importing}>{tx('← 返回', '← Back')}</Button>
              <Space>
                {!importResult && (
                  <Button type="primary" loading={importing} onClick={handleImport}>
                    {tx('开始导入', 'Start Import')}
                  </Button>
                )}
                {importResult && (
                  <Button type="primary" onClick={handleClose}>{tx('完成', 'Done')}</Button>
                )}
              </Space>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Template load modal ── */}
      <TemplateLoadModal
        open={showLoadModal}
        templates={templates}
        onApply={handleApplyTemplate}
        onDelete={handleDeleteTemplate}
        onClose={() => setShowLoadModal(false)}
      />
    </>
  );
};
