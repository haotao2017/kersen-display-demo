# 逆向记录

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
