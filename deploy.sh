#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Fetching latest changes..."
sudo git fetch

echo "==> Pulling latest changes..."
sudo git pull

echo "==> Rebuilding and restarting containers..."
sudo docker compose up --build -d

echo "==> Deploy complete."
