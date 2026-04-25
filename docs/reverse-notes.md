# 逆向记录

> 最终可用的图片全屏下发协议已整理成独立文档：[`docs/image-downlink-service0c.md`](image-downlink-service0c.md)。该文档是当前实现与调试的主参考。

## 已确认信息

- 旧平台地址：`http://43.153.107.21`
- 登录页路径：`/admin/auth/login`
- 管理后台框架：Laravel Admin
- 服务端：`Server: LaravelS`
- 运行方式：Laravel + Swoole/LaravelS
- 页面版本：`Version:4.0.6-05ded724`
- 登录接口在当前环境会暴露 Whoops 错误：`Undefined variable: languages`，位置为 `/var/www/esl/app/Admin/Controllers/AuthController.php:92`

## 基站接入流程理解

新基站通过网线接入交换机或路由器，再通过临时热点 `eslap-xxxxxxxx` 暴露配置页：

1. 手机/电脑连接基站热点，密码默认 `12345678`。
2. 浏览器打开 `192.168.66.1`。
3. 登录基站配置页，账号 `root`，默认密码 `123456`。
4. 打开 `电子价签 -> 基站配置`。
5. 填写服务器地址、门店编号、用户名、密码。
6. 基站根据这些配置连接云平台，平台内部通过 WebSocket/API/MQTT 完成控制。

## 本项目采用的兼容策略

由于旧平台登录接口当前报错，且 PDF 文本无法直接从本机工具完整提取，本项目先实现一层可替换协议适配：

- 对外暴露 HTTP API，供控制台、未来 OpenAPI 或脚本调用。
- 对基站暴露 MQTT TCP `1883` 和 WebSocket `/mqtt`。
- Topic 采用清晰命名，后续拿到真实包或基站日志后可在同一服务内映射。

默认 topic 设计：

- `stores/{storeCode}/aps/{apId}/status`
- `stores/{storeCode}/aps/{apId}/heartbeat`
- `stores/{storeCode}/aps/{apId}/uplink`
- `stores/{storeCode}/aps/{apId}/commands`
- `stores/{storeCode}/labels/{labelId}/commands`
- `stores/{storeCode}/labels/{labelId}/events`

## 下一步逆向建议

1. 在同一局域网抓基站配置完成后的 DNS/HTTP/WebSocket/MQTT 流量。
2. 重点确认 MQTT host、port、username、clientId、topic、payload 编码。
3. 如果基站使用 WebSocket，确认 path、subprotocol、鉴权字段。
4. 把真实 topic/payload 写入 `MqttService.publishLabelCommand()` 和 `handlePublish()`。

## 2026-04-23 READ_WRITE_SVC 结论

- 官方 `esl/direct` 和 `esl/bind -> esl/bind_task` 都能触发基站下发 `READ_WRITE_SVC`，重放官方捕获包可以刷新价签，说明 WebSocket 下行链路和基站接收链路是通的。
- 当前测试价签 `17900170` 的官方刷新包里，真正刷屏的主数据在 `WRITE_SVC service=01-00-00-03`，辅助数据常见于 `01-00-00-07`。
- 已捕获 18 次 `READ_WRITE_SVC`，即使 `product_code`、`product_name`、`price`、绑定方式和 `extend` 字段变化，`01-00-00-03` 主图 payload 仍完全一致：
  - 解码后长度：`2964 bytes`
  - SHA-256 前缀：`70f96d24d21b`
  - 头部：`a5a60c02013902ed98b16ee3`
  - 尾部：`c2a094ef5fc51e0e280000000000f833`
- 因此当前卡点不是“有没有发到基站”，而是“官方返回的模板渲染结果本身没有随商品变量变化”。下一步要先确认官方后台中的价签绑定状态、商品字段和模板字段是否变化；如果状态已变但主图仍不变，就需要逆向 `01-00-00-03` 的图像编码，自己生成 `READ_WRITE_SVC`。

## 2026-04-23 模板字段绑定验证

- 官方模板编辑器里的元素绑定语法是 `#字段名`，例如文本元素绑定 `#f1` 时，渲染读取商品自定义字段 1，而不是商品名 `#pn`、价格 `#pp` 或条码 `#pc`。
- 改造官方 API 实验后，同时向商品发送 `f1` 和兼容字段 `field1`，`01-00-00-03` 主图 payload 开始随 `#f1` 变化：
  - 示例 A：`6142 bytes`，FNV fp `056143a5`
  - 示例 B：`6101 bytes`，FNV fp `8f95ff22`
  - 两者 `service=01-00-00-03` 变化约 `99%`，且屏幕显示内容与填写的 `#f1` 一致。
- 结论：官方刷新链路的正确数据模型是“模板布局 + 商品字段绑定 -> 渲染整张图 -> `READ_WRITE_SVC/WRITE_SVC 01-00-00-03` 下发”。要自研替代官方，必须实现两层：
  1. 商品字段到模板元素的渲染器，例如 `#f1/#pn/#pp/#pqr` 等。
  2. 将渲染后的图像编码成基站/价签可接受的 `01-00-00-03` payload。

## 2026-04-24 结构级结论（干净样本）

### 模板字段绑定的“假阳性”已排除

- 自动样本实验已修正为：**默认只改目标字段，其他商品字段保持恒定**，避免 `pn/pc/pp` 同时变化污染结论。
- 用修正后的实验重新验证：
  - `template_id = 4515`
    - `f1` 改变会生成新的 `service03`
    - `pn` 改变不会影响 `service03`
    - `pp` 改变不会影响 `service03`
  - `template_id = 4513`
    - `f1 / pn / pp` 在当前 `esl/direct` 路径下都**不会**影响 `service03`
- 结论：当前真正对 `17900170 + 4515` 生效的变量是 `#f1`，而之前 `4513` 的变化基本可以视为辅助字段联动造成的假阳性。

### 4515 的 `service03` 已确认是“前缀可变 + 后缀固定”的分段结构

- 对 `4515 + f1` 的多组干净样本（空串、短串、长串、`AAAAA/AAAAB/AAAAC` 等）做对比后，得到稳定规律：
  - **所有样本共享最后 `5540 bytes` 完全相同**
  - 也共享最后 **`32 bytes` 固定尾段**：
    - `23691d347955fbc6ca741e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e9d07c02f0e`
- 因而 `4515` 的主图 payload 可写成：

```text
service03(4515) = 可变前缀 + 固定后缀(5540 bytes)
```

- 这说明 `f1` 文本所在的画面只影响上方的一段编码，其余屏幕区域保持完全不变。

### 4515 的第 6 个字节（byte[5]）是一个有效长度字段

- 记：
  - `L = service03 总长度`
  - `P = 可变前缀长度 = L - 5540`
  - `b5 = service03[5]`
- 对所有已验证的 4515 样本，成立：

```text
P = 519 + int8(b5)
L = 6059 + int8(b5)
```

- 其中 `int8(b5)` 按有符号 8 位整数解释：
  - 例如 `b5 = 0x0c`，`int8 = 12`
  - `b5 = 0xe9`，`int8 = -23`
  - `b5 = 0xa7`，`int8 = -89`
- 样本举例：
  - `f1=""`：`L=5970`，`b5=0xa7`，`P=430`
  - `f1="A"`：`L=6036`，`b5=0xe9`，`P=496`
  - `f1="AA"`：`L=6064`，`b5=0x05`，`P=524`
  - `f1="AAAAA"`：`L=6071`，`b5=0x0c`，`P=531`
  - `f1="LONG-LONG-LONG-LONG-LONG-LONG"`：`L=6293`，`b5=0xea`，`P=753`

### 4515 内部还存在固定相对位置的子块头

- 在 4515 的每条 `service03` 中都能稳定找到 4 个子块起点：
  - `offset 6`
  - `offset P + 2`
  - `offset P + 2758`
  - `offset P + 3299`
- 并且块类型按顺序呈现为：

```text
02ed ... / 01ed ... / 02ed ... / 01ed ...
```

- 这非常像：
  - 两个颜色平面
  - 乘以两个垂直区域
  - 或等价的“分区 + 分平面”编码

- 也就是说，4515 大概率不是“整图一次性压缩”，而是：

```text
全局头 + 子块1 + 子块2 + 子块3 + 子块4 + 固定尾
```

- 其中 `f1` 当前只影响**子块 1**，其余块保持不变。

### 4513 的结构更像单色分块

- `4513` 的 `service03` 长度稳定在 `2964 bytes`
- 固定尾为：
  - `00edc1010d000000c2a094ef5fc51e0e280000000000f833`
- 能稳定找到四个 `02ed...` 子块起点：
  - `6`
  - `1260`
  - `1831`
  - `2189`
- 在当前 `esl/direct` 路径里，`4513` 对 `f1 / pn / pp` 都没有产生新的渲染变化，因此当前阶段不再把 4513 作为变量验证模板。

### 对“为什么改 1 个字节也写成功但画面不变”的解释

- 重放和单字节扰动实验显示：
  - `READ_WRITE_SVC / WRITE_SVC 01-00-00-03` 传输层面 `ack/send` 正常
  - `errno = 0`
  - 标签会触发刷新动作
  - 但画面不会采用被破坏后的内容
- 这说明失败点不在 BLE 写入链路，而在 `service03` 的内部完整性规则：
  - 可能存在块级校验
  - 或块描述/索引与压缩数据强耦合
  - 因此不能把它当作“原始位图 + 简单 gzip/deflate + 固定头尾”

### 新证据：`service03` 也是 chunk 容器（与 0c 同类格式）

- 对现有 capture 的 `service=01-00-00-03` 做二进制解析后，确认结构为：

```text
a5 a6 0c 02 + N * [chunkId(1B) + compressedLen(LE16) + deflateRaw]
```

- 关键稳定特征：
  - 固定为 `12` 个 chunk（`cid=1..12`）
  - `cid=1..11` 解压后长度固定 `8192`
  - `cid=12` 解压后长度固定 `5888`
  - 总解压长度固定 `96000 bytes`
- 这意味着 `service03` 已进入“可本地重组”的阶段，后续重点转为：
  - 每个 chunk 的像素语义映射
  - 四色（红黄黑白）码值与 chunk 字节位关系

### 已落地：脱官方下发（local-only）与本地生成实验接口

- 已有接口（稳定可用）：
  - `POST /api/official-api/send-image-4515-file-local`
  - 逻辑：命中本地缓存 `service03` 后直接 replay 到 AP，不再调用官方 `direct`。
- 新增接口（实验态）：
  - `POST /api/official-api/send-image-4515-file-local-generated`
  - 逻辑：本地图片 -> 本地生成 `service03`（按 chunk 重组）-> 直发 AP。
  - 当前模式：
    - `mode=non55`：仅覆盖基线 chunk 非 `0x55` 区域
    - `mode=full`：覆盖全部区域
    - `mode=f2slot`：按 4515 的 `#f2` 槽位布局直接生成（当前默认）
  - 当前发送方式：
    - `sendMode=direct`（默认）：直接构造 `READ_WRITE_SVC` 并发送，不依赖官方 capture 种子。
    - `sendMode=replay`：兼容旧链路，使用种子包 replay 再替换 `service03`。
  - `f2slot` 调优参数（用于收敛显示效果）：
    - `fit`: `stretch` / `contain_black` / `contain_white` / `cover`
    - `resample`: `nearest` / `bilinear` / `bicubic` / `lanczos`
    - `dither`: `true/false`（Floyd-Steinberg）
    - `renderPreset`: `2.13 / 1.54 / 2.90 / 4.2 / 5.83 / 3.7 / 7.5 / 2.6 / 10.2`（按标签尺寸比例渲染）
    - `renderScale`: `0.2 ~ 1.0`（控制图像在标签上的显示尺寸，居中渲染）
  - `dryRun=true`：只生成 payload 并返回统计，不执行下发。
  - 新增 sweep 接口：
    - `POST /api/official-api/send-image-4515-file-local-generated-sweep`
    - 自动遍历 `fit/resample/dither` 组合，返回 topN 候选与评分（默认 32 组全量扫描）。
    - 支持 `fastMode=true/false`：快速模式默认开启，仅跑高价值组合；`false` 时跑全量组合。
  - 新增一键自动最优接口：
    - `POST /api/official-api/send-image-4515-file-local-generated-auto-best`
    - 内部流程：先 sweep 选 best -> 再用 best 参数直接下发（可用 `dryRun=true` 仅查看选择结果）。
    - 当快速模式候选评分偏低时，会自动回退到全量 sweep 再选一次。
  - 已加入历史参数加权：
    - 相同图片（`imageSha256`）会优先提升历史成功参数的评分。
    - 历史数据文件：`apps/api/data/f2slot-history.json`

### 控制台独立功能（图片下发测试）

- Web 控制台新增独立页签「图片测试」：
  - 可自由选择目标基站、目标价签、图片文件。
  - 默认调用 `send-image-4515-file-local-generated-auto-best`（`auto-best -> f2slot -> direct`）。
  - 支持 `dryRun`（只看参数）与 `fastMode`（快速筛选）。
- 对 `multipart/form-data` 的前端请求已兼容（`apps/web/src/lib/api.ts` 在 `FormData` 时不再强制 `Content-Type: application/json`）。
  - 注意：该接口已能稳定发包并触发刷新，但“完全等价官方渲染”仍需继续校准编码映射。

### 新证据：4515 的 `#f2` 槽位编码已被本地复刻（受控样本 1:1）

- 通过 5 组受控样本（`black/white/red/yellow/checker_bw`）自动采集官方 `service03` 后，得到稳定规律：
  - 实际变化仅在 `chunk1..4`，`chunk5..12` 固定为填充值（主要 `0x55`）
  - 活跃区按“每行 65 bytes、步进 200 bytes”写入
  - 4 段行映射为：
    - chunk1: 40 行，起始偏移 200
    - chunk2: 41 行，起始偏移 8
    - chunk3: 41 行，起始偏移 16
    - chunk4: 6 行，起始偏移 24
- `65 bytes/行 = 260 px`，与输入图 256px 对应关系为：
  - 左右各补 `2 px` 边界，边界码值固定为 `01`（即 `0x55` 边界位）
- 四色码值在该槽位下可确认：
  - 黑：`00`
  - 白：`01`
  - 黄：`10`
  - 红：`11`
- `f2slot` 本地生成结果在上述 5 组样本上与官方 `service03` 达到 **sha256 完全一致**。
