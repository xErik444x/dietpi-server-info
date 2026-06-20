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

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function shuffle(arr) {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

function weatherRec(temp, code, windKmph) {
	const c = Number(code);
	const rain = (c >= 176 && c <= 200) || (c >= 263 && c <= 389);
	const windy = windKmph > 15;

	const vibe = {
		hot: [
			'El sol de Daggerfall cae implacable, lleva solo lo necesario',
			'Caminas por las llanuras ardientes de Tanaris, viaja ligero',
			'Las arenas de Desolacione te abrasan, no cargues peso',
			'Los desiertos de Kalimdor te esperan, viste ligero de armadura',
			'El sol de RuneScape cae sobre ti, destápate',
			'El aliento de dragón del Pantano del Dragón te abraza',
			'Las forjas de Khaz Modan son más frescas que afuera',
			'Los Dothraki cabalgarían ligeros con este sol',
			'El sol de Dorne cae sobre ti, no hay quien aguante',
			'Las arenas del Olvidado Reich te chamuscan',
			'Caminas sobre el asfalto ardiente de Ventormenta',
			'El clima de Stranglethorn es húmedo y caliente, viste ligero',
		],
		mild: [
			'El bosque de Elwynn te recibe, una capa ligera bastará',
			'Caminas por las verdes praderas de Azeroth, viste a tu gusto',
			'Los climas de la Comarca son amables, viaja cómodo',
			'Los reinos gozan de paz climática, viste ligero',
			'El clima de Lothlórien es templado, una túnica basta',
			'Los Valles de Tirisfal tienen brisa, viste a tu gusto',
			'Las verdes colinas de la Comarca invitan a caminar',
			'El río Anduin fluye tranquilo, clima apacible',
			'Los campos de Stormwind son templados, viste ligero',
			'Las calles de Bree son frescas, no hace falta mucho',
			'Los Reinos del Este gozan de buen clima, viste a tu gusto',
			'Caminas por las laderas de Dunland, clima benigno',
		],
		cool: [
			'El viento de Dun Morogh empieza a soplar, lleva capa',
			'Las montañas de Khaz Modan refrescan, abrígate',
			'El otoño llega a Rivendell, lleva capa de viajero',
			'El paso de montaña te espera, no subestimes el clima',
			'Los bosques de Felwood se enfrían, viste grueso',
			'Las colinas de Skyrim son frescas, lleva buen abrigo',
			'El clima de Norgaz se vuelve traicionero, abrígate',
			'Las nieves perpetuas de Cima Tormenta se acercan',
			'El paso de las Tres Cimas se vuelve frío, viste preparado',
			'Los Túneles de Terrallende tienen clima fresco, viste grueso',
			'El bosque de Mirkwood se enfría, lleva capa pesada',
			'Las calles de Hogsmeade se tornan frescas, abrígate',
		],
		cold: [
			'El frío de Skyrim te llama, viste grueso',
			'Las nieves de Dun Morogh te abrazan, lleva todo lo que tengas',
			'El invierno se acerca a Winterfell, viste como un Stark',
			'Las montañas de Kun-Lai son traicioneras, abrígate bien',
			'El frío de Forochel te congela el alma, viste grueso',
			'Los páramos de Rasganorte te hielan, viste capas',
			'Las tundras de Northrend te esperan, abrígate',
			'Los Túneles de Dun Morogh te enfrían los huesos',
			'Las cumbres de Gundabad son heladas, viste grueso',
			'El aliento de Arthas se congela, abrígate bien',
			'Los pasos de montaña de Khaz Modan son helados',
			'Las nieves de la Corona Invernal te esperan',
		],
		vcold: [
			'Las nieves de Rasganorte te abrazan, vístete como para la guerra',
			'El frío de Nordrassil te cala los huesos, lleva todo encima',
			'El paso del Caradhras te rechazará si no llevas todo',
			'Las Montañas de Krokul te piden ropaje grueso',
			'Los páramos de Rasganorte te convertirán en estatua',
			'Las tundras de Corona Invernal te hielan hasta el alma',
			'El frío de las Estepas de los Centauros es mortal',
			'Las nieves perpetuas de Cima Tormenta te observan',
			'Los pasos de Gundabad son letales sin buen abrigo',
			'Las heladas de Rasganorte no perdonan al caminante',
			'Las tundras del Norte te piden ropaje de dragón',
		],
		freezing: [
			'El clima de Rasganorte no perdona, solo los más aptos sobreviven',
			'Las nieves de Corona Invernal te cubrirán, lleva todo lo que tengas',
			'El aliento de Sartha se congela, vístete como un dragón',
			'El frío de Rasganorte te convertirá en estatua, no salgas',
			'Las nieves de Arthas te llaman, solo los locos o valientes se atreven',
			'Los páramos del Norte te convertirán en leyenda o en hielo',
			'El aliento de los Vrykul se congela antes de salir, abrígate o muere',
			'Las nieves eternas de Northrend te harán leyenda o ceniza',
			'Los páramos de Corona Invernal son la morada de Arthas, no seas valiente',
			'El frío del Vacío Abisal te espera al salir, viste como para sobrevivir',
			'Los páramos de Rasganorte han matado a más héroes que la guerra',
			'Las nieves del Trono Helado te convertirán en estatua',
		],
	};

	const cloth = {
		hot: [
			['túnica ligera', null], ['manto de lino', null], ['túnica de viaje', null],
			['vestido de verano', null], ['túnica de mago', null], ['pantalón corto', null],
		],
		mild: [
			['túnica de viaje', null], ['capa de viajero', null], ['manto ligero', null],
			['chaleco de cuero', null], ['capa élfica', null], ['túnica con capucha', null],
		],
		cool: [
			['capa pesada', null], ['túnica gruesa', null], ['chaleco acolchado', null],
			['manto de piel', null], ['capa de viajero', null], ['armadura de cuero', null],
		],
		cold: [
			['manto de lobo', null], ['armadura de cuero gruesa', null], ['capa pesada', null],
			['guanteletes', null], ['yelmo de cuero', null], ['túnica forrada', null],
			['capa con capucha', null], ['botas de montar', null],
		],
		vcold: [
			['armadura de placas', null], ['manto de oso polar', null], ['yelmo de hierro', null],
			['capa de dragón', null], ['guanteletes de acero', null], ['túnica forrada en piel', null],
			['doble par de pantalones', null], ['botas forradas', null],
		],
		freezing: [
			['armadura de dragón', null], ['yelmo de escarcha', null], ['capa de Sartha', null],
			['túnica de Northrend', null], ['guanteletes de adamantita', null], ['tres capas de piel', null],
			['doble par de pantalones', null], ['botas de escarcha', null], ['yelmo de Arthas', null],
		],
	};

	const connectors = ['lleva', 'porta', 'viste', 'carga', 'no olvides'];
	const rainItems = [
		'capa impermeable', 'paraguas de la Comarca', 'manto repelente',
	];

	let pool, clothPool, minCloth, maxCloth;
	if (temp >= 25) { pool = vibe.hot; clothPool = cloth.hot; minCloth = 1; maxCloth = 1; }
	else if (temp >= 18) { pool = vibe.mild; clothPool = cloth.mild; minCloth = 1; maxCloth = 2; }
	else if (temp >= 10) { pool = vibe.cool; clothPool = cloth.cool; minCloth = 2; maxCloth = 3; }
	else if (temp >= 5) { pool = vibe.cold; clothPool = cloth.cold; minCloth = 3; maxCloth = 4; }
	else if (temp >= 0) { pool = vibe.vcold; clothPool = cloth.vcold; minCloth = 3; maxCloth = 5; }
	else { pool = vibe.freezing; clothPool = cloth.freezing; minCloth = 4; maxCloth = 6; }

	const parts = [rand(pool)];

	const clothes = shuffle([...clothPool]).slice(0, Math.floor(Math.random() * (maxCloth - minCloth + 1)) + minCloth);
	if (clothes.length > 0) {
		const verb = rand(connectors);
		const items = clothes.map(([name]) => name);
		if (clothes.length === 1) parts.push(`${verb} ${items[0]}`);
		else parts.push(`${verb} ${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`);
	}

	if (rain) {
		const item = rand(rainItems);
		parts.push(`el clima de Shattrath es húmedo, lleva ${item}`);
	}
	if (windy) parts.push(rand([
		'el viento de la Tormenta Abisal sopla sobre ti',
		'los Djinn del aire cabalgan a tu lado',
		'cierra bien tu capa, el dragón del viento ruge',
		'cuidado con las corrientes de Alterac',
	]));

	return parts.join(', ');
}

function fetchWeather() {
	fetch('/api/weather')
		.then(r => r.ok ? r.json() : Promise.reject())
		.then(renderWeather)
		.catch(() => {
			// Fallback directo a wttr.in
			fetch('https://wttr.in/?format=j1')
				.then(r => r.json())
				.then(renderWeather)
				.catch(() => {
					weatherBody.innerHTML = '<div class="weather-loading">Weather unavailable</div>';
				});
		});
}

function renderWeather(data) {
	const cc = data.current_condition[0];
	const area = data.nearest_area[0];
	if (!cc || !area) {
		weatherBody.innerHTML = '<div class="weather-loading">Weather unavailable</div>';
		return;
	}
	const city = area.areaName[0].value;
	const country = area.country[0].value;
	weatherLoc.textContent = `${city}, ${country}`;

	const temp = Number(cc.temp_C);
	const desc = cc.weatherDesc[0].value;
	const hum = cc.humidity;
	const wind = Number(cc.windspeedKmph);
	const feel = cc.FeelsLikeC;
	const code = cc.weatherCode;
	const emoji = getWeatherEmoji(code);

	weatherBody.innerHTML = `
		<div class="weather-icon">${emoji}</div>
		<div>
			<div class="weather-temp">${temp}°C</div>
			<div class="weather-desc">${desc}</div>
		</div>
		<div class="weather-details">
			<span>🌡️ Sensación ${feel}°C</span>
			<span>💧 ${hum}% humedad</span>
			<span>💨 ${wind} km/h</span>
		</div>
		<div class="weather-rec">${weatherRec(temp, code, wind)}</div>
	`;
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
