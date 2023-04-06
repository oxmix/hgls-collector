#!/usr/bin/env node

const wss = require('ws'),
	{
		exec,
		spawn
	} = require('child_process'),
	http = require('http'),
	os = require("os");

let debug = false;
const processName = 'hgls-collector'
switch (process.argv[2]) {
	case 'start':
		console.log('Start ' + processName);
		exec(__dirname + '/index.js > ' + __dirname + '/error.log 2>&1 &');
		return;

	case 'stop':
		console.log('Kill ' + processName);
		exec('killall ' + processName);
		return;

	case 'restart':
		console.log('Restart ' + processName);
		exec('killall ' + processName);
		exec(__dirname + '/index.js > ' + __dirname + '/error.log 2>&1 &');
		return;

	case 'debug':
		console.log('Start ' + processName + ' with debug mode');
		debug = true;
		break;
}
process.title = processName;

/**
 * Print info memory usage process
 */
(function () {
	setInterval(function () {
		let infoMem = [];
		const pmu = process.memoryUsage();
		for (const s in pmu) {
			if (pmu.hasOwnProperty(s))
				infoMem.push(s + ': ' + Math.round(pmu[s] / 1024) + 'Kb');
		}
		log('info', '[hgls-collector] memory usage ' + infoMem.join(' / '));
	}, 3 * 60 * 1000);
}());

const ws = new wss(process.env.ENDPOINT || 'ws://127.0.0.1:3939');
let isOpen = false;
ws.onerror = function (event) {
	log('error', '[ws] ' + event.toString())
}

ws.on('open', function open() {
	isOpen = true;
	log('info', '[connect] open');
});

ws.on('close', function open() {
	isOpen = false;
	log('info', '[connect] close');
	process.exit(0);
});

ws.on('message', function incoming(message) {
	log('debug', '[message] ' + message);
});

const send = function (object) {
	if (!isOpen)
		return;
	try {
		object.hostname = os.hostname();
		object.time = (new Date).getTime();
		object = JSON.stringify(object);
		ws.send(object);
		log('debug', '[send] ' + object);
	} catch (err) {
		log('warn', '[send] ' + err.toString());
	}
};

// cpu cores stat
var cpuPrev = {};
setInterval(function () {
	try {
		exec('cat /proc/stat', function (error, stdout, stderr) {
			var cores = [];
			stdout.match(/(cpu\d+).+/g).forEach(function (cpu, num) {
				num = ++num;
				cpu = cpu.split(' ');

				if (!cpuPrev[num])
					cpuPrev[num] = {};

				var idle = cpu[4];
				var total = 0;
				cpu.forEach(function (e) {
					if (+e > 0)
						total += +e;
				});

				var diffIdle = idle - (cpuPrev[num].idle || 0);
				var diffTotal = total - (cpuPrev[num].total || 0);

				cpuPrev[num].idle = idle;
				cpuPrev[num].total = total;

				cores.push(Math.floor((1000 * (diffTotal - diffIdle) / diffTotal + 5) / 10));
			});

			if (!cores.length)
				return;

			var avg = (cores.reduce(function (a, b) {
				return a + b;
			}, 0) / cores.length).toFixed(2);

			send({
				event: 'cpu',
				avg: parseFloat(avg),
				cores: cores
			});
		});
	} catch (e) {
		log('error', '[cpu exec] failed: ' + e.toString());
	}
}, 1000);

// memory
setInterval(function () {
	try {
		exec('cat /proc/meminfo', function (error, stdout, stderr) {
			var regex = /(.*?):.*?([0-9]+)/g;
			var mem = {};
			var m;
			while ((m = regex.exec(stdout)) !== null) {
				if (m[1] === 'MemTotal' || m[1] === 'MemFree' || m[1] === 'Buffers' || m[1] === 'Cached'
					|| m[1] === 'Slab' || m[1] === 'Shmem' || m[1] === 'SwapTotal' || m[1] === 'SwapFree') {
					mem[m[1]] = +m[2];
				}
			}
			mem['Used'] = mem['MemTotal'] - mem['MemFree'] - mem['Buffers'] - mem['Cached'] - mem['Slab'];
			mem['SwapUsed'] = mem['SwapTotal'] - mem['SwapFree'];
			mem['Total'] = mem['MemTotal'] + mem['SwapTotal'];

			send({
				event: 'memory',
				memory: mem
			});
		});
	} catch (e) {
		log('error', '[memory exec] failed: ' + e.toString());
	}
}, 1000);

// IO disk stats io/read/write
var ioStatCall = function () {
	var ioStat = spawn('iostat', ['-xkdH', '1', '-g', 'ALL', '-o', 'JSON']);
	var buff = '';
	ioStat.stdout.on('data', function (data) {
		data = data.toString();
		if (data.indexOf('sysstat') !== -1)
			return;

		buff += data.trim().replace(/\n/g, '').replace(/\t/g, '');
		if (buff.trim().substr(-3) !== '}]}' && buff.trim().substr(-4) !== '}]},') {
			return;
		} else {
			data = buff;
			buff = '';
		}

		try {
			data = JSON.parse(data.replace('},', '}').replace(',{', '{'));
		} catch (e) {
			log('warn', '[io-disk] error parse json');
			return;
		}

		if (!('disk' in data) || !(0 in data['disk']))
			return;

		data = data['disk'][0];

		send({
			event: 'io-disk',
			io: Math.round(data['util']),
			read: Math.round(data['rkB/s'] * 1024),
			write: Math.round(data['wkB/s'] * 1024)
		});
	});
};
ioStatCall();

// bandwidth stats in/out kbps
var interfaces = [];
var bandwidth = spawn('ifstat', ['-b']);
bandwidth.stdout.on('data', function (data) {
	let dataLines = data.toString().split("\n");
	dataLines.pop();
	if (dataLines.length === 3) {
		interfaces = dataLines[0].split(/\s/).filter(function (value, index, self) {
			return self.indexOf(value) === index;
		});
		interfaces.splice(0, 1);
	} else {
		let columns = dataLines[0].split(/\s/).filter(function (v) {
			return v !== ''
		})
		let bandwidth = [],
			k = 0;
		interfaces.forEach(function (ifs) {
			if (ifs.substr(0, 3) === 'br-' || ifs.substr(0, 4) === 'veth') {
				k += 2;
			} else {
				bandwidth.push({
					if: ifs + ' in',
					kbps: parseFloat(columns[k++])
				});
				bandwidth.push({
					if: ifs + ' out',
					kbps: parseFloat(columns[k++])
				});
			}
		});

		send({
			event: 'bandwidth',
			bandwidth: bandwidth,
		});
	}
});

// space
setInterval(function () {
	try {
		var space = spawn('findmnt', ['-s', '--df', '--json', '--bytes']);
		space.stdout.on('data', (data) => {
			try {
				data = JSON.parse(data);
			} catch (_) {
			}
			if (!data.filesystems)
				return;

			let total = 0;
			const space = [];
			data.filesystems.forEach((e) => {
				if (e.fstype !== 'ext4')
					return;
				e.used = e.used / 1024 ** 2;
				e.avail = e.avail / 1024 ** 2;
				space.push([e.target, e.used, e.avail]);
				total += e.used + e.avail;
			});

			send({
				event: 'space',
				total: total,
				space: space
			});
		});
	} catch (e) {
		log('error', '[space exec] failed: ' + e.toString());
	}
}, 1000);

// gpu
let gpuSpawn = spawn('nvidia-smi', ['-q', '-x', '-l', '1']).on('error', function (err) {
	log('error', '[gpu] err: ' + err.toString().replace('Error:', ''));
});
let gpuBuff = '';
const gpuRegex = new RegExp(`<product_name>(.*?)</product_name>.*?<pci_device>([0-9]+)</pci_device>
.*?<tx_util>([0-9]+) KB/s</tx_util>.*?<rx_util>([0-9]+) KB/s</rx_util>.*?<fan_speed>([0-9]+) %</fan_speed>
.*?<fb_memory_usage>.*?<used>([0-9]+) MiB</used>.*?<free>([0-9]+) MiB</free>.*?</fb_memory_usage>
.*?<gpu_util>([0-9]+) %</gpu_util>.*?<memory_util>([0-9]+) %</memory_util>.*?<encoder_util>([0-9]+) %</encoder_util>
.*?<decoder_util>([0-9]+) %</decoder_util>.*?<gpu_temp>([0-9]+) C</gpu_temp>.*?
.*?<memory_temp>(.+?)</memory_temp>.*?<power_draw>([0-9.]+) W</power_draw>
.*?<clocks>.*?<graphics_clock>([0-9]+) MHz</graphics_clock>.*?<sm_clock>([0-9]+) MHz</sm_clock>
.*?<mem_clock>([0-9]+) MHz</mem_clock>.*?<video_clock>([0-9]+) MHz</video_clock>.*?</clocks>`, 'sg');
gpuSpawn.stdout.on('data', function (data) {
	gpuBuff += data.toString();
	if (gpuBuff.substr(-18).trim() === '</nvidia_smi_log>') {
		gpuParse(gpuBuff);
		gpuBuff = '';
	}
	if (gpuBuff.length > 1024 * 1024) {
		gpuBuff = '';
	}
});

const gpuParse = function (buff) {
	let gpu = [];
	let match;
	while ((match = gpuRegex.exec(buff)) !== null) {
		// this is necessary to avoid infinite loops with zero-width matches
		if (match.index === gpuRegex.lastIndex) {
			gpuRegex.lastIndex++;
		}
		let k = 0;
		gpu.push({
			name: match[++k],
			pciDev: match[++k],
			pciTx: +match[++k],
			pciRx: +match[++k],
			fan: +match[++k],
			memUse: +match[++k],
			memFree: +match[++k],
			utilGpu: +match[++k],
			utilMem: +match[++k],
			utilEnc: +match[++k],
			utilDec: +match[++k],
			tmpGpu: +match[++k],
			tmpMem: +match[++k] || 0,
			power: +match[++k],
			clockSh: +match[++k],
			clockSm: +match[++k],
			clockMem: +match[++k],
			clockVideo: +match[++k]
		});
	}

	send({
		event: 'gpu',
		gpu: gpu
	});
};


// docker
let dockerContainers = {};

function dockerRefresh() {
	http.request({
		socketPath: '/var/run/docker.sock',
		path: 'http://localhost/v1.38/containers/json',
	}, (res) => {
		let buff = [];

		res.on('data', function (chunk) {
			buff.push(chunk)
		})

		res.on('end', function () {
			try {
				JSON.parse(Buffer.concat(buff).toString()).forEach(c => {
					const name = c.Names[0].substring(1)
					if (name in dockerContainers)
						return;

					dockerContainers[name] = []

					setTimeout(() => dockerWatcher(c.Id, name))
				})
			} catch (e) {
			}
		})
	}).on('error', () => dockerContainers = {}).end()
}

dockerRefresh()
setInterval(() => dockerRefresh(), 3000)

function dockerWatcher(id, name) {
	http.request({
		socketPath: '/var/run/docker.sock',
		path: `http://localhost/v1.38/containers/${id}/stats`,
	}, (res) => {
		res.on('data', function (chunk) {
			try {
				const stats = JSON.parse('' + chunk)

				const system_cpu_delta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage
				const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage
				const cpu = +(((cpuDelta / system_cpu_delta) * stats.cpu_stats.online_cpus * 100.0) || .0).toFixed(2)
				const memory = (stats.memory_stats.usage - stats.memory_stats.stats.cache) || 0

				dockerContainers[name] = [cpu, memory]
			} catch (e) {
			}
		})

		res.on('end', () => delete dockerContainers[name])
		res.on('close', () => delete dockerContainers[name])
	}).on('error', (err) => {
		log('error', '[docker-watcher] err: ' + err.toString())
		delete dockerContainers[name]
	}).end()
}

setInterval(() => {
	if (!Object.keys(dockerContainers).length)
		return

	send({
		event: 'docker',
		docker: dockerContainers
	})
}, 1000)


// mysql
var sqlQuery = "SHOW GLOBAL STATUS WHERE Variable_name IN (" +
	"'Bytes_received', 'Bytes_sent', 'Innodb_data_read', 'Innodb_data_written'," +
	"'Uptime', 'Connections', 'Max_used_connections', 'Queries', 'Slow_queries'," +
	"'Com_select', 'Com_update', 'Com_insert', 'Com_delete'," +
	"'Com_alter_table', 'Com_drop_table', 'Created_tmp_tables', 'Created_tmp_disk_tables');";
var mysqlMem = {};
var mysqlInterval = setInterval(function () {
	try {
		var mysqlSn = spawn('mysql', ['--defaults-extra-file=/root/.my.cnf', '-e', sqlQuery]);
		mysqlSn.on('error', function () {
			log('warn', '[mysql] client not found');
			clearInterval(mysqlInterval);
		});
		mysqlSn.stdout.on('data', function (out) {
			var mysql = {
				info: {},
				traffic: {},
				innodb: {},
				queries: []
			};
			out.toString().match(/(\w+)\t(\d+)/gm).forEach(function (value) {
				var keyVal = value.split(/\t/);
				var key = keyVal[0].toLowerCase().replace('com_', '').replace(/_/g, ' ');
				var val = keyVal[1];
				switch (key) {
					case 'uptime':
					case 'max used connections':
						mysql['info'][key] = parseInt(val);
						break;

					case 'bytes received':
					case 'bytes sent':
						mysql['traffic'][key] = val - mysqlMem[key] || 0;
						mysqlMem[key] = val;
						break;

					case 'innodb data read':
					case 'innodb data written':
						mysql['innodb'][key] = val - mysqlMem[key] || 0;
						mysqlMem[key] = val;
						break;

					default:
						mysql['queries'].push({
							k: key,
							v: val - mysqlMem[key] || 0
						});
						mysqlMem[key] = val;
						break;
				}
			});
			mysql['queries'].push({
				k: 'slaves latency',
				v: mysqlMem['slaves latency']
			});

			var slavesLatency = 0;
			exec('mysql --defaults-extra-file=/root/.my.cnf -e "SHOW SLAVE STATUS\\G"',
				function (error, stdout, stderr) {
					var sbm = stdout.match(/Seconds_Behind_Master: (\d+)/gm);
					if (!sbm)
						return;
					sbm.forEach(function (value) {
						var keyVal = value.split(/: /);
						slavesLatency += parseInt(keyVal[1]);
					});
					mysqlMem['slaves latency'] = slavesLatency;
				});

			send({
				event: 'mysql',
				mysql: mysql
			});
		});
	} catch (e) {
		log('error', '[mysql exec] failed: ' + e.toString());
	}
}, 1000);

// redis
let redisMem = {};
let redisWorked = false;
let redisInterval = setInterval(redisCollect, 1000);

function redisCollect() {
	try {
		exec("redis-cli info", function (error, stdout, stderr) {
			if (error) {
				log('error', '[redis] stderr: ' + stderr);
				clearInterval(redisInterval);
				if (redisWorked) {
					log('info', '[redis] retrying after 10 sec');
					redisMem = {};
					setTimeout(() => redisInterval = setInterval(redisCollect, 1000), 10000);
				}
				return;
			}
			redisWorked = true;
			var out = stdout.match(/(.*?):([0-9.]+)/gm);
			if (!out)
				return;
			var redis = {
				queries: [],
				traffic: {}
			};
			out.forEach(function (value) {
				var keyVal = value.split(':');
				var key = keyVal[0].toLowerCase();
				var val = keyVal[1];
				switch (key) {
					case 'total_connections_received':
						redis['queries'].push({
							k: 'connections',
							v: val - redisMem[key] || 0
						});
						redisMem[key] = val;
						break;
					case 'total_commands_processed':
						redis['queries'].push({
							k: 'commands',
							v: val - redisMem[key] || 0
						});
						redisMem[key] = val;
						break;

					case 'used_memory':
						redis['memory'] = +val;
						redisMem[key] = val;
						break;
				}
			});

			send({
				event: 'redis',
				redis: redis
			});
		});
	} catch (e) {
		log('error', '[redis exec] failed: ' + e.toString());
	}
}

// pg-bouncer
let pgBouncerMem = {};
let pgBouncerSpawn = null;
let pgBouncerInterval = null;
let pgBouncerWorked = false;
pgBouncerCollect();

function pgBouncerCollect() {
	pgBouncerSpawn = spawn('psql', ['-h', '127.0.0.1', '-p', (process.env.PGBOUNCER_PORT || 6432),
		'-wU', 'pgbouncer', 'pgbouncer']);
	pgBouncerSpawn.stdout.on('data', function (data) {
		pgBouncerWorked = true;
		var rows = data.toString().split("\n");
		rows.pop();
		rows.pop();
		var head = rows.shift().split('|');
		var pgBouncer = {
			sent: 0,
			received: 0,
			queries: []
		};
		rows.forEach(function (row) {
			row = row.split('|');
			var dbName = row[0].trim();
			if (dbName === 'pgbouncer')
				return;

			row.forEach(function (val, key) {
				val = val.trim();
				var name = head[key].trim();
				if (name === 'total_sent')
					pgBouncer.sent += val - pgBouncerMem[key] || 0;

				if (name === 'total_received')
					pgBouncer.received += val - pgBouncerMem[key] || 0;

				pgBouncerMem[key] = +val;

				if (name === 'total_query_count' || name === 'total_requests') {
					pgBouncer.queries.push({
						k: dbName,
						v: val - pgBouncerMem[key + dbName] || 0
					});

					pgBouncerMem[key + dbName] = +val;
				}
			});
		});

		send({
			event: 'pg-bouncer',
			pgBouncer: pgBouncer
		});
	});

	pgBouncerSpawn.stderr.on('data', function (e) {
		clearInterval(pgBouncerInterval);
		log('error', '[pgbouncer] stderr: ' + e);
		if (pgBouncerWorked) {
			log('info', '[pgbouncer] trying reconnect after 10 sec');
			pgBouncerMem = {};
			setTimeout(() => pgBouncerCollect(), 10000);
		}
	});

	pgBouncerInterval = setInterval(function () {
		pgBouncerSpawn.stdin.write('SHOW STATS;\n');
	}, 1000);
}

// nginx
var nginxMem = {};
var nginxStats = function () {
	http.get({
		host: process.env.NGINX_HOST || '127.0.0.1',
		port: process.env.NGINX_PORT || 80,
		path: process.env.NGINX_PATH || '/hgls-nginx'
	}, function (res) {
		if (res.statusCode !== 200) {
			log('error', '[nginx] get status: ' + res.statusCode);
			setTimeout(nginxStats, 1000 * 60);
			return;
		}

		var data = '';
		res.on('data', function (chunk) {
			data += chunk;
		});

		res.on('end', function () {
			var ngx = data.match(/([0-9]+)/gm);
			if (!ngx) {
				log('error', '[nginx] regex failed');
				return;
			}

			var nginx = [
				['connections', +ngx[0]],
				['accepts', +ngx[1] - nginxMem['accepts'] || 0],
				['handled', +ngx[2] - nginxMem['handled'] || 0],
				['requests', +ngx[3] - nginxMem['requests'] || 0],
				['reading', +ngx[4]],
				['writing', +ngx[5]],
				['waiting', +ngx[6]]
			];

			nginxMem['accepts'] = +ngx[1];
			nginxMem['handled'] = +ngx[2];
			nginxMem['requests'] = +ngx[3];

			send({
				event: 'nginx',
				nginx: nginx
			});

			setTimeout(nginxStats, 1000);
		});
	}).on('error', function (e) {
		log('error', '[nginx] get http: ' + e.message);
		setTimeout(nginxStats, 1000 * 60);
	});
};
nginxStats();

// fpm
let fpmMem = {};
let fpmStats = function () {
	http.get({
		host: process.env.NGINX_HOST || '127.0.0.1',
		port: process.env.NGINX_PORT || 80,
		path: (process.env.FPM_PATH || '/hgls-fpm') + '?full&json'
	}, function (res) {
		if (res.statusCode !== 200) {
			log('warn', '[fpm] get status: ' + res.statusCode);
			setTimeout(fpmStats, 1000 * 60);
			return;
		}

		let data = '';
		res.on('data', function (chunk) {
			data += chunk;
		});

		let fpmJ;
		res.on('end', function () {
			try {
				fpmJ = JSON.parse(data);
			} catch (e) {
				log('warn', '[fpm] json parse failed: ' + e.toString());
				setTimeout(fpmStats, 1000 * 10);
				return;
			}

			let runtime = 0,
				quantity = 0;
			fpmJ.processes.forEach(function (e) {
				if (e['request uri'].indexOf('/hgls-fpm') !== -1)
					return;
				runtime += e['request duration'];
				quantity++;
			});

			runtime = quantity > 0 && runtime > 0 ? parseFloat((runtime / quantity / 1e6).toFixed(3)) : 0;
			runtime = runtime > 1e5 ? 0 : runtime;

			let fpm = [
				['active processes', fpmJ['active processes']],
				['idle processes', fpmJ['idle processes']],
				['slow requests', fpmJ['slow requests'] - fpmMem['slow requests'] || 0],
				['accepted conn', fpmJ['accepted conn'] - fpmMem['accepted conn'] || 0],
				['runtime avg', runtime]
			];
			fpmMem['slow requests'] = fpmJ['slow requests'];
			fpmMem['accepted conn'] = fpmJ['accepted conn'];

			send({
				event: 'fpm',
				fpm: fpm
			});

			setTimeout(fpmStats, 1000);
		});
	}).on('error', function (e) {
		log('error', '[fpm] get http: ' + e.message.toString());
		setTimeout(fpmStats, 1000 * 60);
	});
};
fpmStats();

// telemetry
let telemetry = {
	'disks': '',
	'who': ''
};
const telemetryCollect = function () {
	// uname
	exec('uname -a', function (error, stdout, stderr) {
		telemetry['uname'] = stdout.trim();
	});
	// uptime
	exec('uptime', function (error, stdout, stderr) {
		telemetry['uptime'] = stdout.trim();
	});
	// disks
	if (telemetry['disks'] === '') {
		telemetry['disks'] = '...';
		exec('php ' + __dirname + '/disks.php', function (error, stdout, stderr) {
			try {
				telemetry['disks'] = JSON.parse(stdout);
			} catch (err) {
				log('error', 'telemetry-disks: ' + err.toString())
			}
		});
	}
	// who
	try {
		exec("tail -n 300 /var/log/auth.log | grep -i 'sshd\\[.*\\]: Accepted\\|login\\['",
			function (error, stdout, stderr) {
				telemetry['who'] = stdout;
			});
	} catch (err) {
		log('error', 'telemetry-who: ' + err.toString())
	}
	// memory collector
	let infoMem = [];
	const pmu = process.memoryUsage();
	for (const s in pmu) {
		if (pmu.hasOwnProperty(s))
			infoMem.push(s + ': ' + Math.round(pmu[s] / 1024 / 1024) + ' MB');
	}
	telemetry['collector'] = infoMem.join(', ');

	send({
		event: 'telemetry',
		telemetry: telemetry
	});
};
setInterval(function () {
	telemetry['disks'] = '';
}, 60 * 60 * 1000);
telemetryCollect();
setInterval(telemetryCollect, 10000);


function log(type, msg) {
	if (!debug && (type === 'debug' || type === 'msg'))
		return false;

	let color = '\u001b[0m',
		reset = '\u001b[0m';

	switch (type) {
		case 'info':
			color = '\u001b[36m';
			break;
		case 'warn':
			color = '\u001b[33m';
			break;
		case 'error':
			color = '\u001b[31m';
			break;
		case 'msg':
			color = '\u001b[34m';
			break;
		case 'debug':
			color = '\u001B[35m';
			break;
		default:
			color = '\u001b[0m'
	}

	console.log('[' + color + type + reset + '] ' + msg);

	return true;
}
