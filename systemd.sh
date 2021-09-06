#!/usr/bin/env bash

exec=`realpath ./client/index.js`
if [ ! -f $exec ]; then
    echo "Not found path: $exec"
    exit
fi

echo "[Unit]
Description=https://github.com/oxmix/hgls-collector
After=network-online.target

[Service]
Type=simple
ExecStart=$exec
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target" | sudo tee /etc/systemd/system/hgls-collector.service > /dev/null

sudo chmod 644 /etc/systemd/system/hgls-collector.service

sudo systemctl daemon-reload
sudo systemctl enable hgls-collector.service
sudo systemctl restart hgls-collector.service
sudo systemctl status hgls-collector.service
