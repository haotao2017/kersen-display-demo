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
- `03 128x250`：官方 `15403FCA + 4518` 匹配，生成 `01-00-00-03` / `a5 a6 01 02` / 1bpp / `128x250`；官方包解压长度为 `4000 bytes = 128 x 250 x 1bpp / 8`，只能显示黑白，红/黄会丢失。
- `03-02 128x250`：`15403FCA` 彩色实验项，生成 `a5 a6 02 02` / 2bpp / `128x250`；不是本次官方抓包形态，用来验证该屏是否也接受同尺寸四色包。
- `03-02 200x200`：官方 `1700009F + 4518` 匹配，生成 `01-00-00-03` / `a5 a6 02 02` / 2bpp / `200x200`；官方包解压长度为 `10000 bytes = 200 x 200 x 2bpp / 8`。
- `03-02 128x296`：官方 `173014D6 + 4518` 匹配，生成 `01-00-00-03` / `a5 a6 02 02` / 2bpp / `128x296`；官方包解压长度为 `9472 bytes = 128 x 296 x 2bpp / 8`。本地测试优先使用 `03-02 128x296#b0y2r3w1`，颜色按实测 `黄 -> 白`、`白 -> 红`、`红 -> 黄` 的错位修正。
- `03-02 152x296`：官方 `17200227 + 4518` 匹配，生成 `01-00-00-03` / `a5 a6 02 02` / 2bpp / `152x296`；官方包解压长度为 `11248 bytes = 152 x 296 x 2bpp / 8`。本地测试优先使用 `03-02 152x296#b0y2r3w1`。
- `03-03 184x384`：官方 `174004d2 + 4518` 匹配，生成 `01-00-00-03` / `a5 a6 03 02` / 2bpp / `184x384`；官方包解压长度为 `17664 bytes = 184 x 384 x 2bpp / 8`。
- `03-03 184x384#b0y2r3w1`：按 `174004d2` 本地实测颜色错位修正；此前 `b0/y1/r2/w3` 下表现为 `黄 -> 白`、`白 -> 红`、`红 -> 黄`，因此改测 `black=0 / yellow=2 / red=3 / white=1`。
- 不要使用 `03-03 368x192` 测 `174004d2`：它虽然同样是 `17664 bytes`，但行字节变成 `92`，而官方真实行字节是 `46`，设备按真实行宽读取时会出现横向细条和错位。
- `03-04 400x300`：官方 `176002f7 + 4518` 匹配，生成 `01-00-00-03` / `a5 a6 04 02` / 2bpp / `400x300`。
- `03-04 240x416`：官方 `17500175 + 4518` 匹配，生成 `01-00-00-03` / `a5 a6 04 02` / 2bpp / `240x416`；官方包解压长度为 `24960 bytes = 240 x 416 x 2bpp / 8`。不要按 `416x240` 解读，否则会出现横向条纹。
- `03-0A 648x480`：官方 `1770008e + 4518` 匹配，生成 `01-00-00-03` / `a5 a6 0a 02` / 2bpp / `648x480`。
- `03-01/03-03/03-04/03-0A` 的 2bpp 颜色码和 `0C` 不同：官方包显示白底主要为 `0xff`，本地按 `black=0 / yellow=1 / red=2 / white=3` 生成。
- `03 WxH strideN totalM`：显示区仍按 `WxH` 渲染，但输出帧按指定行字节/行数补齐，用于排查上下重叠、行跨度不匹配的问题。
- 图片测试页的“图片旋转/图片翻转”只在生成像素数据前处理源图，不会自动联动“标签尺寸”或“画布/编码尺寸”；遇到镜像问题时先保持角度不变，再单独切换“水平镜像/垂直镜像”排查。

如果强行给小屏写入 800x480 的 `service0c`，设备会把数据按自己的小屏格式解释，常见现象就是白屏或黑白竖条。`15403fca` 官方样本对应 `03 200x160`，但实际不同批次可能有差异，可以在页面里逐个试画布尺寸。

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
