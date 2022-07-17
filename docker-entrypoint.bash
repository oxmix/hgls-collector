#!/usr/bin/env bash

cat /etc/fstab \
  | awk '$0 !~ /^#/ && $2 !~ /\/$/ && $3 ~ /ext4/ { print $2 }' \
  | xargs -r mkdir -p && mount -a -t ext4

/app/index.js 2>&1