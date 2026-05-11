# AWS 部署草案

推荐第一版用下面的结构：

- 前端：S3 + CloudFront
- 后端：ECS Fargate 或 EC2 Docker，镜像使用 `infra/Dockerfile.api`
- MQTT TCP：如果基站只能 TCP `1883`，用 Network Load Balancer 转发到后端任务
- MQTT WebSocket/API：用 Application Load Balancer 或 CloudFront 到后端 HTTPS
- 数据库：RDS PostgreSQL，设置 `DATABASE_URL`
- 队列：ElastiCache Redis，设置 `REDIS_URL`
- 上传文件：第一版可用 EFS 挂载到 `UPLOAD_DIR=/app/uploads`；后续大规模建议迁到 S3
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

## 一键快速部署 EC2

如果你不想在 AWS 控制台一个个点击创建，先用快速部署脚本：

```bash
aws configure
AWS_REGION=ap-east-1 bash infra/aws-ec2-quickstart.sh
```

脚本会自动完成：

- 创建 SSH key pair，保存到 `.aws-quickstart/`
- 创建安全组，开放 `22`、`80`、`4000`、`1883`
- 创建 Amazon Linux 2023 EC2
- 安装 Docker 和 Docker Compose
- 上传当前项目
- 自动生成生产环境变量 `.env.aws`
- 启动 `infra/docker-compose.ec2.yml`

部署完成后会输出：

```text
控制台: http://EC2_PUBLIC_IP
API:    http://EC2_PUBLIC_IP:4000
健康:   http://EC2_PUBLIC_IP:4000/ready
基站服务器地址填写: http://EC2_PUBLIC_IP:4000
```

停止并删除这台快速部署 EC2：

```bash
AWS_REGION=ap-east-1 bash infra/aws-ec2-destroy.sh
```

注意：这个快速部署方案把 Postgres 和 Redis 都跑在同一台 EC2 上，适合先跑通和小规模试用。正式长期生产建议迁移到 RDS PostgreSQL + ElastiCache Redis + EFS/S3。

完整本地容器运行：

```bash
cp .env.example .env
docker compose up --build
```

健康检查：

- `/health`：进程存活。
- `/ready`：数据库和队列可用性。ECS/ALB 建议用 `/ready`。

上线环境变量最低要求：

```text
NODE_ENV=production
API_PORT=4000
PUBLIC_SERVER_URL=https://api.your-domain.com
CONSOLE_URL=https://console.your-domain.com
CORS_ORIGIN=https://console.your-domain.com
JWT_SECRET=<强随机字符串>
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
UPLOAD_DIR=/app/uploads
ESL_AP_REFRESH_CONCURRENCY=6
ESL_AP_REFRESH_SLOT_HOLD_MS=30000
```

注意：API 容器默认不再自动执行 `prisma db push`，避免发布时误改已有数据。确需同步数据库结构时，再临时设置 `PRISMA_DB_PUSH_ON_START=true` 后单独执行数据库同步。
