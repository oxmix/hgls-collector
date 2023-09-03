# hgls-collector
[![CI Status](https://github.com/oxmix/hgls-collector/workflows/Build%20and%20publish/badge.svg)](https://github.com/oxmix/hgls-collector/actions/workflows/hub-docker.yaml)
[![Docker Pulls](https://img.shields.io/docker/pulls/oxmix/hgls-collector.svg?logo=docker)](https://hub.docker.com/r/oxmix/hgls-collector)

HGLS client collector module for [https://github.com/oxmix/highload-stats](https://github.com/oxmix/highload-stats)

## Run docker container
* Execute in the console
```bash
$ docker run -d --name hgls-collector \
  --restart always --log-opt max-size=5m \
  --network host --privileged \
  -e ENDPOINT=https://example.host/collector \
  -v /etc/fstab:/etc/fstab:ro \
  -v /var/log/auth.log:/var/log/auth.log:ro \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /root/.my.cnf:/root/.my.cnf:ro \
  -v /root/.pgpass:/root/.pgpass:ro \
oxmix/hgls-collector
```

## Deployment manifest for [container-ship](https://github.com/oxmix/container-ship)
```yaml
space: hgls
name: collector-deployment
containers:
  - name: collector
    from: oxmix/hgls-collector:2
    privileged: true
    runtime: nvidia
    network: host
    restart: always
    log-opt: max-size=5m
    volumes:
      - /etc/fstab:/etc/fstab:ro
      - /var/log/auth.log:/var/log/auth.log:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /root/.my.cnf:/root/.my.cnf:ro
      - /root/.pgpass:/root/.pgpass:ro
    environment:
      - ENDPOINT=https://example.host/collector
      - NVIDIA_VISIBLE_DEVICES=all
      - NVIDIA_DRIVER_CAPABILITIES=compute,utility,video
```

* Environments defaults
```bash
# Endpoint for pushing stats in the collector server
# Examples:
#    endpoint: 'ws://127.0.0.1:3939'
#    endpoint: 'https://hgls.example.io/collector'
$ docker run ... -e ENDPOINT=ws://127.0.0.1:3939

# Nginx and FPM
$ docker run ... \
    -e NGINX_HOST=127.0.0.1 \
    -e NGINX_PORT=80 \
    -e NGINX_PATH=/hgls-nginx \
    -e FPM_PATH=/hgls-fpm
```

* How overwrite `config.default.js`, if you need
```bash
$ docker ... -v config.js:/app/config.default.js ...
```

## Additional settings

### Setting access to MySql
```bash
$ echo '[client]
      host=127.0.0.1
      user=root-or-other
      password=***pass***' >> /root/.my.cnf
```

### Setting PgBouncer
```bash
 $ USER='pgbouncer'
 $ PASS='***pass***'
 $ PASS_MD5=$(echo -n "$PASS$USER" | md5sum | awk '{print $1}')
 $ echo "\"pgbouncer\" \"md5$PASS_MD5\"" >> /etc/pgbouncer/userlist.txt && systemctl restart pgbouncer
 $ echo "127.0.0.1:6432:pgbouncer:pgbouncer:$PASS" >> /root/.pgpass

 # test
 $ psql -h 127.0.0.1 -p 6432 -U pgbouncer pgbouncer
```

### Enable stats for Nginx and FPM
* Nginx add server
```nginx
server {
    listen 80 default;
    listen [::]:80 ipv6only=on;
    server_name default;

    location / {
        return 444;
    }

    location /hgls-nginx {
        stub_status on;
        access_log off;
        allow 127.0.0.1;
        allow 172.16.0.0/12;
        deny all;
    }

    location /hgls-fpm {
        access_log off;
        include /etc/nginx/fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_pass /run/php/php*-fpm.sock;
        allow 127.0.0.1;
        allow 172.16.0.0/12;
        deny all;
    }
}
```
* FPM
```bash
$ sed -i 's/;pm.status_path = \/status/pm.status_path = \/hgls-fpm/' /etc/php/*/fpm/pool.d/www.conf
```
* Then
```bash
$ nginx -s reload && systemctl restart php*
```
