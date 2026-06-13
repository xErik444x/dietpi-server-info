/* ─── App State ───────────────────────────────────────────────────────── */
const MAX_POINTS = 120; // 4 minutes at 2s intervals

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
function setupCanvas(id) {
	const canvas = document.getElementById(id);
	if (!canvas) return null;
	const rect = canvas.parentElement.getBoundingClientRect();
	const dpr = window.devicePixelRatio || 1;
	const w = Math.max(rect.width, 100);
	const h = canvas.height;
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
		cpuChart:  { id: 'cpuChart',  h: 120 },
		memChart:  { id: 'memChart',  h: 80 },
		tempChart: { id: 'tempChart', h: 80 },
		netChart:  { id: 'netChart', h: 80 },
	};
	for (const [key, def] of Object.entries(defs)) {
		const canvas = document.getElementById(def.id);
		if (!canvas) continue;
		canvas.height = def.h;
		const setup = setupCanvas(def.id);
		if (setup) charts[key] = setup;
	}
}

function resizeCharts() {
	for (const [key, ch] of Object.entries(charts)) {
		const canvas = document.getElementById(key === 'cpuChart' ? 'cpuChart' : key === 'memChart' ? 'memChart' : key === 'tempChart' ? 'tempChart' : 'netChart');
		if (!canvas) continue;
		const rect = canvas.parentElement.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		const w = Math.max(rect.width, 100);
		canvas.width = w * dpr;
		canvas.style.width = w + 'px';
		ch.w = w;
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
	cpuValue.textContent = m.cpu + '%';
	cpuValue.className = 'card-value' + (m.cpu > 80 ? ' danger' : m.cpu > 60 ? ' warning' : '');
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
	state.cpu.push(m.cpu);
	if (state.cpu.length > MAX_POINTS) state.cpu.shift();
	const ch = charts.cpuChart;
	if (ch) drawSparkline(ch.ctx, state.cpu, ch.w, ch.h, '#58A6FF', { strokeWidth: 2 });
}

function updateMemory(m) {
	const mem = m.memory;
	memValue.textContent = mem.used_pct + '%';
	memValue.className = 'card-value' + (mem.used_pct > 85 ? ' danger' : mem.used_pct > 70 ? ' warning' : '');
	memBar.style.width = Math.min(mem.used_pct, 100) + '%';
	memBar.className = 'bar-fill' + (mem.used_pct > 85 ? ' danger' : mem.used_pct > 70 ? ' warning' : '');
	memDetail.textContent = mem.used_gb.toFixed(1) + ' / ' + mem.total_gb.toFixed(1) + ' GB';

	if (mem.swap_total_gb > 0) {
		memSub.textContent = `Swap: ${mem.swap_used_gb.toFixed(1)} / ${mem.swap_total_gb.toFixed(1)} GB (${mem.swap_used_pct}%)`;
	} else {
		memSub.textContent = 'Swap: none';
	}

	state.mem.push(mem.used_pct);
	if (state.mem.length > MAX_POINTS) state.mem.shift();
	const ch = charts.memChart;
	if (ch) drawSparkline(ch.ctx, state.mem, ch.w, ch.h, '#2AD4A8', { strokeWidth: 2 });
}

function updateDisk(m) {
	if (!m.disk || m.disk.length === 0) {
		diskSize.textContent = '—';
		diskBar.style.width = '0%';
		diskPct.textContent = '0%';
		return;
	}
	const d = m.disk[0];
	diskSize.textContent = d.used_gb.toFixed(1) + ' / ' + d.total_gb.toFixed(1) + ' GB';
	diskBar.style.width = Math.min(d.used_pct, 100) + '%';
	diskBar.className = 'bar-fill' + (d.used_pct > 90 ? ' danger' : d.used_pct > 75 ? ' warning' : '');
	diskPct.textContent = d.used_pct + '%';
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
	load1.textContent = m.load_1m.toFixed(2);
	load5.textContent = m.load_5m.toFixed(2);
	load15.textContent = m.load_15m.toFixed(2);
}

function updateProcesses(m) {
	if (!m.processes || m.processes.length === 0) {
		procsList.innerHTML = '<div class="procs-placeholder">No data yet</div>';
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
	procsList.innerHTML = html;
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

/* ─── Init ─────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
	// Register service worker
	if ('serviceWorker' in navigator) {
		navigator.serviceWorker.register('/sw.js').catch(() => {});
	}

	initCharts();
	updateClock();
	setInterval(updateClock, 10000);
	connectSSE();

	let resizeTimer;
	window.addEventListener('resize', () => {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(resizeCharts, 150);
	});
});
