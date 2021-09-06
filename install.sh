#!/usr/bin/env bash

if [[ ! -f "./client/config.js" ]]; then
  cp ./client/config.default.js ./client/config.js
fi

chmod +x ./systemd.sh
chmod +x ./client/index.js

curl -sL https://deb.nodesource.com/setup_14.x | sudo -E bash - \
  && sudo apt-get -y update \
  && sudo apt-get install nodejs php-cli \
  && ifstat sysstat smartmontools \
  && redis-tools postgresql-client mysql-client

cd ./client && npm i