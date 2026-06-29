import { App, Button, Card, Descriptions, Form, Input, Modal, Segmented, Select, Space, Table, Tag, Typography, Upload } from 'antd';
import { DownloadOutlined, FileExcelOutlined, UploadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { api } from '../../api';
import { useAppStore } from '../../app/store';
import { useI18n } from '../../i18n';
import { queryKeys } from '../../utils/constants';

const DEFAULT_PAGE_SIZE = 50;

export const EslDeviceListPage = () => {
  const { tx } = useI18n();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const currentUser = useAppStore((state) => state.user);
  const isAdmin = currentUser?.role === 'ADMIN';
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [bindTarget, setBindTarget] = useState<any | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [batchBindOpen, setBatchBindOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [bindForm] = Form.useForm();
  const [batchBindForm] = Form.useForm();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    success: number; failed: number; refreshed: number;
    errors: Array<{ row: number; eslCode: string; reason: string }>;
  } | null>(null);
  const [filters, setFilters] = useState<{ storeCode?: string; apId?: string; keyword?: string; ownerUserId?: string; group?: string }>({});
  // 合并后的单一筛选：先选筛选字段，再选/输入对应的值
  type FilterField = 'keyword' | 'storeCode' | 'apId' | 'group' | 'ownerUserId';
  const [filterField, setFilterField] = useState<FilterField>('keyword');
  const [pagination, setPagination] = useState({ current: 1, pageSize: DEFAULT_PAGE_SIZE });
  // 切换筛选字段时清空已有筛选，保证“选哪个就只按哪个字段筛”
  const changeFilterField = (field: FilterField) => {
    setFilterField(field);
    setPagination((current) => ({ ...current, current: 1 }));
    setSelectedRowKeys([]);
    setFilters({});
  };
  // 设置当前筛选字段的值（单一维度筛选）
  const setFilterValue = (value?: string) => {
    setPagination((current) => ({ ...current, current: 1 }));
    setSelectedRowKeys([]);
    setFilters(value ? { [filterField]: value } : {});
  };
  const { data, isPending } = useQuery({
    queryKey: [...queryKeys.devices, filters, pagination],
    queryFn: () => api.devices({ ...filters, page: pagination.current, pageSize: pagination.pageSize }),
    refetchInterval: 30_000,
    placeholderData: (previous) => previous,
  });
  const { data: products } = useQuery({ queryKey: [...queryKeys.products, 'options'], queryFn: () => api.products({ pageSize: 2000 }) });
  const { data: templates } = useQuery({ queryKey: [...queryKeys.templates, 'options'], queryFn: () => api.templates({ pageSize: 2000 }) });
  const { data: aps } = useQuery({ queryKey: [...queryKeys.aps, 'options'], queryFn: () => api.aps({ pageSize: 200 }), refetchInterval: 30_000 });
  const { data: stores } = useQuery({ queryKey: [...queryKeys.stores, 'options'], queryFn: () => api.stores({ pageSize: 200 }), refetchInterval: 60_000 });
  const { data: users } = useQuery({ queryKey: queryKeys.users, queryFn: () => api.users({ pageSize: 200 }), enabled: isAdmin });
  const { data: groups } = useQuery({ queryKey: [...queryKeys.devices, 'groups'], queryFn: () => api.deviceGroups(), refetchInterval: 60_000 });
  const create = useMutation({
    mutationFn: api.createDevice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      setCreateOpen(false);
      createForm.resetFields();
      message.success(tx('设备已添加', 'Device added'));
    },
  });
  const update = useMutation({
    mutationFn: ({
      id,
      values,
    }: {
      id: string;
      values: { eslCode: string; name: string; apId?: string; productId?: string; templateId?: string; group?: string };
    }) => api.updateDevice(id, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      setEditTarget(null);
      editForm.resetFields();
      message.success(tx('显示节点已更新', 'Display node updated'));
    },
  });
  const bind = useMutation({
    mutationFn: ({ id, values }: { id: string; values: { productId: string; templateId?: string } }) => api.bindDevice(id, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      setBindTarget(null);
      bindForm.resetFields();
      message.success(tx('设备已绑定', 'Device bound'));
    },
  });
  const batchBind = useMutation({
    mutationFn: api.batchBindDevices,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      setSelectedRowKeys([]);
      setBatchBindOpen(false);
      batchBindForm.resetFields();
      message.success(tx(`已更新 ${result.updatedCount} 个显示节点`, `${result.updatedCount} display node(s) updated`));
    },
    onError: (error: any) => message.error(error?.response?.data?.message ?? tx('批量绑定失败', 'Batch bind failed')),
  });
  const batchUnbind = useMutation({
    mutationFn: api.batchUnbindDevices,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      setSelectedRowKeys([]);
      message.success(tx(`已解绑 ${result.updatedCount} 个显示节点`, `${result.updatedCount} display node(s) unbound`));
    },
    onError: (error: any) => message.error(error?.response?.data?.message ?? tx('批量解绑失败', 'Batch unbind failed')),
  });
  const refresh = useMutation({
    mutationFn: api.refreshDevice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      message.success(tx('已提交设备刷新', 'Device refresh submitted'));
    },
  });
  const silentWake = useMutation({
    mutationFn: ({ id, apId }: { id: string; apId?: string }) => api.silentWakeDevice(id, { apId, waitMs: 8000 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      message.success(tx('已提交唤醒请求', 'Wake request submitted'));
    },
    onError: (error: any) => {
      const raw = String(error?.userMessage ?? error?.message ?? '');
      message.error(raw.includes('没有可用') || raw.includes('no_online_ap')
        ? tx('没有可用基站，唤醒未发送。', 'No available station. Wake request was not sent.')
        : tx('唤醒失败，请稍后重试。', 'Wake request failed. Please retry later.'));
    },
  });
  const unbind = useMutation({
    mutationFn: api.unbindDevice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      message.success(tx('设备已解绑', 'Device unbound'));
    },
  });
  const deleteOne = useMutation({
    mutationFn: api.deleteDevice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      message.success(tx('显示节点已删除', 'Display node deleted'));
    },
    onError: (error: any) => message.error(error?.response?.data?.message ?? tx('删除显示节点失败', 'Failed to delete display node')),
  });
  const batchDelete = useMutation({
    mutationFn: api.batchDeleteDevices,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      setSelectedRowKeys([]);
      message.success(tx(`已删除 ${result.deletedCount} 个显示节点`, `${result.deletedCount} display node(s) deleted`));
    },
    onError: (error: any) => message.error(error?.response?.data?.message ?? tx('批量删除失败', 'Batch delete failed')),
  });
  const productOptions = useMemo(() => (products?.items ?? []).map((item: any) => ({
    label: item.sku ? `${item.name}  ·  ${item.sku}` : item.name,
    value: item.id,
  })), [products]);
  const templateOptions = useMemo(() => (templates?.items ?? []).map((item: any) => ({ label: item.name, value: item.id })), [templates]);
  const storeOptions = useMemo(() => (stores?.items ?? []).map((item: any) => ({ label: `${item.name} / ${item.code}`, value: item.code })), [stores]);
  const userOptions = useMemo(() => (users?.items ?? []).map((user) => ({ label: `${user.displayName || user.username} / ${user.username}`, value: user.id })), [users]);
  const groupOptions = useMemo(() => (groups?.items ?? []).map((g) => ({ label: g, value: g })), [groups]);
  const apOptions = useMemo(() => (aps?.items ?? [])
    .filter((item: any) => !filters.storeCode || item.storeCode === filters.storeCode)
    .map((item: any) => ({ label: `${item.storeName ?? item.storeCode} / ${item.apCode} / ${item.name}`, value: item.id })), [aps, filters.storeCode]);
  const selectedIds = selectedRowKeys.map(String);
  const selectedRows = useMemo(() => (data?.items ?? []).filter((item: any) => selectedIds.includes(item.id)), [data, selectedIds]);
  const describeDeviceImpact = (rows: any[]) => {
    const withProduct = rows.filter((row) => row.productId).length;
    const withTemplate = rows.filter((row) => row.templateId).length;
    const withAp = rows.filter((row) => row.apId).length;
    return tx(
      `将删除 ${rows.length} 个显示节点。删除后只移除显示节点记录，并解除它们与商品、模板、基站、任务的关联；不会删除商品、模板或基站。当前有关联：商品 ${withProduct} 个，模板 ${withTemplate} 个，基站 ${withAp} 个。`,
      `This deletes ${rows.length} display node(s). It only removes node records and clears links to data sources, templates, stations, and tasks. Data sources, templates, and stations are kept. Linked now: ${withProduct} data source(s), ${withTemplate} template(s), ${withAp} station(s).`,
    );
  };
  // ── Export ──────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    setExporting(true);
    try {
      let rows: any[];
      if (selectedIds.length > 0) {
        rows = selectedRows;
      } else {
        // Export all devices matching current filters
        const all = await api.devices({ ...filters, pageSize: 2000 }) as any;
        rows = all.items ?? [];
      }
      const sheetData = rows.map((d: any) => ({
        'Device Code *': d.eslCode ?? '',
        'AP Code *':     d.ap?.apCode ?? '',
        'Device Name':   d.name ?? '',
        '分组 Group':     d.group ?? '',
        'Data Source ID': d.product?.id ?? '',
        'Template ID':    d.template?.id ?? '',
      }));
      const ws = XLSX.utils.json_to_sheet(sheetData);
      ws['!cols'] = [20, 20, 24, 14, 30, 30].map(wch => ({ wch }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Display Nodes');
      XLSX.writeFile(wb, `display_nodes_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e: any) {
      message.error(tx('导出失败', 'Export failed') + ': ' + e.message);
    } finally {
      setExporting(false);
    }
  };

  // ── Template download ─────────────────────────────────────────────────────
  const handleDownloadTemplate = () => {
    const example = [{
      'Device Code *': 'ESL000001',
      'AP Code *':     'AP-01',
      'Device Name':   tx('示例节点（可留空）', 'Sample node (optional)'),
      '分组 Group':     tx('超市', 'Store-A'),
      'Data Source ID': '',
      'Template ID':    '',
    }];
    const ws = XLSX.utils.json_to_sheet(example);
    ws['!cols'] = [20, 20, 24, 14, 30, 30].map(wch => ({ wch }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Display Nodes');
    XLSX.writeFile(wb, 'display_nodes_template.xlsx');
  };

  // ── Import ──────────────────────────────────────────────────────────────────
  const handleImport = async (file: File) => {
    setImporting(true);
    try {
      // Parse Excel
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });
      if (!rawRows.length) { message.warning(tx('文件中没有数据', 'No data found in file')); return; }

      // Helper: flexible column lookup (exact → case-insensitive partial)
      const col = (row: Record<string, any>, ...keys: string[]) => {
        for (const k of keys) {
          if (row[k] !== undefined && String(row[k]).trim()) return String(row[k]).trim();
          const found = Object.keys(row).find(rk => rk.toLowerCase().replace(/[* ]/g, '') === k.toLowerCase().replace(/[* ]/g, ''));
          if (found && String(row[found]).trim()) return String(row[found]).trim();
        }
        return '';
      };

      // Load reference data for lookups
      const [apsData, prodsData, tmplData, devsData] = await Promise.all([
        api.aps({ pageSize: 2000 }) as any,
        api.products({ pageSize: 2000 }) as any,
        api.templates({ pageSize: 2000 }) as any,
        api.devices({ pageSize: 2000 }) as any,
      ]);

      const apByCode  = new Map<string, any>((apsData.items ?? []).map((a: any) => [String(a.apCode ?? '').toLowerCase().trim(), a]));
      const apByName  = new Map<string, any>((apsData.items ?? []).map((a: any) => [String(a.name  ?? '').toLowerCase().trim(), a]));
      const prodById  = new Map<string, any>((prodsData.items ?? []).map((p: any) => [String(p.id ?? '').trim(), p]));
      const tmplById  = new Map<string, any>((tmplData.items  ?? []).map((t: any) => [String(t.id ?? '').trim(), t]));
      const devByCode = new Map<string, any>((devsData.items  ?? []).map((d: any) => [String(d.eslCode ?? '').toLowerCase().trim(), d]));

      let success = 0, failed = 0, refreshed = 0;
      const errors: Array<{ row: number; eslCode: string; reason: string }> = [];

      for (let i = 0; i < rawRows.length; i++) {
        const row = rawRows[i];
        const eslCode  = col(row, 'Device Code *', 'DeviceCode*', 'eslCode', '设备编号');
        const apCode   = col(row, 'AP Code *', 'APCode*', 'apCode', '所属基站编号');
        const devName  = col(row, 'Device Name', 'deviceName', '设备名称');
        const group    = col(row, '分组 Group', 'Group', '分组', 'group').slice(0, 10);
        const prodId = col(row, 'Data Source ID', 'DataSourceID', '数据源ID');
        const tmplId = col(row, 'Template ID', 'TemplateID', '模板ID');

        if (!eslCode) {
          failed++;
          errors.push({ row: i + 2, eslCode: '-', reason: tx('缺少设备编号', 'Missing device code') });
          continue;
        }

        try {
          // Resolve AP (warn but don't block if missing)
          const ap = apByCode.get(apCode.toLowerCase()) ?? apByName.get(apCode.toLowerCase()) ?? null;
          if (apCode && !ap) {
            errors.push({ row: i + 2, eslCode, reason: tx(`基站 "${apCode}" 不存在，已忽略基站绑定`, `AP "${apCode}" not found, AP binding skipped`) });
          }

          // Create or update device (ownership follows the current logged-in user automatically)
          const existing = devByCode.get(eslCode.toLowerCase());
          let deviceId: string;
          if (existing) {
            await api.updateDevice(existing.id, {
              eslCode: existing.eslCode,
              name: devName || existing.name || eslCode,
              apId: ap ? ap.id : (existing.apId ?? null),
              // 仅在填写了分组时更新，留空则保留原有分组
              ...(group ? { group } : {}),
            });
            deviceId = existing.id;
          } else {
            const created = await api.createDevice({ eslCode, name: devName || eslCode, apId: ap?.id, ...(group ? { group } : {}) }) as any;
            deviceId = created.id;
            devByCode.set(eslCode.toLowerCase(), created);
          }

          // Match strictly by ID only
          const product  = prodId ? prodById.get(prodId) ?? null : null;
          const template = tmplId ? tmplById.get(tmplId) ?? null : null;

          if (product) {
            // 绑定数据齐全且有效时（商品存在且为 active、且有可用模板），导入即生成刷新任务，
            // 无论是更新已有价签还是新增价签都会下发；否则只建立绑定关系、不下发。
            const effectiveTemplateId = template?.id ?? product.defaultTemplateId ?? undefined;
            const productActive = product.status === 'active' || String(product.status) === '1';
            const shouldRefresh = Boolean(effectiveTemplateId) && productActive;
            await api.bindDevice(deviceId, { productId: product.id, templateId: template?.id, autoRefresh: shouldRefresh });
            if (shouldRefresh) refreshed++;
          }

          success++;
        } catch (e: any) {
          failed++;
          errors.push({ row: i + 2, eslCode, reason: e?.response?.data?.message ?? e.message ?? 'Unknown error' });
        }
      }

      queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      setImportResult({ success, failed, refreshed, errors });
    } catch (e: any) {
      message.error(tx('导入失败', 'Import failed') + ': ' + e.message);
    } finally {
      setImporting(false);
    }
    return false; // prevent antd Upload auto-upload
  };

  const ownerColumn = isAdmin ? {
    title: tx('归属账号', 'Owner'),
    render: (_: unknown, row: any) => row.owner?.displayName || row.owner?.username || row.ownerUserId || '-',
  } : null;
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Card title={tx('显示节点', 'Display Nodes')} extra={<Button type="primary" onClick={() => setCreateOpen(true)}>{tx('手动添加节点', 'Add Display Node')}</Button>}>
        <Space wrap style={{ marginBottom: 16 }}>
          {/* 合并后的统一筛选：先选筛选字段，再选/输入对应的值 */}
          <Segmented
            value={filterField}
            onChange={(value) => changeFilterField(value as FilterField)}
            options={[
              { label: tx('关键词', 'Keyword'), value: 'keyword' },
              { label: tx('门店', 'Store'), value: 'storeCode' },
              { label: tx('基站', 'AP'), value: 'apId' },
              { label: tx('分组', 'Group'), value: 'group' },
              ...(isAdmin ? [{ label: tx('归属账号', 'Owner'), value: 'ownerUserId' }] : []),
            ]}
          />
          {filterField === 'keyword' ? (
            <Input.Search
              allowClear
              placeholder={tx('搜索标签码/名称', 'Search label code/name')}
              style={{ width: 280 }}
              defaultValue={filters.keyword}
              onSearch={(keyword) => setFilterValue(keyword.trim() || undefined)}
            />
          ) : filterField === 'storeCode' ? (
            <Select
              allowClear showSearch optionFilterProp="label"
              placeholder={tx('按门店筛选', 'Filter by store')}
              style={{ width: 280 }}
              options={storeOptions}
              value={filters.storeCode}
              onChange={(value) => setFilterValue(value)}
            />
          ) : filterField === 'apId' ? (
            <Select
              allowClear showSearch optionFilterProp="label"
              placeholder={tx('按基站筛选', 'Filter by AP')}
              style={{ width: 300 }}
              options={apOptions}
              value={filters.apId}
              onChange={(value) => setFilterValue(value)}
            />
          ) : filterField === 'group' ? (
            <Select
              allowClear showSearch optionFilterProp="label"
              placeholder={tx('按分组筛选', 'Filter by group')}
              style={{ width: 240 }}
              options={groupOptions}
              value={filters.group}
              onChange={(value) => setFilterValue(value)}
              notFoundContent={tx('暂无分组', 'No groups yet')}
            />
          ) : (
            <Select
              allowClear showSearch optionFilterProp="label"
              placeholder={tx('按用户筛选', 'Filter by user')}
              style={{ width: 260 }}
              options={userOptions}
              value={filters.ownerUserId}
              onChange={(value) => setFilterValue(value)}
            />
          )}
          <Button disabled={!selectedIds.length} onClick={() => setBatchBindOpen(true)}>
            {tx('批量绑定', 'Batch Bind')}
          </Button>
          <Button
            icon={<DownloadOutlined />}
            loading={exporting}
            onClick={handleExport}
          >
            {selectedIds.length
              ? tx(`导出选中 (${selectedIds.length})`, `Export Selected (${selectedIds.length})`)
              : tx('导出全部', 'Export All')}
          </Button>
          <Button icon={<FileExcelOutlined />} onClick={handleDownloadTemplate}>
            {tx('下载模板', 'Template')}
          </Button>
          <Upload
            accept=".xlsx,.xls"
            showUploadList={false}
            beforeUpload={(file) => { handleImport(file); return false; }}
          >
            <Button icon={<UploadOutlined />} loading={importing}>
              {tx('导入', 'Import')}
            </Button>
          </Upload>
          <Button
            disabled={!selectedIds.length}
            onClick={() => {
              Modal.confirm({
                title: tx('批量解绑显示节点？', 'Batch unbind display nodes?'),
                content: tx('只会解除显示节点与商品/模板的绑定，不会删除显示节点、商品或模板。', 'This only clears data source/template bindings. Nodes, data sources, and templates are kept.'),
                okText: tx('解绑', 'Unbind'),
                cancelText: tx('取消', 'Cancel'),
                onOk: () => batchUnbind.mutateAsync({ deviceIds: selectedIds }),
              });
            }}
          >
            {tx('批量解绑', 'Batch Unbind')}
          </Button>
          <Button
            danger
            disabled={!selectedIds.length}
            loading={batchDelete.isPending}
            onClick={() => {
              Modal.confirm({
                title: tx('批量删除显示节点？', 'Batch delete display nodes?'),
                content: describeDeviceImpact(selectedRows),
                okText: tx('删除', 'Delete'),
                cancelText: tx('取消', 'Cancel'),
                okButtonProps: { danger: true },
                width: 620,
                onOk: () => batchDelete.mutateAsync(selectedIds),
              });
            }}
          >
            {tx('批量删除', 'Batch Delete')}
          </Button>
          {selectedIds.length ? <Typography.Text type="secondary">{tx(`已选择 ${selectedIds.length} 条`, `${selectedIds.length} selected`)}</Typography.Text> : null}
        </Space>
        <Table
          rowKey="id"
          loading={isPending}
          dataSource={data?.items ?? []}
          pagination={{
            current: data?.page ?? pagination.current,
            pageSize: data?.pageSize ?? pagination.pageSize,
            total: data?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [20, 50, 100, 200],
            showTotal: (total) => tx(`共 ${total} 条`, `${total} total`),
          }}
          onChange={(next) => {
            setPagination({
              current: next.current ?? 1,
              pageSize: next.pageSize ?? DEFAULT_PAGE_SIZE,
            });
            setSelectedRowKeys([]);
          }}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
          }}
          columns={[
            ...(ownerColumn ? [ownerColumn] : []),
            { title: tx('设备名称', 'Device Name'), render: (_, row: any) => row.name ?? row.eslCode ?? '-' },
            { title: tx('设备码', 'Device Code'), dataIndex: 'eslCode' },
            { title: tx('门店', 'Store'), render: (_, row: any) => row.ap?.storeName ?? row.storeCode ?? '-' },
            { title: 'AP', render: (_, row: any) => row.ap?.name ?? row.ap?.apCode ?? '-' },
            {
              title: tx('分组', 'Group'),
              dataIndex: 'group',
              render: (_, row: any) => (row.group ? <Tag color="blue">{row.group}</Tag> : <Typography.Text type="secondary">-</Typography.Text>),
            },
            {
              title: tx('绑定状态', 'Binding'),
              render: (_, row: any) => <Tag color={row.bindStatus === 'bound' || row.productId || row.templateId ? 'green' : 'default'}>{row.bindStatus === 'bound' || row.productId || row.templateId ? tx('已绑定', 'Bound') : tx('未绑定', 'Unbound')}</Tag>,
            },
            { title: tx('在线状态', 'Status'), dataIndex: 'status' },
            { title: tx('数据源', 'Data Source'), render: (_, row: any) => row.product?.name ?? '-' },
            { title: tx('模板', 'Template'), render: (_, row: any) => row.template?.name ?? '-' },
            {
              title: tx('操作', 'Actions'),
              render: (_, row: any) => {
                const isBound = row.bindStatus === 'bound' || row.productId || row.templateId;
                return (
                  <Space>
                    <Button
                      onClick={() => {
                        setEditTarget(row);
                        editForm.setFieldsValue({
                          eslCode: row.eslCode,
                          name: row.name ?? '',
                          apId: row.apId ?? undefined,
                          group: row.group ?? '',
                          productId: row.productId ?? undefined,
                          templateId: row.templateId ?? undefined,
                        });
                      }}
                    >
                      {tx('编辑', 'Edit')}
                    </Button>
                    <Button onClick={() => refresh.mutate(row.id)} disabled={!isBound} loading={refresh.isPending && refresh.variables === row.id}>{tx('刷新', 'Refresh')}</Button>
                    <Button
                      onClick={() => silentWake.mutate({ id: row.id, apId: row.apId })}
                      loading={silentWake.isPending && silentWake.variables?.id === row.id}
                    >
                      {tx('唤醒', 'Wake')}
                    </Button>
                    {isBound ? (
                      <Button onClick={() => unbind.mutate(row.id)} loading={unbind.isPending && unbind.variables === row.id}>{tx('解绑', 'Unbind')}</Button>
                    ) : (
                      <Button
                        onClick={() => {
                          setBindTarget(row);
                          bindForm.setFieldsValue({ templateId: row.templateId ?? undefined });
                        }}
                      >
                        {tx('绑定', 'Bind')}
                      </Button>
                    )}
                    <Button
                      danger
                      loading={deleteOne.isPending && deleteOne.variables === row.id}
                      onClick={() => {
                        Modal.confirm({
                          title: tx('删除显示节点？', 'Delete display node?'),
                          content: describeDeviceImpact([row]),
                          okText: tx('删除', 'Delete'),
                          cancelText: tx('取消', 'Cancel'),
                          okButtonProps: { danger: true },
                          width: 620,
                          onOk: () => deleteOne.mutateAsync(row.id),
                        });
                      }}
                    >
                      {tx('删除', 'Delete')}
                    </Button>
                  </Space>
                );
              },
            },
          ]}
        />
      </Card>
      <Modal open={createOpen} title={tx('手动添加节点', 'Add Display Node')} onCancel={() => setCreateOpen(false)} onOk={() => createForm.submit()} confirmLoading={create.isPending}>
        <Form form={createForm} layout="vertical" onFinish={(values) => create.mutate(values)}>
          {isAdmin ? (
            <Form.Item name="ownerUserId" label={tx('归属账号', 'Owner')}>
              <Select allowClear options={userOptions} placeholder={tx('默认当前账号', 'Default to current user')} />
            </Form.Item>
          ) : null}
          <Form.Item name="name" label={tx('设备名称', 'Device Name')} rules={[{ required: true, message: tx('请输入设备名称', 'Enter device name') }]}><Input /></Form.Item>
          <Form.Item name="eslCode" label={tx('显示节点码', 'Display Node Code')} rules={[{ required: true, message: tx('请输入显示节点码', 'Enter display node code') }]}><Input /></Form.Item>
          <Form.Item name="apId" label={tx('所属 AP', 'AP')}><Select allowClear options={apOptions} /></Form.Item>
          <Form.Item
            name="group"
            label={tx('分组', 'Group')}
            rules={[{ max: 10, message: tx('分组不能超过 10 个字', 'Group must be 10 characters or fewer') }]}
          >
            <Input allowClear maxLength={10} showCount placeholder={tx('如：超市、库房（可留空）', 'e.g. Store, Warehouse (optional)')} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal open={Boolean(editTarget)} title={editTarget ? `${tx('编辑显示节点', 'Edit Display Node')} · ${editTarget.eslCode}` : tx('编辑显示节点', 'Edit Display Node')} onCancel={() => setEditTarget(null)} onOk={() => editForm.submit()} confirmLoading={update.isPending}>
        <Form
          form={editForm}
          layout="vertical"
          onFinish={(values) => {
            if (!editTarget) return;
            update.mutate({ id: editTarget.id, values });
          }}
        >
          <Form.Item name="name" label={tx('设备名称', 'Device Name')} rules={[{ required: true, message: tx('请输入设备名称', 'Enter device name') }]}><Input /></Form.Item>
          <Form.Item name="eslCode" label={tx('显示节点码', 'Display Node Code')} rules={[{ required: true, message: tx('请输入显示节点码', 'Enter display node code') }]}><Input /></Form.Item>
          <Form.Item name="apId" label={tx('所属 AP', 'AP')}><Select allowClear options={apOptions} /></Form.Item>
          <Form.Item
            name="group"
            label={tx('分组', 'Group')}
            rules={[{ max: 10, message: tx('分组不能超过 10 个字', 'Group must be 10 characters or fewer') }]}
          >
            <Input allowClear maxLength={10} showCount placeholder={tx('如：超市、库房（可留空）', 'e.g. Store, Warehouse (optional)')} />
          </Form.Item>
          <Form.Item name="productId" label={tx('数据源', 'Data Source')}>
            <Select allowClear showSearch optionFilterProp="label" placeholder={tx('搜索名称或 SKU', 'Search by name or SKU')} options={productOptions} />
          </Form.Item>
          <Form.Item name="templateId" label={tx('模板', 'Template')}>
            <Select allowClear showSearch optionFilterProp="label" placeholder={tx('搜索模板名称', 'Search template name')} options={templateOptions} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal open={Boolean(bindTarget)} title={bindTarget ? `${tx('绑定设备', 'Bind Device')} · ${bindTarget.eslCode}` : tx('绑定设备', 'Bind Device')} onCancel={() => setBindTarget(null)} onOk={() => bindForm.submit()} confirmLoading={bind.isPending}>
        <Form
          form={bindForm}
          layout="vertical"
          onFinish={(values) => {
            if (!bindTarget) return;
            bind.mutate({ id: bindTarget.id, values });
          }}
        >
          <Form.Item name="productId" label={tx('数据源', 'Data Source')} rules={[{ required: true, message: tx('请选择数据源', 'Select a data source') }]}>
            <Select showSearch optionFilterProp="label" placeholder={tx('搜索名称或 SKU', 'Search by name or SKU')} options={productOptions} />
          </Form.Item>
          <Form.Item name="templateId" label={tx('模板', 'Template')}>
            <Select allowClear showSearch optionFilterProp="label" placeholder={tx('搜索模板名称', 'Search template name')} options={templateOptions} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal open={batchBindOpen} title={tx('批量绑定显示节点', 'Batch Bind Display Nodes')} onCancel={() => setBatchBindOpen(false)} onOk={() => batchBindForm.submit()} confirmLoading={batchBind.isPending}>
        <Form
          form={batchBindForm}
          layout="vertical"
          onFinish={(values) => batchBind.mutate({ ...values, deviceIds: selectedIds })}
        >
          <Typography.Paragraph type="secondary">
            {tx(`将更新 ${selectedIds.length} 个显示节点。可以只选模板、只选商品，或同时选择。`, `This updates ${selectedIds.length} display node(s). You can select only a template, only a data source, or both.`)}
          </Typography.Paragraph>
          <Form.Item name="productId" label={tx('数据源', 'Data Source')}>
            <Select allowClear showSearch optionFilterProp="label" placeholder={tx('搜索名称或 SKU', 'Search by name or SKU')} options={productOptions} />
          </Form.Item>
          <Form.Item name="templateId" label={tx('模板', 'Template')}>
            <Select allowClear showSearch optionFilterProp="label" placeholder={tx('搜索模板名称', 'Search template name')} options={templateOptions} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Import Result Modal ── */}
      <Modal
        open={Boolean(importResult)}
        title={importResult
          ? tx(`导入完成：成功 ${importResult.success} 条，失败 ${importResult.failed} 条`,
              `Import done: ${importResult.success} succeeded · ${importResult.failed} failed`)
          : ''}
        onCancel={() => setImportResult(null)}
        footer={<Button type="primary" onClick={() => setImportResult(null)}>{tx('关闭', 'Close')}</Button>}
        width={680}
      >
        {importResult && (
          <>
            {importResult.failed === 0 ? (
              <Typography.Text type="success">
                {tx(`全部 ${importResult.success} 条数据导入成功`, `All ${importResult.success} rows imported successfully`)}
              </Typography.Text>
            ) : (
              <Typography.Text type="warning">
                {tx(`${importResult.success} 条成功，${importResult.failed} 条失败`, `${importResult.success} succeeded, ${importResult.failed} failed`)}
              </Typography.Text>
            )}
            <div style={{ marginTop: 8 }}>
              <Typography.Text type="secondary">
                {tx(
                  `其中 ${importResult.refreshed} 个价签绑定数据齐全有效，已生成刷新任务并下发；可在任务中心查看进度。`,
                  `${importResult.refreshed} label(s) had complete & valid bindings and were queued for refresh; track progress in Tasks.`,
                )}
              </Typography.Text>
            </div>
            {importResult.errors.length > 0 && (
              <Table
                style={{ marginTop: 12 }}
                size="small"
                pagination={false}
                scroll={{ y: 300 }}
                dataSource={importResult.errors.map((e, i) => ({ ...e, key: i }))}
                columns={[
                  { title: tx('行号', 'Row'), dataIndex: 'row', width: 60 },
                  { title: tx('设备编号', 'Device Code'), dataIndex: 'eslCode', width: 140 },
                  { title: tx('原因', 'Reason'), dataIndex: 'reason', ellipsis: true },
                ]}
              />
            )}
          </>
        )}
      </Modal>
    </Space>
  );
};

export const EslDeviceDetailPage = () => {
  const { tx } = useI18n();
  const { id = '' } = useParams();
  const { data, isPending } = useQuery({ queryKey: queryKeys.device(id), queryFn: () => api.device(id), refetchInterval: 10_000 });
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Card title={`${tx('设备详情', 'Device Details')} · ${data?.eslCode ?? ''}`} loading={isPending}>
        <Descriptions items={[
          { key: 'type', label: tx('设备类型', 'Device Type'), children: data?.deviceType },
          { key: 'battery', label: tx('电量', 'Battery'), children: data?.battery },
          { key: 'signal', label: tx('信号', 'Signal'), children: data?.signal },
          { key: 'bind', label: tx('绑定状态', 'Binding'), children: data?.bindStatus },
        ]} />
      </Card>
      <Card title={tx('最近任务', 'Recent Tasks')}>
        <Table rowKey="id" loading={isPending} dataSource={data?.recentTasks ?? []} columns={[{ title: tx('任务', 'Task'), dataIndex: 'taskType' }, { title: tx('状态', 'Status'), dataIndex: 'status' }]} pagination={false} />
      </Card>
    </Space>
  );
};
