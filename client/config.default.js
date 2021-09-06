module.exports = {
	/**
	 * Endpoint for pushing stats in the collector server
	 * Examples:
	 *   endpoint: 'ws://127.0.0.1:3939'
	 *   endpoint: 'https://hgls.example.io/collector'
	 */
	endpoint: 'ws://127.0.0.1:3939',


	/**
	 * Settings mysql

echo '[client]
host=127.0.0.1
user=root-or-other
password=***pass***' >> /root/.my2.cnf

	 */
	mysql: {
		extraFile: '/root/.my.cnf'
	},


	/**
	 * Settings pg-bouncer

	 echo '"pgbouncer" ""' >> /etc/pgbouncer/userlist.txt && systemctl restart pgbouncer

	 */
	pgBouncer: {
		user: 'postgres',
		port: 6432
	},


	/**
	 * Settings nginx
	 * add vhost nginx
	 server {
	 	listen 80 default;
    	server_name default;
		...
		location /hgls-nginx {
			access_log off;
			allow 127.0.0.1;
			deny all;
			stub_status on;
		}
		...
	}*/
	nginx: {
		host: '127.0.0.1',
		port: 80,
		path: '/hgls-nginx'
	},


	/**
	 * Settings fpm
	 * cmd: sed -i 's/;pm.status_path = \/status/pm.status_path = \/hgls-fpm/' /etc/php/*\/fpm/pool.d/www.conf
	 * and add vhost nginx
	 server {
	 	listen 80 default;
    	server_name default;
		...
		location /hgls-fpm {
			access_log off;
			allow 127.0.0.1;
			deny all;
			include /etc/nginx/fastcgi_params;
			fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
			fastcgi_pass unix:/run/php-fpm.sock;
		}
		...
	}*/
	fpm: {
		host: '127.0.0.1',
		port: 80,
		path: '/hgls-fpm'
	},
};