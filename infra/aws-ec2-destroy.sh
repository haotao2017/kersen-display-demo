#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-kersen-esl}"
AWS_REGION="${AWS_REGION:-ap-east-1}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${ROOT_DIR}/.aws-quickstart"

if [ ! -f "${STATE_DIR}/instance-id" ]; then
  echo "没有找到 ${STATE_DIR}/instance-id，无法确认要删除哪台 EC2。"
  exit 1
fi

INSTANCE_ID="$(cat "${STATE_DIR}/instance-id")"
aws ec2 terminate-instances --region "$AWS_REGION" --instance-ids "$INSTANCE_ID" >/dev/null
aws ec2 wait instance-terminated --region "$AWS_REGION" --instance-ids "$INSTANCE_ID"
echo "已终止 EC2：${INSTANCE_ID}"
echo "安全组和 key pair 未自动删除，避免误删你可能复用的资源。"
