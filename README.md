# Kersen ESL Cloud

自建电子价签云平台雏形，用 React 做运营控制台，用 NestJS 做 API、WebSocket/MQTT 接入与命令桥接。目标是让新基站在 `ESL -> AP Config` 中填写你的云平台地址、门店编号、用户名、密码后，连接到这套服务。

## 当前已实现

- React 控制台：门店配置、基站状态、价签列表、命令下发。
- Nest API：登录、门店配置、基站登记/心跳、价签管理、命令发布。
- 内置 MQTT broker：TCP `1883`，WebSocket 默认 `4001/mqtt`，适合基站或模拟器接入。
- 逆向记录：见 [docs/reverse-notes.md](docs/reverse-notes.md)。
- AWS 部署草案：见 [docs/aws-deploy.md](docs/aws-deploy.md)。

## 本地运行

```bash
npm install
cp .env.example .env
npm run dev
```

前端默认运行在 `http://localhost:5173`，后端默认运行在 `http://localhost:4000`。

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
# kersen_display_cloud
