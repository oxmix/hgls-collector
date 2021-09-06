# hgls-collector
HGLS client collector module for [https://github.com/oxmix/highload-stats](https://github.com/oxmix/highload-stats)

## Install for Debian/Ubuntu/...
Execute in console
* Get code and install nodejs, sys utils, etc.
```bash
cd ~ && git clone https://github.com/oxmix/hgls-collector.git && cd ~/hgls-collector && bash ./install.sh
```

* Set up `config.js` if used remote endpoint
```bash
nano ./client/config.js
```

## Settings autostart through systemd
* run in console # `sudo ./systemd.sh`
* then use `systemctl status hgls-collector`

## Run console
* in console # `sudo ./client/index.js start` maybe also `stop|restart|debug`
* also check logs maybe errors `tail -f ./client/hgls-error.log`

## Setting access to MySql
```bash
echo '[client]
      host=127.0.0.1
      user=root-or-other
      password=***pass***' >> /root/.my.cnf
```

## Setting PgBouncer
```bash
echo '"pgbouncer" ""' >> /etc/pgbouncer/userlist.txt && systemctl restart pgbouncer
```

## Enable stats for Nginx and FPM
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
        deny all;
    }

    location /hgls-fpm {
        access_log off;
        include /etc/nginx/fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_pass unix:/run/phpX.X-fpm.sock;
        allow 127.0.0.1;
        deny all;
    }
}
```
* FPM
```bash
sed -i 's/;pm.status_path = \/status/pm.status_path = \/hgls-fpm/' /etc/php/*/fpm/pool.d/www.conf
```
* Then
```bash
nginx -s reload && systemctl restart phpX.X-fpm
```