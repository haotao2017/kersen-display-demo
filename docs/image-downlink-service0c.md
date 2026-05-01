# 图片下发与本地全屏渲染协议说明

本文记录当前项目已验证的电子价签图片下发链路，重点说明：本地图片如何被转换成基站可执行的 `READ_WRITE_SVC` payload、`01-00-00-0c` 全屏图像服务的二进制格式、基站如何连接到本项目，以及 WebSocket/MQTT 在项目中的角色。

## 最终结论

当前已实测成功的全屏图片下发路径是：

```text
本地图片
  -> 800x480 白底画布
  -> 按选择的标签尺寸渲染图片内容并居中
  -> 红 / 黄 / 黑 / 白 四色量化
  -> 2bpp 打包，每行 200 bytes
  -> 12 个 deflateRaw chunk
  -> READ_WRITE_SVC / WRITE_SVC / service=01-00-00-0c / supersize=true
  -> AP WebSocket
  -> 基站 BLE 写入价签
```

关键点：

- 真正的全屏图像服务是 `01-00-00-0c`，不是 `01-00-00-03`。
- `01-00-00-03` 可以被写入并触发刷新，但当前只对应局部/槽位显示区域，容易出现“中间一条”和旧底图残留。
- `01-00-00-0c` 使用 `supersize=true`，实测 AP 回包会按大包分片执行，例如 `chunk_idx=1/2`，`errno=0`。
- 本地生成的 `service0c` 已经可以全屏刷出项目根目录的 `111111.jpg`。

### 1.54 小屏例外

`15403fca` 这类 1.54 小屏的官方抓包不是 `01-00-00-0c`，而是：

```text
READ_WRITE_SVC / WRITE_SVC / service=01-00-00-03 / bigsize=false
容器头: a5 a6 01 02
chunk 数: 1
解压后长度: 4000 bytes = 200 x 160 x 1bpp / 8
```

因此图片测试页现在把“标签尺寸”和“画布/编码尺寸”拆开：

- `0C 800x480`：继续生成 `01-00-00-0c` / 800x480 / 2bpp / `supersize=true`。
- `03 WxH`：生成 `01-00-00-03` / `a5 a6 01 02` / 1bpp / 单 chunk / `bigsize=false`。
- `03-01 128x250`：官方 `1710408C + 4518` 匹配，生成 `01-00-00-03` / `a5 a6 01 02` / 2bpp / `128x250`；官方包解压长度为 `8000 bytes = 128 x 250 x 2bpp / 8`。不要按 `03 256x250` 的 1bpp 解读，否则会只剩黑白；本地刷屏颜色按实测优先用 `03-01 128x250#b0y2r3w1`。
- `03 128x250`：官方 `15403FCA + 4518` 匹配，生成 `01-00-00-03` / `a5 a6 01 02` / 1bpp / `128x250`；官方包解压长度为 `4000 bytes = 128 x 250 x 1bpp / 8`，只能显示黑白，红/黄会丢失；当前实测使用原始黑白 + 旋转。
- `03-02 200x200`：官方 `1700009F + 4518` 匹配，生成 `01-00-00-03` / `a5 a6 02 02` / 2bpp / `200x200`；官方包解压长度为 `10000 bytes = 200 x 200 x 2bpp / 8`。
- `03-02 128x296`：官方 `173014D6 + 4518` 匹配，生成 `01-00-00-03` / `a5 a6 02 02` / 2bpp / `128x296`；官方包解压长度为 `9472 bytes = 128 x 296 x 2bpp / 8`。本地测试优先使用 `03-02 128x296#b0y2r3w1`，颜色按实测 `黄 -> 白`、`白 -> 红`、`红 -> 黄` 的错位修正。
- `03-02 152x296`：官方 `17200227 + 4518` 匹配，生成 `01-00-00-03` / `a5 a6 02 02` / 2bpp / `152x296`；官方包解压长度为 `11248 bytes = 152 x 296 x 2bpp / 8`。本地测试优先使用 `03-02 152x296#b0y2r3w1`。
- `03-03 184x384`：官方 `174004d2 + 4518` 匹配，生成 `01-00-00-03` / `a5 a6 03 02` / 2bpp / `184x384`；官方包解压长度为 `17664 bytes = 184 x 384 x 2bpp / 8`。
- `03-03 184x384#b0y2r3w1`：按 `174004d2` 本地实测颜色错位修正；此前 `b0/y1/r2/w3` 下表现为 `黄 -> 白`、`白 -> 红`、`红 -> 黄`，因此改测 `black=0 / yellow=2 / red=3 / white=1`。
- 不要使用 `03-03 368x192` 测 `174004d2`：它虽然同样是 `17664 bytes`，但行字节变成 `92`，而官方真实行字节是 `46`，设备按真实行宽读取时会出现横向细条和错位。
- `03-04 400x300`：官方 `176002f7 + 4518` 匹配，生成 `01-00-00-03` / `a5 a6 04 02` / 2bpp / `400x300`；本地测试优先使用 `03-04 400x300#b0y2r3w1`。
- `03-04 240x416`：官方 `17500175 + 4518` 匹配，生成 `01-00-00-03` / `a5 a6 04 02` / 2bpp / `240x416`；官方包解压长度为 `24960 bytes = 240 x 416 x 2bpp / 8`。不要按 `416x240` 解读，否则会出现横向条纹。
- `03-0A 648x480`：官方 `1770008e + 4518` 匹配，生成 `01-00-00-03` / `a5 a6 0a 02` / 2bpp / `648x480`；本地测试优先使用 `03-0A 648x480#b0y2r3w1`。不要改成 `680x480` 作为主方案，行字节会从 `162` 变成 `170`，设备按原行宽读取会乱码。
- `03-01/03-02/03-03/03-04/03-0A` 的 2bpp 颜色码不同批次会有差异：默认仍保留 `black=0 / yellow=1 / red=2 / white=3`，但本批小屏和 `176002f7`、`1770008e` 实测优先用 `black=0 / yellow=2 / red=3 / white=1`。
- `03 WxH strideN totalM`：显示区仍按 `WxH` 渲染，但输出帧按指定行字节/行数补齐，用于排查上下重叠、行跨度不匹配的问题。
- 图片测试页的“图片旋转/图片翻转”只在生成像素数据前处理源图，不会自动联动“标签尺寸”或“画布/编码尺寸”；遇到镜像问题时先保持角度不变，再单独切换“水平镜像/垂直镜像”排查。

图片测试页“画布尺寸”下拉现在只保留最终匹配项：

```text
17900170  -> 0C    800x480
176002f7  -> 03-04 400x300  # b0/y2/r3/w1
1770008e  -> 03-0A 648x480  # b0/y2/r3/w1；680x480 会乱码
17500175  -> 03-04 240x416  # b0/y2/r3/w1，需旋转 + 水平镜像
174004d2  -> 03-03 184x384  # b0/y2/r3/w1，需旋转
173014d6  -> 03-02 128x296  # b0/y2/r3/w1，需水平镜像 + 旋转
17200227  -> 03-02 152x296  # b0/y2/r3/w1，需水平镜像 + 旋转
15403fca  -> 03    128x250  # 原始黑白 1bpp，需旋转
1710408c  -> 03-01 128x250  # b0/y2/r3/w1，需旋转
1700009f  -> 03-02 200x200  # b0/y2/r3/w1，需旋转
```

已从“画布尺寸”下拉移除的候选/排查项：

- 全量协议展开项：`03`、`03-01`、`03-02`、`03-04`、`03-0A`、`0C` 对 `CANVAS_SIZE_PRESETS` 的自动组合，以及“自定义类型和尺寸”。这些用于早期排查，最终配置确定后容易误选。
- 默认色码项：`#b0y1r2w3` 或未带 `#...` 的 2bpp 选项，例如 `03-04:400x300`、`03-0a:648x480`、`03-03:184x384`、`03-02:128x296`、`03-02:152x296`、`03-02:200x200`。本批设备实测优先用 `#b0y2r3w1`。
- 错误尺寸/误解读项：`03-0A 680x480` 会因行字节从 `162` 变为 `170` 导致 `1770008e` 乱码；`03 256x250` 是 `1710408C` 误按 1bpp 解读；`03-02 256x250` 是 `1710408C` 彩色实验项，图案会乱。
- `15403FCA` 黑白相关项最终只保留 `03 128x250` 原始 1bpp 黑白 + 旋转；`03-02 128x250#b0y2r3w1` 和 `03-02 128x250` 已从下拉移除。
- 通用候选尺寸：`200x160`、`200x200`、`152x152`、`250x122`、`250x122@32x125`、`250x125@32x125`、`250x128@32x128`、`256x122@32x125`、`256x125`、`256x128`、`212x104`、`296x128`、`296x152`、`296x160`、`360x184`、`300x200`、`400x300`、`416x240`、`648x480`、`680x480` 的通用组合入口。

页面显示规则：

- “标签尺寸”下拉的英寸选项同时显示对应宽高，例如 `4.2 英寸（400x300）`、`5.83 英寸（648x480）`。
- “目标价签”下拉会在价签名称后显示已知编码尺寸，例如 `176002f7 · ... · 03-04 400x300`。
- `label-demo-*` 演示价签不再出现在目标价签下拉中，避免误选演示值下发。

## 自动渲染策略

“画布尺寸”现在不仅代表编码协议和尺寸，也代表默认图像处理策略。选择画布后，页面会自动带出旋转/镜像，并在提交时按该策略发送，不需要再手动调整“图片旋转/图片翻转”。

```text
0C 800x480                         -> 不旋转 / 不镜像
03-04 400x300#b0y2r3w1             -> 不旋转 / 不镜像
03-0A 648x480#b0y2r3w1             -> 不旋转 / 不镜像
03-04 240x416#b0y2r3w1             -> 顺时针90度 / 水平镜像
03-03 184x384#b0y2r3w1             -> 顺时针90度 / 不镜像
03-02 128x296#b0y2r3w1             -> 顺时针90度 / 水平镜像
03-02 152x296#b0y2r3w1             -> 顺时针90度 / 水平镜像
03 128x250                         -> 顺时针90度 / 不镜像
03-01 128x250#b0y2r3w1             -> 顺时针90度 / 不镜像
03-02 200x200#b0y2r3w1             -> 顺时针90度 / 不镜像
```

如果强行给小屏写入 800x480 的 `service0c`，设备会把数据按自己的小屏格式解释，常见现象就是白屏或黑白竖条。`15403fca` 官方样本对应 `03 200x160`，但实际不同批次可能有差异，可以在页面里逐个试画布尺寸。

## 队列与操作台

官方接口本身有队列概念：`bind` / `unbind` 会把价签加入 refresh queue，再由 `bind_task` 触发刷新；`direct` 则会直接让价签刷新并可同时闪灯。本地基站回包里也会出现 `AP_REPORT_STATUS.rw_task_rest`，含义是 AP 当前剩余读写任务数。

因此如果连续点击多次下发，可能出现当下没反应、过一会儿集中刷几次的现象。原因通常是：

- 每次下发都会生成独立 `queue_id`，AP 会按读写任务排队。
- 价签不是一直在线监听，常在连接窗口到来时才执行队列任务。
- 图片类文档指令会先发 `AP_PSM` 再发 `ESL_WRITE`，快速重复点击会进一步增加任务数量。
- MQTT 和 WebSocket 两条投递通路可能都打开，AP 端最终仍会按自己的读写队列处理。

图片测试页现在显示“AP 队列状态”和“最近执行确认”：

- `rw_task_rest > 0`：说明 AP 还有读写任务没执行完，此时不要连续重复点击。
- `rw_task_rest = 0`：说明 AP 队列清空，但仍要看是否有 `WRITE_SVC` / `errno=0` 执行确认。
- `queue_id`：用于关联本次命令和 AP/价签回包。

图片测试页操作台复用 `POST /api/labels/:id/document-command`，价签操作包括：

```text
led          闪灯；本地复刻官方 search，下发 READ_WRITE_SVC 写 01-00-00-07
stop_led     停止闪灯
refresh      刷新数据 refresh_data
white        刷白屏 / 空图
image_led    刷图并闪灯
ndef         写入 NDEF
ota          价签 OTA
group_change 换组
```

基站操作包括：

```text
ap_svc_cfg   服务配置
ap_psm       PSM/休眠，支持 fast/default/slow/sleep/disable
ap_restart   程序重启
ap_reboot    系统重启
ap_channels  获取通道
ap_ota       基站 OTA
```

危险操作会二次确认：`ap_restart`、`ap_reboot`、`ap_ota`，以及 `ap_psm` 选择 `sleep` 时。所有操作发送后会显示 loading、返回结果、`queue_id` 和队列提示。

注意：官方接口里的闪灯不是 `ESL_WRITE.led`，而是由官方 WebSocket 下发 `READ_WRITE_SVC` 写 `01-00-00-07`。已抓到两种形态：

```text
search 闪灯:
  service=01-00-00-07
  b64dat=ZAAAAf88AA==
  bytes=64 00 00 01 ff 3c 00

direct + led 刷新并闪灯:
  cmds[0] CONN_DEV
  cmds[1] WRITE_SVC service=01-00-00-03/0c  图片数据
  cmds[2] WRITE_SVC service=01-00-00-07
  b64dat=AGQAZP8sAQ==
  bytes=00 64 00 64 ff 2c 01
```

因此图片测试页的“闪灯”和“下发图片同时闪灯”都不直接调用官方 API，而是在本项目里复刻对应 `READ_WRITE_SVC` 指令。勾选“下发图片同时闪灯”后，本地生成图片包会追加 `01-00-00-07 / AGQAZP8sAQ==`。

官方文档目前没有看到独立的“停止闪灯”接口。已知官方价签相关 API 包括：

```text
unbind        解绑并加入 refresh queue
bind          单价签绑定并加入 refresh queue
bind_multiple 批量绑定并加入 refresh queue
bind_task     触发 refresh queue
search        闪灯
sync          同步价签信息
direct        直接刷新，可携带 led 参数
query_status  查询指定价签
query         查询价签列表
query_count   查询统计
```

控制台“官方 API 实验”模块已把这些 action 加到下拉里。调用 `search`、`sync`、`direct`、`bind_task` 后会自动监听新的 `READ_WRITE_SVC` 捕获包，用于继续解析官方真实下发格式。

2026-04-29 复核官方文档 `API Reference` 后，官方 API 实验模块补齐了文档中的主要资源：

```text
query/env        查询官方环境信息

esl_ble          query / query_count / bind / bind_multiple / unbind / search / direct / del
esl              bind / bind_multiple / unbind / search / sync / direct / bind_task / query / query_count / query_status / del
esl_wifi         query / query_count / bind / bind_multiple / unbind / search / direct / del
nfc              query / query_count / direct / del
pad              bind / bind_multiple / unbind / del / query

product          create / create_multiple / del_multiple / query / query_count / query_with_code
productadjust    create_order / del_order / adjust_task
store            create / set
template         query
pad_template     query
user             create / delete
```

说明：官方文档没有提供“基站后台配置”的 HTTP API。基站接入服务器、热点隐藏、Wi-Fi 桥接/中继、USB 发射器配置等仍是基站本地 Web 后台操作：连接 `eslap-xxxxxxxx` 热点或同网段访问基站 IP，登录 `root/123456`，进入 `ESL--AP Config` / 网络无线菜单配置。

## 入口接口

控制台“图片测试”页最终应选择：

```text
渲染范围: 本地生成 0C 全屏（新解析）
服务器本地图片: 111111.jpg
发送模式: direct
```

对应后端接口：

```http
POST /api/official-api/send-image-4515-file-local-generated-auto-best
Content-Type: multipart/form-data
```

核心参数：

```text
apId=e4:38:19:2a:09:de
eslCode=17900170
renderMode=service0c_local
localImageName=111111.jpg
fourColor=true
renderPreset=2.13
canvasPreset=0c_800x480
renderScale=1
sendMode=direct
dryRun=false
```

也可以上传文件：

```text
file=<image/png | image/jpeg | image/webp>
```

如果同时上传 `file` 并填写 `localImageName`，优先使用上传文件；没有上传文件时，后端从项目根目录读取 `localImageName`。

## 图片转换流程

实现位置：

```text
apps/api/src/modules/official-api/official-api.service.ts
```

主要方法：

- `sendImage4515FileLocalGenerated()`
- `buildService0cFromImage()`
- `packImageToService0cRowsBytes()`
- `buildReadWriteSvcPayloadForService()`

### 1. 读取图片

图片来源有两种：

```text
multipart file
或
项目根目录 localImageName，例如 111111.jpg
```

本地文件读取会限制文件名不能包含 `/`、`\` 或以 `.` 开头，避免目录穿越。

### 2. 四色预处理

默认 `fourColor=true`，会先把图片量化到：

```text
黑: (0, 0, 0)
白: (255, 255, 255)
红: (255, 0, 0)
黄: (255, 255, 0)
```

这一步的目的，是避免后续编码时出现不可控的近似颜色。

### 3. 标签尺寸渲染

`service0c` 外层始终是 `800x480`，这是当前设备全屏通道的固定尺寸。

但图片内容不是必须铺满 `800x480`。当前逻辑会根据 `renderPreset` 决定内容区域大小，再居中贴到白底全屏画布上。

已支持的尺寸：

```text
1.54 -> 200x200
2.13 -> 250x122
2.6  -> 360x184
2.90 -> 296x128
3.7  -> 416x240
4.2  -> 400x300
5.83 -> 648x480
7.5  -> 800x480
10.2 -> 960x640
```

注意：

- 设备真实全屏画布是 `800x480`。
- 如果选择的尺寸大于 `800x480`，当前渲染会先按该尺寸生成，再贴入 800x480 画布，可能发生裁剪；实际使用建议优先选择不超过 `800x480` 的尺寸。
- `renderScale` 会在选定标签尺寸内部继续缩放，例如 `renderPreset=4.2` 且 `renderScale=0.5`，则内容约为 `200x150`，再居中放入 `400x300` 槽位，最后整体居中贴到 `800x480`。

### 4. 图片适配模式

`fit` 参数控制原图进入目标尺寸的方式：

```text
stretch        直接拉伸到目标尺寸
contain_black  等比包含，空白区域黑底
contain_white  等比包含，空白区域白底
cover          等比裁剪填满目标尺寸
```

当前默认仍是 `stretch`，如果希望避免图片比例变形，可以使用 `contain_white` 或 `cover`。

### 5. 2bpp 打包

`service0c` 解压后的原始位图数据是：

```text
800 x 480 pixels
2 bits / pixel
4 pixels / byte
200 bytes / row
480 rows
总长度 = 800 * 480 * 2 / 8 = 96000 bytes
```

当前像素码值：

```text
黑 code=0
白 code=1
黄 code=2
红 code=3
```

因此全白一字节为：

```text
01 01 01 01 (2bpp)
=> 0b01010101
=> 0x55
```

这也解释了为什么成功包中大量空白区域都是 `0x55`。

每 4 个像素按高位到低位写入 1 个字节：

```text
byte = (p0 << 6) | (p1 << 4) | (p2 << 2) | p3
```

## service0c 二进制容器格式

成功样本确认 `service0c` 与早期观察到的 `service03` 使用同类容器格式：

```text
a5 a6 0c 02 + N * [chunkId(1B) + compressedLen(LE16) + deflateRaw(payload)]
```

全屏 `service0c` 固定特征：

```text
magic: a5 a6 0c 02
chunk 数: 12
chunk 1..11 解压后长度: 8192 bytes
chunk 12 解压后长度: 5888 bytes
总解压长度: 96000 bytes
```

`96000` 正好对应：

```text
800 x 480 x 2bpp
```

当前本地生成逻辑：

```text
rawRows = 96000 bytes
按 8192 bytes 切分
每个 chunk 使用 zlib.deflateRawSync(level=9)
写入 chunkId 和 compressedLen
拼接 magic + chunks
base64 编码后放入 WRITE_SVC.b64dat
```

## READ_WRITE_SVC payload 格式

最终发送到基站 WebSocket 的 JSON 结构：

```json
{
  "type": "READ_WRITE_SVC",
  "opas": [
    {
      "addr": "17900170",
      "cmds": [
        {
          "id": 0,
          "type": "CONN_DEV"
        },
        {
          "id": 16,
          "type": "WRITE_SVC",
          "supersize": true,
          "mtu": 10000,
          "service": "01-00-00-0c",
          "b64dat": "<service0c base64>"
        }
      ]
    }
  ]
}
```

字段说明：

- `type=READ_WRITE_SVC`：AP 执行 BLE 读写服务任务。
- `opas[].addr`：目标价签编码，例如 `17900170`。
- `CONN_DEV`：连接价签。
- `WRITE_SVC`：向价签服务写入数据。
- `id=16`：当前固件/官方包中写服务命令使用的 id。
- `supersize=true`：`service0c` 大包必须使用该标记。
- `mtu=10000`：当前官方包与本地成功包保持一致。
- `service=01-00-00-0c`：全屏图像服务地址。
- `b64dat`：上文生成的 `service0c` 容器二进制的 base64。

成功回包示例：

```json
{
  "type": "READ_WRITE_SVC",
  "port": "/dev/ttyUSB0",
  "tasks_count": 1,
  "addr": "179001700A",
  "adv_ch_map": 32,
  "cmd": {
    "id": 16,
    "type": "WRITE_SVC",
    "service": "01-00-00-0C"
  },
  "res": {
    "chunk_num": 2,
    "chunk_idx": 1,
    "send_pkt_num": 372,
    "ack_pkt_num": 372,
    "write_time_ms": 1037,
    "errno": 0
  }
}
```

判断执行成功时，应看：

```text
cmd.type = WRITE_SVC
service = 01-00-00-0C
errno = 0
ack_pkt_num / send_pkt_num 有有效值
```

不要把 `CONN_DEV`、`DIS_CONN` 或单纯 `AP_REPORT_STATUS` 当作刷屏成功依据。

## 与 service03 的区别

实测过程中 `service03` 曾经也能写入成功，但表现为：

```text
画面只显示中间一条
或局部槽位变化
或露出旧底图
```

原因是：

- `service03` 使用同类 chunk 容器，但在当前模板/设备上不是最终全屏主图通道。
- `service03` 更接近模板槽位/局部图层数据，尤其与 `template_id=4515` 的 `#f2` 图片槽位相关。
- 全屏数据流必须转向 `service0c + supersize=true`。

因此最终本地全屏方案不再基于 `service03`。

## 基站如何连接本项目

基站配置页中填写服务器地址后，真实基站当前主要连接本项目后端的 WebSocket：

```text
ws://<API_HOST>:4000/ws
```

后端启动位置：

```text
apps/api/src/main.ts
```

关键流程：

```text
Nest API 启动
  -> mqtt.start()
  -> app.listen(API_PORT, 默认 4000)
  -> apWebsocket.attach(app.getHttpServer())
```

WebSocket 处理位置：

```text
apps/api/src/modules/ap-websocket/ap-websocket.service.ts
```

基站上行常见消息：

```text
AP_ONLINE
AP_CH_LIST
DEVICE_RETRIEVE
SLAVE_ADV_SVC
READ_WRITE_SVC 执行结果
AP_REPORT_STATUS
```

后端会维护在线 AP socket，并通过 `sendRaw(apId, payload)` 把 `READ_WRITE_SVC` 下行写回对应基站连接。

## MQTT 在项目中的角色

当前真实刷屏下行走的是 AP WebSocket，不是直接让基站订阅 MQTT command topic。

MQTT 在本项目中主要承担：

1. 内置 broker 或外部 EMQX 兼容层。
2. 把基站 WebSocket 上行桥接到 MQTT topic，方便观察和集成。
3. 外部 MQTT publish 可再转发到 WebSocket 下行。

MQTT 启动位置：

```text
apps/api/src/modules/mqtt/mqtt.service.ts
```

默认端口：

```text
MQTT TCP: 1883
MQTT WebSocket: API_PORT + 1，默认 4001
MQTT WebSocket path: /mqtt
```

桥接逻辑位置：

```text
apps/api/src/modules/ap-websocket/ap-websocket.service.ts
bridgeUplinkToMqtt()
```

上行桥接 topic：

```text
stores/{storeCode}/aps/{apId}/uplink
stores/{storeCode}/aps/{apId}/events/{messageType}
stores/{storeCode}/labels/{labelId}/events
```

例如：

```text
stores/20248517/aps/e4:38:19:2a:09:de/uplink
stores/20248517/aps/e4:38:19:2a:09:de/events/READ_WRITE_SVC
stores/20248517/labels/17900170/events
```

`apps/api/src/main.ts` 中还有：

```text
mqtt.onExternalPublish(({ topic, parsed }) => {
  apWebsocket.forwardMqttCommand(topic, parsed);
});
```

这表示如果使用外部 MQTT/EMQX，也可以把外部 publish 的命令转发到 AP WebSocket。

## 当前已固化的工程入口

主要用户入口：

```text
Web 控制台 -> 图片测试 -> 渲染范围 -> 本地生成 0C 全屏（新解析）
```

主要 API：

```text
POST /api/official-api/send-image-4515-file-local-generated-auto-best
```

`renderMode` 取值中，最终推荐：

```text
service0c_local
```

保留的辅助/诊断模式：

```text
service0c_replay  重放已捕获的完美 0C 包，用来确认链路
full              早期 service03 全屏实验，不作为最终全屏方案
f2slot            4515 #f2 槽位方案，稳定但不是全屏
official          官方接口辅助采样，不作为本地最终下发
```

## 已知边界

- 当前已确认 `800x480/2bpp/service0c` 在测试价签 `17900170` 上有效。
- 其他物理尺寸价签是否也都使用同一个 `800x480` 外层，需要继续用实机验证。
- `renderPreset` 当前控制“内容显示尺寸”，不是改变外层 service0c 的 `800x480` 设备画布。
- `service0c` 的颜色码值已按实测可显示逻辑固化：黑 0、白 1、黄 2、红 3；如果后续某些屏幕颜色反相或红黄互换，只需要调整 `packImageToService0cRowsBytes()` 中的 palette code。

## 最小复现

项目根目录放入：

```text
111111.jpg
```

控制台选择：

```text
目标基站: e4:38:19:2a:09:de
目标价签: 17900170
渲染范围: 本地生成 0C 全屏（新解析）
服务器本地图片: 111111.jpg
标签尺寸: 2.13 / 4.2 / 7.5 等
图片缩放: 1
发送模式: direct
```

成功时，状态应类似：

```text
执行确认成功：
trace 状态：ap_reply_seen
AP 回包：READ_WRITE_SVC
cmd=WRITE_SVC
ack/send=372 / 372
errno=0
write=1037ms
```
