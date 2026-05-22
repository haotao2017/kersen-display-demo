#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-kersen-esl}"
AWS_REGION="${AWS_REGION:-ap-east-1}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.small}"
AMI_ID="${AMI_ID:-}"
KEY_NAME="${KEY_NAME:-${APP_NAME}-key}"
SECURITY_GROUP_NAME="${SECURITY_GROUP_NAME:-${APP_NAME}-sg}"
REMOTE_DIR="${REMOTE_DIR:-/opt/${APP_NAME}}"
SSH_USER="${SSH_USER:-ec2-user}"
COMMAND="${1:-deploy}"
COMMAND_ARG="${2:-}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${ROOT_DIR}/.aws-quickstart"
KEY_PATH="${STATE_DIR}/${KEY_NAME}.pem"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "缺少命令：$1"
    exit 1
  }
}

random_secret() {
  openssl rand -hex "$1"
}

latest_amazon_linux_2023_ami() {
  local ami_id
  ami_id="$(aws ssm get-parameter \
    --region "$AWS_REGION" \
    --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
    --query 'Parameter.Value' \
    --output text 2>/dev/null || true)"

  if [ -n "$ami_id" ] && [ "$ami_id" != "None" ]; then
    echo "$ami_id"
    return
  fi

  ami_id="$(aws ec2 describe-images \
    --region "$AWS_REGION" \
    --owners amazon \
    --filters \
      "Name=name,Values=al2023-ami-2023.*-kernel-*-x86_64" \
      "Name=architecture,Values=x86_64" \
      "Name=virtualization-type,Values=hvm" \
      "Name=root-device-type,Values=ebs" \
      "Name=state,Values=available" \
    --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
    --output text 2>/dev/null || true)"

  if [ -n "$ami_id" ] && [ "$ami_id" != "None" ]; then
    echo "$ami_id"
    return
  fi

  cat >&2 <<EOF
无法自动获取 Amazon Linux 2023 AMI。

请任选一种方式处理：
1. 给当前 IAM 用户增加权限：ssm:GetParameter 和 ec2:DescribeImages
2. 手动指定 AMI_ID 后重试，例如：
   AWS_REGION=${AWS_REGION} AMI_ID=ami-xxxxxxxx bash infra/aws-ec2-quickstart.sh
EOF
  exit 1
}

default_vpc_id() {
  aws ec2 describe-vpcs \
    --region "$AWS_REGION" \
    --filters Name=isDefault,Values=true \
    --query 'Vpcs[0].VpcId' \
    --output text
}

my_public_ip_cidr() {
  local ip
  ip="$(curl -fsSL https://checkip.amazonaws.com | tr -d '[:space:]')"
  echo "${ip}/32"
}

ensure_key_pair() {
  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  if aws ec2 describe-key-pairs --region "$AWS_REGION" --key-names "$KEY_NAME" >/dev/null 2>&1; then
    if [ ! -f "$KEY_PATH" ]; then
      echo "AWS 已存在密钥 ${KEY_NAME}，但本地缺少 ${KEY_PATH}。请设置 KEY_NAME 使用已有本地 pem，或删除 AWS 上同名 key pair 后重试。"
      exit 1
    fi
    return
  fi

  aws ec2 create-key-pair \
    --region "$AWS_REGION" \
    --key-name "$KEY_NAME" \
    --query 'KeyMaterial' \
    --output text > "$KEY_PATH"
  chmod 600 "$KEY_PATH"
}

ensure_security_group() {
  local vpc_id sg_id ssh_cidr
  vpc_id="$(default_vpc_id)"
  sg_id="$(aws ec2 describe-security-groups \
    --region "$AWS_REGION" \
    --filters "Name=group-name,Values=${SECURITY_GROUP_NAME}" "Name=vpc-id,Values=${vpc_id}" \
    --query 'SecurityGroups[0].GroupId' \
    --output text)"

  if [ "$sg_id" = "None" ] || [ -z "$sg_id" ]; then
    sg_id="$(aws ec2 create-security-group \
      --region "$AWS_REGION" \
      --group-name "$SECURITY_GROUP_NAME" \
      --description "${APP_NAME} quickstart" \
      --vpc-id "$vpc_id" \
      --query 'GroupId' \
      --output text)"
  fi

  ssh_cidr="$(my_public_ip_cidr)"
  for rule in "tcp 22 ${ssh_cidr}" "tcp 80 0.0.0.0/0" "tcp 4000 0.0.0.0/0" "tcp 1883 0.0.0.0/0"; do
    set -- $rule
    aws ec2 authorize-security-group-ingress \
      --region "$AWS_REGION" \
      --group-id "$sg_id" \
      --protocol "$1" \
      --port "$2" \
      --cidr "$3" >/dev/null 2>&1 || true
  done

  echo "$sg_id"
}

launch_instance() {
  local sg_id ami_id instance_id
  sg_id="$1"
  ami_id="${AMI_ID:-$(latest_amazon_linux_2023_ami)}"
  if [ -z "$ami_id" ] || [ "$ami_id" = "None" ]; then
    echo "AMI_ID 为空，无法创建 EC2。" >&2
    exit 1
  fi

  instance_id="$(aws ec2 run-instances \
    --region "$AWS_REGION" \
    --image-id "$ami_id" \
    --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" \
    --security-group-ids "$sg_id" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${APP_NAME}}]" \
    --query 'Instances[0].InstanceId' \
    --output text)"

  if [ -z "$instance_id" ] || [ "$instance_id" = "None" ]; then
    echo "EC2 创建失败：没有拿到 InstanceId。" >&2
    exit 1
  fi

  echo "$instance_id" > "${STATE_DIR}/instance-id"
  aws ec2 wait instance-running --region "$AWS_REGION" --instance-ids "$instance_id"
  echo "$instance_id"
}

instance_public_ip() {
  aws ec2 describe-instances \
    --region "$AWS_REGION" \
    --instance-ids "$1" \
    --query 'Reservations[0].Instances[0].PublicIpAddress' \
    --output text
}

wait_for_ssh() {
  local host="$1"
  for _ in $(seq 1 60); do
    if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -i "$KEY_PATH" "${SSH_USER}@${host}" 'echo ok' >/dev/null 2>&1; then
      return
    fi
    sleep 5
  done
  echo "等待 SSH 超时：${host}"
  exit 1
}

write_env_file() {
  local host="$1"
  local jwt_secret postgres_password
  jwt_secret="$(random_secret 32)"
  postgres_password="$(random_secret 18)"
  cat > "${STATE_DIR}/.env.aws" <<EOF
NODE_ENV=production
API_PORT=4000
MQTT_TCP_PORT=1883
MQTT_WS_PATH=/mqtt
MQTT_MODE=embedded
JWT_SECRET=${jwt_secret}
CORS_ORIGIN=http://${host}
CONSOLE_URL=http://${host}
PUBLIC_SERVER_URL=http://${host}:4000
POSTGRES_PASSWORD=${postgres_password}
UPLOAD_DIR=/app/uploads
ESL_AP_REFRESH_CONCURRENCY=3
ESL_AP_REFRESH_SLOT_HOLD_MS=45000
ESL_REFRESH_WORKER_CONCURRENCY=6
ESL_TASK_CREATE_BATCH_SIZE=50
ESL_REFRESH_AUTO_RETRY=true
ESL_REFRESH_AUTO_RETRY_MAX=4
ESL_REFRESH_RETRY_DELAY_MS=15000
ESL_REFRESH_RETRY_WAKE_WAIT_MS=9000
ESL_REFRESH_PRE_WAKE_DELAY_MS=800
ESL_REFRESH_PRE_WRITE_DELAY_MS=1200
ESL_LABEL_KEEPALIVE_ENABLED=true
ESL_LABEL_KEEPALIVE_INTERVAL_MS=90000
PERSISTENT_SAVE_DEBOUNCE_MS=5000
PRISMA_TRANSACTION_MAX_WAIT_MS=15000
PRISMA_TRANSACTION_TIMEOUT_MS=60000
PRISMA_DB_PUSH_ON_START=true
UPSTREAM_STORE_CODE=${UPSTREAM_STORE_CODE:-20248517}
UPSTREAM_USERNAME=${UPSTREAM_USERNAME:-20248517}
UPSTREAM_PASSWORD=${UPSTREAM_PASSWORD:-}
AP_PROXY_OFFICIAL=false
OFFICIAL_CLOUD_URL=${OFFICIAL_CLOUD_URL:-http://43.153.107.21}
PUBLIC_HOST=${host}
EOF
}

sync_project() {
  local host="$1"
  rsync -az --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude 'apps/api/dist' \
    --exclude 'apps/web/dist' \
    --exclude 'apps/api/data' \
    --exclude 'apps/api/uploads' \
    --exclude '.env.aws' \
    --exclude 'uploads' \
    --exclude 'kersen_display_cloud_Test' \
    -e "ssh -o StrictHostKeyChecking=no -i ${KEY_PATH}" \
    "${ROOT_DIR}/" "${SSH_USER}@${host}:${REMOTE_DIR}/"

  scp -o StrictHostKeyChecking=no -i "$KEY_PATH" "${STATE_DIR}/.env.aws" "${SSH_USER}@${host}:${REMOTE_DIR}/.env.aws"
}

install_and_start() {
  local host="$1"
  ssh -o StrictHostKeyChecking=no -i "$KEY_PATH" "${SSH_USER}@${host}" "REMOTE_DIR='${REMOTE_DIR}' bash -s" <<'EOF'
set -euo pipefail
sudo dnf update -y
sudo dnf install -y docker git rsync
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER" || true
if ! docker compose version >/dev/null 2>&1; then
  sudo mkdir -p /usr/local/lib/docker/cli-plugins
  sudo curl -fsSL "https://github.com/docker/compose/releases/download/v2.27.1/docker-compose-linux-x86_64" -o /usr/local/lib/docker/cli-plugins/docker-compose
  sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi
cd "$REMOTE_DIR"
sudo docker compose --env-file .env.aws -f infra/docker-compose.ec2.yml up -d --build
EOF
}

saved_host() {
  if [ -f "${STATE_DIR}/public-ip" ]; then
    cat "${STATE_DIR}/public-ip"
    return
  fi
  echo "没有找到 ${STATE_DIR}/public-ip，请先运行 deploy。" >&2
  exit 1
}

remote_compose() {
  local host="$1"
  shift
  ssh -o StrictHostKeyChecking=no -i "$KEY_PATH" "${SSH_USER}@${host}" "cd '${REMOTE_DIR}' && sudo docker compose --env-file .env.aws -f infra/docker-compose.ec2.yml $*"
}

show_status() {
  local host
  host="$(saved_host)"
  echo "Host: ${host}"
  ssh -o StrictHostKeyChecking=no -i "$KEY_PATH" "${SSH_USER}@${host}" "cd '${REMOTE_DIR}' && sudo docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"
  echo
  curl -sS --connect-timeout 5 "http://${host}:4000/ready" || true
  echo
}

main() {
  need aws
  need ssh
  need scp
  need rsync
  need curl
  need openssl

  case "$COMMAND" in
    deploy)
      ;;
    ps)
      remote_compose "$(saved_host)" ps
      return
      ;;
    logs)
      remote_compose "$(saved_host)" logs --tail=200 ${COMMAND_ARG}
      return
      ;;
    status)
      show_status
      return
      ;;
    restart)
      remote_compose "$(saved_host)" up -d --build
      return
      ;;
    *)
      cat <<EOF
用法:
  AWS_REGION=${AWS_REGION} bash infra/aws-ec2-quickstart.sh deploy
  AWS_REGION=${AWS_REGION} bash infra/aws-ec2-quickstart.sh status
  AWS_REGION=${AWS_REGION} bash infra/aws-ec2-quickstart.sh ps
  AWS_REGION=${AWS_REGION} bash infra/aws-ec2-quickstart.sh logs api
  AWS_REGION=${AWS_REGION} bash infra/aws-ec2-quickstart.sh restart
EOF
      exit 1
      ;;
  esac

  mkdir -p "$STATE_DIR"
  ensure_key_pair
  sg_id="$(ensure_security_group)"
  instance_id="$(launch_instance "$sg_id")"
  host="$(instance_public_ip "$instance_id")"
  echo "$host" > "${STATE_DIR}/public-ip"

  wait_for_ssh "$host"
  ssh -o StrictHostKeyChecking=no -i "$KEY_PATH" "${SSH_USER}@${host}" "sudo mkdir -p '${REMOTE_DIR}' && sudo chown '${SSH_USER}:${SSH_USER}' '${REMOTE_DIR}'"
  write_env_file "$host"
  sync_project "$host"
  install_and_start "$host"

  cat <<EOF

部署已提交。

控制台: http://${host}
API:    http://${host}:4000
健康:   http://${host}:4000/ready

基站服务器地址填写: http://${host}:4000
门店编号: ${UPSTREAM_STORE_CODE:-20248517}

密钥文件: ${KEY_PATH}
实例 ID: ${instance_id}
EOF
}

main "$@"
