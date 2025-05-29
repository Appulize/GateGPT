#!/bin/bash

set -e

echo "GateGPT Installation Script"
echo

# === 1. Prompt for install directory ===
read -p "Install directory [$(pwd)]: " INSTALL_DIR
INSTALL_DIR="${INSTALL_DIR:-$(pwd)}"

# === 2. Prompt for Node.js binary path ===
DEFAULT_NODE_PATH="$(which node)"
read -p "Path to Node.js executable [$DEFAULT_NODE_PATH]: " NODE_PATH
NODE_PATH="${NODE_PATH:-$DEFAULT_NODE_PATH}"

# === 3. Detect current user ===
USER_NAME=$(whoami)

# === 4. Show summary ===
echo
echo "Installation Summary:"
echo "---------------------"
echo "Install directory     : $INSTALL_DIR"
echo "Node.js executable    : $NODE_PATH"
echo "Systemd service user  : $USER_NAME"
echo "Service name          : gate-gpt"
echo
read -p "Press Enter to begin installation or Ctrl+C to cancel..."

# === 5. Prepare systemd service file ===
SERVICE_FILE="gate-gpt.service"
TMP_SERVICE_FILE="/tmp/gate-gpt.service"

echo "Creating systemd service file..."

cat > "$TMP_SERVICE_FILE" <<EOF
[Unit]
Description=GateGPT
After=network.target

[Service]
WorkingDirectory=${INSTALL_DIR}
ExecStart=${NODE_PATH} .
Restart=always
RestartSec=10
User=${USER_NAME}
Environment=NODE_ENV=production
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# === 6. Copy files ===
echo "Copying project files to ${INSTALL_DIR}..."
mkdir -p "$INSTALL_DIR"
cp -r . "$INSTALL_DIR"

# === 7. Install the service ===
echo "Installing systemd service..."
sudo cp "$TMP_SERVICE_FILE" /etc/systemd/system/gate-gpt.service

# === 8. Enable and start ===
echo "Reloading and enabling service..."
sudo systemctl daemon-reexec
sudo systemctl daemon-reload
sudo systemctl enable gate-gpt.service
sudo systemctl restart gate-gpt.service

# === 9. Log in ===
echo "Following logs for GateGPT..."
sleep 1
journalctl -u gate-gpt -f