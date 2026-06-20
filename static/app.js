/* ─── App State ───────────────────────────────────────────────────────── */
const MAX_POINTS = 120; // 10 minutes at 5s intervals

const state = {
	cpu: [],
	mem: [],
	temp: [],
	netRX: [],
	netTX: [],
	prevNetRX: 0,
	prevNetTX: 0,
	prevNetTime: 0,
	connected: false,
};

/* ─── DOM Refs ─────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const hostnameEl    = $('hostname');
const statusDot     = $('statusDot');
const uptimeDisplay  = $('uptimeDisplay');
const timeDisplay   = $('timeDisplay');
const cpuValue      = $('cpuValue');
const cpuFreq       = $('cpuFreq');
const cpuCores      = $('cpuCores');
const memValue      = $('memValue');
const memBar        = $('memBar');
const memDetail     = $('memDetail');
const memSub        = $('memSub');
const diskSize      = $('diskSize');
const diskBar       = $('diskBar');
const diskPct       = $('diskPct');
const tempValue     = $('tempValue');
const netRX         = $('netRX');
const netTX         = $('netTX');
const load1         = $('load1');
const load5         = $('load5');
const load15        = $('load15');
const procsList     = $('procsList');
const procCount     = $('procCount');

/* ─── Canvas Setup ────────────────────────────────────────────────────── */
function chartHeights() {
	const landscape = window.innerWidth > window.innerHeight;
	if (landscape) {
		return { cpu: 50, mem: 35, temp: 35, net: 35 };
	}
	const w = window.innerWidth;
	if (w < 520) return { cpu: 60, mem: 40, temp: 40, net: 40 };
	if (w < 768) return { cpu: 80, mem: 50, temp: 50, net: 50 };
	return { cpu: 120, mem: 80, temp: 80, net: 80 };
}

function setupCanvas(id, h) {
	const canvas = document.getElementById(id);
	if (!canvas) return null;
	const rect = canvas.parentElement.getBoundingClientRect();
	const dpr = window.devicePixelRatio || 1;
	const w = Math.max(rect.width, 100);
	canvas.width = w * dpr;
	canvas.height = h * dpr;
	canvas.style.width = w + 'px';
	canvas.style.height = h + 'px';
	const ctx = canvas.getContext('2d');
	ctx.scale(dpr, dpr);
	return { ctx, w, h };
}

const charts = {};
function initCharts() {
	const defs = {
		cpuChart:  'cpuChart',
		memChart:  'memChart',
		tempChart: 'tempChart',
		netChart:  'netChart',
	};
	const heights = chartHeights();
	for (const [key, id] of Object.entries(defs)) {
		const setup = setupCanvas(id, heights[key.replace('Chart','')]);
		if (setup) charts[key] = setup;
	}
}

function resizeCharts() {
	const heights = chartHeights();
	for (const [key, ch] of Object.entries(charts)) {
		const id = key;
		const canvas = document.getElementById(id);
		if (!canvas) continue;
		const rect = canvas.parentElement.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		const w = Math.max(rect.width, 100);
		const h = heights[key.replace('Chart','')];
		canvas.width = w * dpr;
		canvas.height = h * dpr;
		canvas.style.width = w + 'px';
		canvas.style.height = h + 'px';
		ch.w = w;
		ch.h = h;
		ch.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	}
}

/* ─── Sparkline Drawing ────────────────────────────────────────────────── */
function drawSparkline(ctx, data, w, h, color, opts = {}) {
	const { min, max, fill = true, strokeWidth = 2 } = opts;
	ctx.clearRect(0, 0, w, h);

	const len = data.length;
	if (len < 2) return;

	const dataMin = min !== undefined ? min : Math.min(...data);
	const dataMax = max !== undefined ? max : Math.max(...data);
	const range = dataMax - dataMin || 1;

	const padding = 2;
	const drawW = w - padding * 2;
	const drawH = h - padding * 2;

	const points = data.map((v, i) => ({
		x: padding + (i / (len - 1)) * drawW,
		y: padding + drawH - ((v - dataMin) / range) * drawH,
	}));

	// Fill area
	if (fill) {
		ctx.beginPath();
		ctx.moveTo(points[0].x, padding + drawH);
		for (const p of points) ctx.lineTo(p.x, p.y);
		ctx.lineTo(points[points.length - 1].x, padding + drawH);
		ctx.closePath();
		const grad = ctx.createLinearGradient(0, padding, 0, padding + drawH);
		grad.addColorStop(0, color + '33');
		grad.addColorStop(1, color + '05');
		ctx.fillStyle = grad;
		ctx.fill();
	}

	// Line
	ctx.beginPath();
	ctx.moveTo(points[0].x, points[0].y);
	for (let i = 1; i < points.length; i++) {
		ctx.lineTo(points[i].x, points[i].y);
	}
	ctx.strokeStyle = color;
	ctx.lineWidth = strokeWidth;
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';
	ctx.stroke();

	// Dot at end
	const last = points[points.length - 1];
	ctx.beginPath();
	ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
	ctx.fillStyle = color;
	ctx.fill();
}

/* ─── Helpers ──────────────────────────────────────────────────────────── */
function formatBytes(bytes) {
	if (bytes === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const k = 1024;
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + units[i];
}

function formatUptime(secs) {
	const d = Math.floor(secs / 86400);
	const h = Math.floor((secs % 86400) / 3600);
	const m = Math.floor((secs % 3600) / 60);
	if (d > 0) return `${d}d ${h}h`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

function formatSpeed(bytesPerSec) {
	if (bytesPerSec < 0) return '—';
	const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
	const k = 1024;
	const i = Math.floor(Math.log(bytesPerSec || 1) / Math.log(k));
	return parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(1)) + ' ' + units[i];
}

function updateClock() {
	const now = new Date();
	timeDisplay.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/* ─── Update Functions ─────────────────────────────────────────────────── */
function updateCPU(m) {
	const cpu = m.cpu ?? 0;
	cpuValue.textContent = cpu + '%';
	cpuValue.className = 'card-value' + (cpu > 80 ? ' danger' : cpu > 60 ? ' warning' : '');
	cpuFreq.textContent = m.cpu_freq ? m.cpu_freq.toFixed(0) + ' MHz' : '';

	// Per-core bars
	let html = '';
	if (m.cpu_cores && m.cpu_cores.length > 0) {
		let i = 0;
		for (const pct of m.cpu_cores) {
			const cls = pct > 80 ? 'danger' : pct > 60 ? 'warning' : '';
			html += `<div class="core-pill"><div class="core-bar"><div class="core-fill ${cls}" style="width:${Math.min(pct,100)}%"></div></div><span>${i}</span></div>`;
			i++;
		}
	}

	cpuCores.innerHTML = html;

	// History & chart
	state.cpu.push(cpu);
	if (state.cpu.length > MAX_POINTS) state.cpu.shift();
	const ch = charts.cpuChart;
	if (ch) drawSparkline(ch.ctx, state.cpu, ch.w, ch.h, '#58A6FF', { strokeWidth: 2 });
}

function updateMemory(m) {
	const mem = m.memory || {};
	const up = mem.used_pct ?? 0;
	memValue.textContent = up + '%';
	memValue.className = 'card-value' + (up > 85 ? ' danger' : up > 70 ? ' warning' : '');
	memBar.style.width = Math.min(up, 100) + '%';
	memBar.className = 'bar-fill' + (up > 85 ? ' danger' : up > 70 ? ' warning' : '');
	memDetail.textContent = (mem.used_gb ?? 0).toFixed(1) + ' / ' + (mem.total_gb ?? 0).toFixed(1) + ' GB';

	if ((mem.swap_total_gb ?? 0) > 0) {
		memSub.textContent = `Swap: ${(mem.swap_used_gb ?? 0).toFixed(1)} / ${(mem.swap_total_gb ?? 0).toFixed(1)} GB (${mem.swap_used_pct ?? 0}%)`;
	} else {
		memSub.textContent = 'Swap: none';
	}

	state.mem.push(up);
	if (state.mem.length > MAX_POINTS) state.mem.shift();
	const ch = charts.memChart;
	if (ch) drawSparkline(ch.ctx, state.mem, ch.w, ch.h, '#2AD4A8', { strokeWidth: 2 });
}

function updateDisk(m) {
	const d = (m.disk && m.disk.length > 0) ? m.disk[0] : null;
	const usedPct = d ? (d.used_pct ?? 0) : 0;
	diskSize.textContent = d ? (d.used_gb ?? 0).toFixed(1) + ' / ' + (d.total_gb ?? 0).toFixed(1) + ' GB' : '—';
	diskBar.style.width = Math.min(usedPct, 100) + '%';
	diskBar.className = 'bar-fill' + (usedPct > 90 ? ' danger' : usedPct > 75 ? ' warning' : '');
	diskPct.textContent = usedPct + '%';
}

function updateTemperature(m) {
	const t = m.temperature;
	if (t && t > 0) {
		tempValue.textContent = t.toFixed(1) + '°C';
		tempValue.className = 'card-value' + (t > 80 ? ' danger' : t > 65 ? ' warning' : '');

		state.temp.push(t);
		if (state.temp.length > MAX_POINTS) state.temp.shift();
		const ch = charts.tempChart;
		if (ch) drawSparkline(ch.ctx, state.temp, ch.w, ch.h, '#F59E0B', { strokeWidth: 2 });
	} else {
		tempValue.textContent = '—';
	}
}

function updateNetwork(m) {
	const now = Date.now();
	if (state.prevNetTime > 0) {
		const dt = (now - state.prevNetTime) / 1000;
		if (dt > 0) {
			const rxSpeed = ((m.network_rx - state.prevNetRX) * 8) / dt; // bits per sec
			const txSpeed = ((m.network_tx - state.prevNetTX) * 8) / dt;
			netRX.textContent = formatSpeed(rxSpeed / 8); // bytes per sec
			netTX.textContent = formatSpeed(txSpeed / 8);

			state.netRX.push(rxSpeed / 8);
			state.netTX.push(txSpeed / 8);
			if (state.netRX.length > MAX_POINTS) state.netRX.shift();
			if (state.netTX.length > MAX_POINTS) state.netTX.shift();
		}
	}
	state.prevNetRX = m.network_rx;
	state.prevNetTX = m.network_tx;
	state.prevNetTime = now;

	// Draw combined network chart
	const ch = charts.netChart;
	if (ch && state.netRX.length > 0) {
		ch.ctx.clearRect(0, 0, ch.w, ch.h);
		// Upload (bottom, orange)
		drawSparkline(ch.ctx, state.netTX, ch.w, ch.h, '#F59E0B', { strokeWidth: 1.5, fill: false });
		// Download (top, blue)
		drawSparkline(ch.ctx, state.netRX, ch.w, ch.h, '#58A6FF', { strokeWidth: 1.5, fill: false });
	}
}

function updateLoad(m) {
	load1.textContent = (m.load_1m ?? 0).toFixed(2);
	load5.textContent = (m.load_5m ?? 0).toFixed(2);
	load15.textContent = (m.load_15m ?? 0).toFixed(2);
}

function updateProcesses(m) {
	if (!m.processes || m.processes.length === 0) {
		const html = '<div class="procs-placeholder">No data yet</div>';
		if (procsList.innerHTML !== html) procsList.innerHTML = html;
		procCount.textContent = '0';
		return;
	}
	procCount.textContent = m.processes.length;
	let html = '';
	for (const p of m.processes) {
		const stateChar = p.state === 'R' ? '▶' : p.state === 'S' ? '●' : p.state === 'Z' ? '✕' : '○';
		html += `<div class="proc-row">
			<span class="proc-pid">${p.pid}</span>
			<span class="proc-name">${stateChar} ${escHtml(p.name)}</span>
			<span class="proc-cpu">${p.cpu}%</span>
			<span class="proc-mem">${p.mem}%</span>
		</div>`;
	}
	if (procsList.innerHTML !== html) procsList.innerHTML = html;
}

/* ─── Services (HTTP/PM2 polling) ────────────────────────────────────────── */
const svcList = document.getElementById('servicesList');
const svcCount = document.getElementById('svcCount');

function fetchServices() {
	fetch('/api/services')
		.then(r => r.json())
		.then(data => {
			if (!data.services || data.services.length === 0) {
				const html = '<div class="services-placeholder">No listening services found</div>';
				if (svcList.innerHTML !== html) svcList.innerHTML = html;
				svcCount.textContent = '0';
				return;
			}
			const excludeNames = ['proftpd', 'dropbear', 'xrdp', 'nginx'];
			const filtered = data.services.filter(s => s.source !== 'pm2' && !excludeNames.includes(s.name));
			const pm2Count = data.services.length - filtered.length;
			const pm2Badge = pm2Count > 0 ? ` <span class="pm2-badge">+${pm2Count} pm2</span>` : '';
			svcCount.innerHTML = filtered.length + pm2Badge;
			let html = '';
			for (const s of filtered) {
				let portTag = '';
				if (s.port > 0) {
					portTag = `<span class="svc-tag ${s.type}">${s.port}</span>`;
				}
				const srcBadge = s.source === 'pm2' ? '<span class="svc-src pm2">pm2</span>' : '';
				const protoTag = s.protocol ? `<span class="svc-proto">${s.protocol}</span>` : '';
				html += `<div class="svc-row">
					<span class="svc-pid">${s.pid}</span>
					<span class="svc-name">${escHtml(s.name)}</span>
					${portTag}
					${protoTag}
					${srcBadge}
				</div>`;
			}
			if (svcList.innerHTML !== html) svcList.innerHTML = html;
		})
		.catch(() => {
			const html = '<div class="services-placeholder">Error fetching services</div>';
			if (svcList.innerHTML !== html) svcList.innerHTML = html;
		});
}

function escHtml(s) {
	const d = document.createElement('div');
	d.textContent = s;
	return d.innerHTML;
}

/* ─── SSE Connection ───────────────────────────────────────────────────── */
function connectSSE() {
	statusDot.className = 'status-dot connecting';

	const evtSource = new EventSource('/api/events');

	evtSource.onopen = () => {
		state.connected = true;
		statusDot.className = 'status-dot';
	};

	evtSource.onmessage = (e) => {
		try {
			const m = JSON.parse(e.data);
			applyMetrics(m);
		} catch (err) {
			console.error('Parse error:', err);
		}
	};

	evtSource.onerror = () => {
		state.connected = false;
		statusDot.className = 'status-dot disconnected';
		evtSource.close();
		setTimeout(connectSSE, 3000);
	};
}

function applyMetrics(m) {
	if (m.hostname) hostnameEl.textContent = m.hostname;
	if (m.uptime) uptimeDisplay.textContent = formatUptime(m.uptime);
	updateCPU(m);
	updateMemory(m);
	updateDisk(m);
	updateTemperature(m);
	updateNetwork(m);
	updateLoad(m);
	updateProcesses(m);
}

/* ─── Weather ──────────────────────────────────────────────────────────── */
const weatherDate = document.getElementById('weatherDate');
const weatherLoc = document.getElementById('weatherLoc');
const weatherBody = document.getElementById('weatherBody');

function updateDate() {
	const now = new Date();
	const dateStr = now.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
	const timeStr = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
	weatherDate.textContent = `${dateStr} · ${timeStr}`;
}

function weatherRec(temp, code) {
	const c = Number(code);
	const rain = (c >= 176 && c <= 200) || (c >= 263 && c <= 389);
	const items = [];
	if (rain) items.push('☂️ paraguas');
	if (temp >= 25) items.push('👕 remera');
	else if (temp >= 18) items.push('👕 ponete buzo');
	else if (temp >= 10) items.push('🧥 ponete campera');
	else items.push('🧊 abrigate chango');
	return '🛍️ ' + [...new Set(items)].join(' y ');
}

function fetchWeather() {
	fetch('https://wttr.in/?format=j1')
		.then(r => r.json())
		.then(data => {
			const cc = data.current_condition[0];
			const area = data.nearest_area[0];
			const city = area.areaName[0].value;
			const country = area.country[0].value;
			weatherLoc.textContent = `${city}, ${country}`;

			const temp = cc.temp_C;
			const desc = cc.weatherDesc[0].value;
			const hum = cc.humidity;
			const wind = cc.windspeedKmph;
			const feel = cc.FeelsLikeC;
			const code = cc.weatherCode;
			const emoji = getWeatherEmoji(code);

			weatherBody.innerHTML = `
				<div class="weather-icon">${emoji}</div>
				<div>
					<div class="weather-temp">${temp}°C</div>
					<div class="weather-desc">${desc}</div>
					<div class="weather-rec">${weatherRec(temp, code)}</div>
				</div>
				<div class="weather-details">
					<span>🌡️ Sensación ${feel}°C</span>
					<span>💧 ${hum}% humedad</span>
					<span>💨 ${wind} km/h</span>
				</div>
			`;
		})
		.catch(() => {
			weatherBody.innerHTML = '<div class="weather-loading">Weather unavailable</div>';
		});
}

function getWeatherEmoji(code) {
	const c = Number(code);
	if (c >= 113) return '☀️';
	if (c >= 116 && c <= 119) return '⛅';
	if (c >= 122 && c <= 143) return '☁️';
	if (c >= 176 && c <= 200) return '🌧️';
	if (c >= 227 && c <= 230) return '❄️';
	if (c >= 248 && c <= 260) return '🌫️';
	if (c >= 263 && c <= 389) return '🌦️';
	if (c >= 392 && c <= 395) return '🌨️';
	return '🌡️';
}

/* ─── Init ─────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
	// Register service worker
	if ('serviceWorker' in navigator) {
		navigator.serviceWorker.register('/sw.js').catch(() => {});
	}

	initCharts();
	updateClock();
	updateDate();
	setInterval(() => { updateClock(); updateDate(); }, 10000);
	connectSSE();
	fetchServices();
	setInterval(fetchServices, 15000);
	updateDate();
	fetchWeather();
	setInterval(fetchWeather, 600000); // every 10 min

	let resizeTimer;
	window.addEventListener('resize', () => {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(resizeCharts, 150);
	});
});
