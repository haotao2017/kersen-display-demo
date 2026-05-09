# Kersen ESL Cloud

自建电子价签云平台雏形，用 React 做运营控制台，用 NestJS 做 API、WebSocket/MQTT 接入与命令桥接。目标是让新基站在 `ESL -> AP Config` 中填写你的云平台地址、门店编号、用户名、密码后，连接到这套服务。

## 当前已实现

- React 控制台：门店配置、基站状态、价签列表、命令下发。
- Nest API：登录、门店配置、基站登记/心跳、价签管理、命令发布。
- MQTT：支持内置 broker，也支持连接外部 EMQX。
- 价签渲染：后端生成 SVG 预览和 1bpp 黑白位图，下发命令会携带 `image.bitmap_b64`。
- 逆向记录：见 [docs/reverse-notes.md](docs/reverse-notes.md)。
- 图片全屏下发协议：见 [docs/image-downlink-service0c.md](docs/image-downlink-service0c.md)。
- AWS 部署草案：见 [docs/aws-deploy.md](docs/aws-deploy.md)。

## 本地运行

```bash
npm install
cp .env.example .env
npm run dev
```

前端默认运行在 `http://localhost:5173`，后端默认运行在 `http://localhost:4000`。

如需按生产形态本地测试 Postgres + Redis：

```bash
docker compose up -d postgres redis
npm run prisma:generate -w apps/api
npm run prisma:push -w apps/api
npm run dev
```

如需直接用 Docker 跑完整前后端：

```bash
cp .env.example .env
docker compose up --build
```

控制台访问 `http://localhost:8080`，API 访问 `http://localhost:4000`。API 容器启动时默认会执行 `prisma db push`，可通过 `PRISMA_DB_PUSH_ON_START=false` 关闭。

`DATABASE_URL` 配好后，门店、基站、标签、商品、模板、刷新任务会同步到 Postgres；不配置时仍使用本地 `apps/api/data/store.json`。`REDIS_URL` 配好后刷新任务进入 Redis/BullMQ 队列；不配置时使用进程内队列。

也可以分开启动，调试时推荐这种方式：

```bash
npm run dev -w apps/api
```

```bash
npm run dev -w apps/web
```

默认控制台账号来自后端内置种子数据：

- 用户名：`admin`
- 密码：`admin123456`

生产环境请改为数据库用户、强 JWT secret，并开启 HTTPS。

## 基站配置建议

基站页面填写：

- 服务器地址：你的后端公网域名或局域网 IP，例如 `https://api.example.com` 或 `http://192.168.1.23:4000`
- 门店编号：后台创建的 store code，例如 `20248517`
- 用户名：后台给基站使用的 store username
- 密码：后台给基站使用的 store password

注意：真实基站不能填写 `localhost`。`localhost` 在基站上指的是基站自己，不是运行后端的电脑。

如果基站固件实际只支持明文 HTTP 或固定 WebSocket/MQTT 路径，需要在 `apps/api/src/modules/mqtt/mqtt.service.ts` 里把 topic/path 适配成固件要求。

## 刷图说明

价签页的“下发”现在会先生成价签画面：

1. `GET /api/labels/{id}/render` 生成 SVG 预览和 1bpp 黑白位图。
2. `POST /api/labels/{id}/commands` 下发时会携带：
   - `image.preview_svg_b64`
   - `image.bitmap_format`
   - `image.bitmap_b64`
   - `image.width`
   - `image.height`

目前外层命令仍是逆向占位格式 `LABEL_COMMAND`。真实屏幕刷新还需要继续确认基站固件接受的刷屏命令名、分片格式、压缩格式和 ACK 流程。

## 刷新队列

商品更新、模板发布、绑定刷新、手动刷新都会先创建刷新任务，再进入队列执行。队列按基站限流，默认每个基站最多同时放行 6 个刷新任务，并在每次下发后保持一个短暂窗口，避免连续任务把 AP 内部 50 条读写队列打满。

关键环境变量：

- `REDIS_URL`：启用 Redis 持久队列，AWS 可用 ElastiCache Redis。
- `DATABASE_URL`：启用 Postgres 持久化，AWS 可用 RDS PostgreSQL。
- `UPLOAD_DIR`：上传图片目录，容器部署时必须挂载持久卷；AWS 上建议挂 EFS 或后续切 S3。
- `ESL_AP_REFRESH_CONCURRENCY=6`：单基站刷新并发上限。
- `ESL_AP_REFRESH_SLOT_HOLD_MS=30000`：每个刷新槽位下发后默认保持 30 秒。
- `ESL_REFRESH_WORKER_CONCURRENCY=12`：全局 worker 并发。
- `ESL_TASK_CREATE_BATCH_SIZE=50`：批量创建任务时的分批大小。

## MQTT 桥接

真实基站当前连接的是后端 WebSocket `/ws`，不是直接连接 EMQX。后端会作为 MQTT client 连接 EMQX，并把基站 WebSocket 上行桥接到这些 topic：

- `stores/{storeCode}/aps/{apId}/uplink`
- `stores/{storeCode}/aps/{apId}/events/{messageType}`
- `stores/{storeCode}/labels/{labelId}/events`

例如用 MQTTX/EMQX 客户端订阅：

```text
stores/20248517/#
```

即可看到 `AP_ONLINE`、`AP_CH_LIST`、`DEVICE_RETRIEVE`、`SLAVE_ADV_SVC` 等基站上报。
# kersen_display_cloud
