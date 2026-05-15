type Tx = (zh: string, en: string) => string;

export const normalizeTaskStatus = (value: unknown) => String(value ?? '').trim().toLowerCase();

export const buildTaskStatusLabels = (tx: Tx): Record<string, string> => ({
  queued: tx('排队中', 'Queued'),
  trigger_pending: tx('待触发', 'Waiting Wake'),
  rendering: tx('处理中', 'Rendering'),
  ready: tx('已准备好', 'Ready'),
  sending: tx('发送中', 'Sending'),
  sent: tx('已下发', 'Sent'),
  success: tx('成功', 'Success'),
  failed: tx('失败', 'Failed'),
  timeout: tx('超时', 'Timeout'),
  cancelled: tx('已取消', 'Cancelled'),
  skipped: tx('已跳过', 'Skipped'),
  superseded: tx('已合并', 'Merged'),
});

export const getTaskStatusLabel = (task: any, tx: Tx) => {
  const status = normalizeTaskStatus(task?.status);
  const raw = String(task?.resultMsg ?? task?.message ?? '');
  if ((status === 'sending' || status === 'sent') && (raw.includes('自动唤醒') || raw.includes('重新唤醒') || raw.includes('重新下发'))) {
    return tx('重试中', 'Retrying');
  }
  return buildTaskStatusLabels(tx)[status] ?? String(task?.status ?? '-');
};

export const buildTaskTypeLabels = (tx: Tx): Record<string, string> => ({
  bind: tx('绑定设备', 'Bind Device'),
  bind_refresh: tx('绑定后刷新', 'Refresh after bind'),
  unbind: tx('解绑设备', 'Unbind Device'),
  refresh: tx('刷新屏幕', 'Refresh Screen'),
  manual_refresh: tx('手动刷新', 'Manual Refresh'),
  product_update_refresh: tx('商品更新刷新', 'Product Update Refresh'),
  product_refresh: tx('商品刷新', 'Product Refresh'),
  template_publish_refresh: tx('模板发布刷新', 'Template Publish Refresh'),
  auto_retry_after_wake: tx('自动补发刷新', 'Auto Retry Refresh'),
  retry_refresh: tx('重试刷新', 'Retry Refresh'),
  adjust: tx('调整设备', 'Adjust Device'),
  search_devices: tx('搜索设备', 'Search Devices'),
  sync_status: tx('同步状态', 'Sync Status'),
  config_push: tx('下发配置', 'Push Config'),
});

export const getTaskUserText = (task: any, tx: Tx) => {
  const status = normalizeTaskStatus(task?.status);
  const taskType = String(task?.taskType ?? '');
  const raw = String(task?.resultMsg ?? task?.message ?? '');
  if (!task) return tx('正在加载任务详情...', 'Loading task details...');
  if (status === 'success') {
    return taskType === 'auto_retry_after_wake'
      ? tx('补发任务已完成。', 'Retry refresh completed.')
      : tx('刷新已完成。', 'Refresh completed.');
  }
  if (status === 'skipped' || status === 'cancelled') {
    return raw.includes('父任务') || raw.includes('主任务')
      ? tx('主任务已完成，这次补发已自动取消。', 'The main task completed; this retry was cancelled.')
      : tx('任务已取消。', 'Task cancelled.');
  }
  if (status === 'superseded') return tx('已有新的刷新任务，这条任务已合并。', 'A newer refresh task replaced this one.');
  if (status === 'queued') return tx('任务已提交，正在排队。', 'Task submitted and waiting in queue.');
  if (status === 'trigger_pending') return tx('待触发：等待标签真实回包，系统会间隔重试。', 'Waiting trigger: waiting for a real node reply; the system will retry periodically.');
  if (status === 'rendering') return tx('正在生成价签画面。', 'Generating the label image.');
  if (status === 'sending' || status === 'sent' || status === 'ap_reply_seen' || status === 'socket_write_ok') {
    if (raw.includes('自动唤醒') || raw.includes('重新唤醒') || raw.includes('重新下发')) {
      return tx('后台正在唤醒价签并重试刷新。', 'Waking the display node and retrying in the background.');
    }
    return taskType === 'auto_retry_after_wake'
      ? tx('正在补发刷新，请稍等。', 'Retry refresh is being sent.')
      : tx('已发送到基站，正在等待结果。', 'Sent to the station and waiting for the result.');
  }
  if (status === 'timeout') return tx('等待基站确认超时，请稍后重试。', 'Timed out while waiting for station confirmation.');
  if (status === 'failed' || status === 'socket_missing' || status === 'socket_write_error') {
    if (raw.includes('没有在线基站') || raw.includes('没有可用基站')) return tx('没有可用基站，刷新未发送。', 'No available station. Refresh was not sent.');
    if (raw.includes('WebSocket') || raw.includes('MQTT') || status.startsWith('socket_')) return tx('基站连接不可用，刷新未发送。', 'Station connection unavailable. Refresh was not sent.');
    if (raw.includes('标签不存在')) return tx('标签不存在，任务无法继续。', 'Display node not found. Task cannot continue.');
    if (raw.includes('设备执行失败')) return tx('价签返回失败，请重试。', 'The display node reported a failure. Please retry.');
    if (raw.includes('已自动唤醒并重试')) return tx('多次自动重试后仍未成功。', 'Still failed after automatic retries.');
    return tx('任务失败，请重试。', 'Task failed. Please retry.');
  }
  return tx('任务状态已更新。', 'Task status updated.');
};

export const getTaskSummary = (detail: any, tx: Tx) => {
  const status = normalizeTaskStatus(detail?.status);
  if (!detail) return tx('正在加载任务详情...', 'Loading task details...');
  if (status === 'queued') return tx('任务已经提交，正在排队处理中。', 'The task has been submitted and is waiting in queue.');
  if (status === 'trigger_pending') return tx('标签未确认真实在线，系统会间隔尝试唤醒/下发，收到确认后自动完成。', 'The display node is not verified online. The system will wake/send periodically and finish after confirmation.');
  if (status === 'rendering') return tx('系统正在生成要显示的内容。', 'The system is generating content for display.');
  if (status === 'sending' || status === 'sent') {
    const raw = String(detail?.resultMsg ?? '');
    if (raw.includes('自动唤醒') || raw.includes('重新唤醒') || raw.includes('重新下发')) {
      return tx('系统正在后台唤醒价签并重新发送刷新内容。', 'The system is waking the display node and resending the refresh in the background.');
    }
    return tx('内容已经发出，正在等待基站返回结果。', 'The content has been sent and is waiting for the station result.');
  }
  if (status === 'success') return tx('任务已经完成。', 'The task has completed.');
  if (status === 'failed') return tx('任务执行失败，请查看原因后重试。', 'The task failed. Please review the reason and try again.');
  if (status === 'timeout') return tx('等待时间较长，暂时没有收到最终结果。', 'No final result has been received yet.');
  if (status === 'skipped') return tx('主任务已完成，这次补发已跳过。', 'The main task completed; this retry was skipped.');
  if (status === 'superseded') return tx('已有新的刷新任务，这条任务已合并。', 'A newer refresh task replaced this one.');
  return getTaskUserText(detail, tx);
};

export const getTaskProgressText = (detail: any, tx: Tx) => {
  const analysis = detail?.renderResult?.analysis;
  if (!analysis) return '-';
  if (analysis.allRequestedTagsPresent && analysis.allRequestedTokensMatched) return tx('设备已确认完成刷新', 'The device confirmed the refresh.');
  if (analysis.allRequestedTagsPresent) return tx('已经找到设备，正在等待最终确认', 'The device was found and is waiting for final confirmation.');
  return tx('基站已响应，正在继续确认设备状态', 'The station responded and device confirmation is still in progress.');
};
