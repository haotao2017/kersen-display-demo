# AWS 部署草案

推荐第一版用下面的结构：

- 前端：S3 + CloudFront
- 后端：ECS Fargate 或 EC2 Docker
- MQTT TCP：如果基站只能 TCP `1883`，用 Network Load Balancer 转发到后端任务
- MQTT WebSocket/API：用 Application Load Balancer 或 CloudFront 到后端 HTTPS
- 数据库：RDS PostgreSQL，后续把当前内存仓库替换为 Prisma/TypeORM
- 域名：Route 53，建议 `api.your-domain.com` 指向后端

安全要点：

- 生产环境必须改 `JWT_SECRET`。
- 不要把旧云平台密码放入前端构建产物。
- 基站默认密码应在安装后修改。
- MQTT 生产环境建议启用 TLS、设备级账号和 topic ACL。

Docker 本地构建：

```bash
docker build -f infra/Dockerfile.api -t kersen-esl-api .
docker run --env-file .env -p 4000:4000 -p 1883:1883 kersen-esl-api
```
