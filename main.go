package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// ─── Metrics ───────────────────────────────────────────────────────────────

type ProcInfo struct {
	PID   int     `json:"pid"`
	Name  string  `json:"name"`
	CPU   float64 `json:"cpu"`
	Mem   float64 `json:"mem"`
	RSS   uint64  `json:"rss"`
	State string  `json:"state"`
}

type MemStats struct {
	TotalGB     float64 `json:"total_gb"`
	UsedGB      float64 `json:"used_gb"`
	UsedPct     float64 `json:"used_pct"`
	SwapTotalGB float64 `json:"swap_total_gb"`
	SwapUsedGB  float64 `json:"swap_used_gb"`
	SwapUsedPct float64 `json:"swap_used_pct"`
}

type DiskInfo struct {
	Mount   string  `json:"mount"`
	TotalGB float64 `json:"total_gb"`
	UsedGB  float64 `json:"used_gb"`
	UsedPct float64 `json:"used_pct"`
}

type Metrics struct {
	CPU         float64   `json:"cpu"`
	CPUCores    []float64 `json:"cpu_cores"`
	CPUFreq     float64   `json:"cpu_freq"`
	Memory      MemStats  `json:"memory"`
	Disk        []DiskInfo `json:"disk"`
	Temperature float64   `json:"temperature"`
	Load1m      float64   `json:"load_1m"`
	Load5m      float64   `json:"load_5m"`
	Load15m     float64   `json:"load_15m"`
	Uptime      uint64    `json:"uptime"`
	Hostname    string    `json:"hostname"`
	Processes   []ProcInfo `json:"processes"`
	NetworkRX   uint64    `json:"network_rx"`
	NetworkTX   uint64    `json:"network_tx"`
	Timestamp   int64     `json:"timestamp"`
}

// ─── CPU Collector ─────────────────────────────────────────────────────────

type CPUStats struct {
	user    uint64
	nice    uint64
	system  uint64
	idle    uint64
	iowait  uint64
	irq     uint64
	softirq uint64
	steal   uint64
}

type cpuCollector struct {
	prev     CPUStats
	prevCore []CPUStats
	ncpu     int
}

func readCPUStats() (CPUStats, error) {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return CPUStats{}, err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	if !scanner.Scan() {
		return CPUStats{}, fmt.Errorf("empty /proc/stat")
	}

	line := scanner.Text()
	fields := strings.Fields(line)
	if len(fields) < 5 || fields[0] != "cpu" {
		return CPUStats{}, fmt.Errorf("unexpected /proc/stat format")
	}

	var s CPUStats
	s.user, _ = strconv.ParseUint(fields[1], 10, 64)
	s.nice, _ = strconv.ParseUint(fields[2], 10, 64)
	s.system, _ = strconv.ParseUint(fields[3], 10, 64)
	s.idle, _ = strconv.ParseUint(fields[4], 10, 64)
	if len(fields) > 5 {
		s.iowait, _ = strconv.ParseUint(fields[5], 10, 64)
	}
	if len(fields) > 6 {
		s.irq, _ = strconv.ParseUint(fields[6], 10, 64)
	}
	if len(fields) > 7 {
		s.softirq, _ = strconv.ParseUint(fields[7], 10, 64)
	}
	if len(fields) > 8 {
		s.steal, _ = strconv.ParseUint(fields[8], 10, 64)
	}
	return s, nil
}

func readCoreStats() ([]CPUStats, error) {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var cores []CPUStats
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "cpu") {
			break
		}
		fields := strings.Fields(line)
		if len(fields) < 5 || fields[0] == "cpu" {
			continue
		}
		var s CPUStats
		s.user, _ = strconv.ParseUint(fields[1], 10, 64)
		s.nice, _ = strconv.ParseUint(fields[2], 10, 64)
		s.system, _ = strconv.ParseUint(fields[3], 10, 64)
		s.idle, _ = strconv.ParseUint(fields[4], 10, 64)
		if len(fields) > 5 {
			s.iowait, _ = strconv.ParseUint(fields[5], 10, 64)
		}
		cores = append(cores, s)
	}
	return cores, nil
}

func calcCPUPercent(prev, curr CPUStats) float64 {
	prevIdle := prev.idle + prev.iowait
	currIdle := curr.idle + curr.iowait

	prevTotal := prev.user + prev.nice + prev.system + prev.idle + prev.iowait + prev.irq + prev.softirq + prev.steal
	currTotal := curr.user + curr.nice + curr.system + curr.idle + curr.iowait + curr.irq + curr.softirq + curr.steal

	totalDelta := currTotal - prevTotal
	idleDelta := currIdle - prevIdle

	if totalDelta == 0 {
		return 0
	}
	return float64(totalDelta-idleDelta) / float64(totalDelta) * 100
}

// ─── Memory Collector ──────────────────────────────────────────────────────

type memInfo struct {
	total    uint64
	free     uint64
	buffers  uint64
	cached   uint64
	swapTotal uint64
	swapFree  uint64
}

func readMemInfo() (memInfo, error) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return memInfo{}, err
	}
	defer f.Close()

	var m memInfo
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "MemTotal:"):
			m.total = parseMemValue(line)
		case strings.HasPrefix(line, "MemFree:"):
			m.free = parseMemValue(line)
		case strings.HasPrefix(line, "Buffers:"):
			m.buffers = parseMemValue(line)
		case strings.HasPrefix(line, "Cached:"):
			m.cached = parseMemValue(line)
		case strings.HasPrefix(line, "SwapTotal:"):
			m.swapTotal = parseMemValue(line)
		case strings.HasPrefix(line, "SwapFree:"):
			m.swapFree = parseMemValue(line)
		}
	}
	return m, nil
}

func parseMemValue(line string) uint64 {
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return 0
	}
	v, _ := strconv.ParseUint(fields[1], 10, 64)
	return v // in kB
}

// ─── Disk Collector ────────────────────────────────────────────────────────

func getDiskUsage(path string) (DiskInfo, error) {
	var stat syscall.Statfs_t
	err := syscall.Statfs(path, &stat)
	if err != nil {
		return DiskInfo{}, err
	}

	total := stat.Blocks * uint64(stat.Bsize)
	free := stat.Bfree * uint64(stat.Bsize)
	used := total - free
	pct := float64(used) / float64(total) * 100

	return DiskInfo{
		Mount:   path,
		TotalGB: float64(total) / (1 << 30),
		UsedGB:  float64(used) / (1 << 30),
		UsedPct: math.Round(pct*10) / 10,
	}, nil
}

// ─── Temperature Collector ─────────────────────────────────────────────────

func readTemperature() (float64, error) {
	matches, err := filepath.Glob("/sys/class/thermal/thermal_zone*/temp")
	if err != nil || len(matches) == 0 {
		return 0, fmt.Errorf("no thermal zones found")
	}

	var sum float64
	var count int
	for _, m := range matches {
		data, err := os.ReadFile(m)
		if err != nil {
			continue
		}
		v, err := strconv.ParseFloat(strings.TrimSpace(string(data)), 64)
		if err != nil {
			continue
		}
		sum += v / 1000.0 // millidegrees to degrees
		count++
	}
	if count == 0 {
		return 0, fmt.Errorf("no readable thermal zones")
	}
	return sum / float64(count), nil
}

// ─── Network Collector ─────────────────────────────────────────────────────

func readNetworkBytes() (rx, tx uint64, err error) {
	f, err := os.Open("/proc/net/dev")
	if err != nil {
		return 0, 0, err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.Contains(line, ":") {
			continue
		}
		// Skip loopback
		if strings.HasPrefix(line, "  lo:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 10 {
			continue
		}
		r, _ := strconv.ParseUint(fields[1], 10, 64)
		t, _ := strconv.ParseUint(fields[9], 10, 64)
		rx += r
		tx += t
	}
	return rx, tx, nil
}

// ─── Process Collector ─────────────────────────────────────────────────────

type processSample struct {
	pid     int
	utime   uint64
	stime   uint64
	rss     uint64
	name    string
	state   string
}

func readProcSamples() ([]processSample, error) {
	dirs, err := filepath.Glob("/proc/[0-9]*")
	if err != nil {
		return nil, err
	}

	var samples []processSample

	for _, dir := range dirs {
		pidStr := filepath.Base(dir)
		pid, err := strconv.Atoi(pidStr)
		if err != nil {
			continue
		}

		statData, err := os.ReadFile(filepath.Join(dir, "stat"))
		if err != nil {
			continue
		}

		// Parse /proc/[pid]/stat
		// Format: pid (comm) state ppid ... utime stime ... rss ...
		line := string(statData)
		// Find the closing paren after comm
		commEnd := strings.LastIndex(line, ")")
		if commEnd == -1 {
			continue
		}
		rest := strings.Fields(line[commEnd+2:]) // skip ") "

		if len(rest) < 22 {
			continue
		}

		state := rest[0]
		if len(state) > 1 {
			state = string(state[0])
		}

		utime, _ := strconv.ParseUint(rest[11], 10, 64)
		stime, _ := strconv.ParseUint(rest[12], 10, 64)

		// RSS is in pages, need to multiply by page size
		rssPages, _ := strconv.ParseUint(rest[21], 10, 64)

		// Get process name from between ( and )
		commStart := strings.Index(line, "(")
		name := ""
		if commStart != -1 {
			name = line[commStart+1 : commEnd]
		}

		samples = append(samples, processSample{
			pid:   pid,
			utime: utime,
			stime: stime,
			rss:   rssPages,
			name:  name,
			state: state,
		})
	}
	return samples, nil
}

// ─── Load / Uptime ─────────────────────────────────────────────────────────

func readLoadAvg() (float64, float64, float64, int, error) {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0, 0, 0, 0, err
	}
	fields := strings.Fields(string(data))
	if len(fields) < 5 {
		return 0, 0, 0, 0, fmt.Errorf("unexpected /proc/loadavg format")
	}
	l1, _ := strconv.ParseFloat(fields[0], 64)
	l5, _ := strconv.ParseFloat(fields[1], 64)
	l15, _ := strconv.ParseFloat(fields[2], 64)

	// "running/total"
	procFields := strings.Split(fields[3], "/")
	var totalProc int
	if len(procFields) > 1 {
		totalProc, _ = strconv.Atoi(procFields[1])
	}

	return l1, l5, l15, totalProc, nil
}

func readUptime() (uint64, error) {
	data, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0, err
	}
	fields := strings.Fields(string(data))
	if len(fields) < 1 {
		return 0, fmt.Errorf("unexpected /proc/uptime format")
	}
	secs, _ := strconv.ParseFloat(fields[0], 64)
	return uint64(secs), nil
}

// ─── Metrics Engine ───────────────────────────────────────────────────────

type metricsEngine struct {
	mu          sync.Mutex
	cpuCol      *cpuCollector
	prevProc    map[int]processSample
	totalMem    uint64
	prevNetRX   uint64
	prevNetTX   uint64
	lastNetTime time.Time
}

func newMetricsEngine() *metricsEngine {
	mem, _ := readMemInfo()
	cpuCol := &cpuCollector{}
	cpuCol.prev, _ = readCPUStats()
	cpuCol.prevCore, _ = readCoreStats()
	cpuCol.ncpu = len(cpuCol.prevCore)

	return &metricsEngine{
		cpuCol:   cpuCol,
		prevProc: make(map[int]processSample),
		totalMem: mem.total,
	}
}

func (e *metricsEngine) collect() *Metrics {
	e.mu.Lock()
	defer e.mu.Unlock()

	now := time.Now()

	// CPU
	curr, err := readCPUStats()
	cpuPct := 0.0
	if err == nil {
		cpuPct = calcCPUPercent(e.cpuCol.prev, curr)
		e.cpuCol.prev = curr
	}

	// Per-core CPU
	cores, err := readCoreStats()
	corePcts := make([]float64, len(cores))
	if err == nil {
		for i := range cores {
			if i < len(e.cpuCol.prevCore) {
				corePcts[i] = calcCPUPercent(e.cpuCol.prevCore[i], cores[i])
			}
		}
		e.cpuCol.prevCore = cores
	}

	// CPU frequency
	cpuFreq := 0.0
	freqData, err := os.ReadFile("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq")
	if err == nil {
		f, _ := strconv.ParseFloat(strings.TrimSpace(string(freqData)), 64)
		cpuFreq = f / 1000.0 // kHz to MHz
	}

	// Memory
	mem, _ := readMemInfo()
	usedMem := mem.total - mem.free - mem.buffers - mem.cached
	totalGB := float64(mem.total) / (1024 * 1024) // kB to GB
	usedGB := float64(usedMem) / (1024 * 1024)
	usedPct := float64(usedMem) / float64(mem.total) * 100

	swapTotalGB := float64(mem.swapTotal) / (1024 * 1024)
	swapUsedGB := float64(mem.swapTotal-mem.swapFree) / (1024 * 1024)
	swapUsedPct := 0.0
	if mem.swapTotal > 0 {
		swapUsedPct = float64(mem.swapTotal-mem.swapFree) / float64(mem.swapTotal) * 100
	}

	// Disk
	diskInfo, _ := getDiskUsage("/")
	var disks []DiskInfo
	if diskInfo.Mount != "" {
		disks = append(disks, diskInfo)
	}

	// Temperature
	temp, _ := readTemperature()

	// Load
	l1, l5, l15, _, _ := readLoadAvg()

	// Uptime
	uptime, _ := readUptime()

	// Hostname
	hostname, _ := os.Hostname()

	// Network
	netRX, netTX, _ := readNetworkBytes()
	// We report raw cumulative bytes; frontend calculates delta
	if e.prevNetRX == 0 {
		e.prevNetRX = netRX
		e.prevNetTX = netTX
		e.lastNetTime = now
	}

	// Processes
	samples, _ := readProcSamples()
	var procs []ProcInfo
	if len(samples) > 0 {
		for _, s := range samples {
			prev, ok := e.prevProc[s.pid]
			var cpuP float64
			if ok {
				// CPU% = (delta_utime + delta_stime) / clkTck / delta_time * 100
				// Since this is called every ~2s, approximate
				deltaU := float64(s.utime - prev.utime)
				deltaS := float64(s.stime - prev.stime)
				cpuP = (deltaU + deltaS) / 100.0 / 2.0 // 2s interval, clk_tck=100
				if cpuP < 0 {
					cpuP = 0
				}
			}
			rssMB := float64(s.rss) * float64(os.Getpagesize()) / (1024 * 1024)
			memPct := 0.0
			if e.totalMem > 0 {
				memPct = float64(s.rss) * float64(os.Getpagesize()) / (float64(e.totalMem) * 1024) * 100
			}
			procs = append(procs, ProcInfo{
				PID:   s.pid,
				Name:  s.name,
				CPU:   math.Round(cpuP*10) / 10,
				Mem:   math.Round(memPct*10) / 10,
				RSS:   uint64(rssMB),
				State: s.state,
			})
		}

		// Sort by CPU descending, take top 10
		sort.Slice(procs, func(i, j int) bool {
			if procs[i].CPU != procs[j].CPU {
				return procs[i].CPU > procs[j].CPU
			}
			return procs[i].Mem > procs[j].Mem
		})
		if len(procs) > 10 {
			procs = procs[:10]
		}
	}

	// Update prev
	for _, s := range samples {
		e.prevProc[s.pid] = s
	}
	e.prevNetRX = netRX
	e.prevNetTX = netTX

	return &Metrics{
		CPU:         math.Round(cpuPct*10) / 10,
		CPUCores:    corePcts,
		CPUFreq:     cpuFreq,
		Memory: MemStats{
			TotalGB:     math.Round(totalGB*100) / 100,
			UsedGB:      math.Round(usedGB*100) / 100,
			UsedPct:     math.Round(usedPct*10) / 10,
			SwapTotalGB: math.Round(swapTotalGB*100) / 100,
			SwapUsedGB:  math.Round(swapUsedGB*100) / 100,
			SwapUsedPct: math.Round(swapUsedPct*10) / 10,
		},
		Disk:        disks,
		Temperature: math.Round(temp*10) / 10,
		Load1m:      l1,
		Load5m:      l5,
		Load15m:     l15,
		Uptime:      uptime,
		Hostname:    hostname,
		Processes:   procs,
		NetworkRX:   netRX,
		NetworkTX:   netTX,
		Timestamp:   now.UnixMilli(),
	}
}

// ─── SSE Hub ───────────────────────────────────────────────────────────────

type SSEHub struct {
	clients    map[chan []byte]bool
	register   chan chan []byte
	unregister chan chan []byte
	broadcast  chan []byte
}

func newSSEHub() *SSEHub {
	return &SSEHub{
		clients:    make(map[chan []byte]bool),
		register:   make(chan chan []byte),
		unregister: make(chan chan []byte),
		broadcast:  make(chan []byte, 256),
	}
}

func (h *SSEHub) run() {
	for {
		select {
		case client := <-h.register:
			h.clients[client] = true

		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client)
			}

		case msg := <-h.broadcast:
			for client := range h.clients {
				select {
				case client <- msg:
				default:
					// Client too slow, drop
					delete(h.clients, client)
					close(client)
				}
			}
		}
	}
}

func (h *SSEHub) serveSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	client := make(chan []byte, 64)
	h.register <- client

	defer func() {
		h.unregister <- client
	}()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-client:
			if !ok {
				return
			}
			fmt.Fprintf(w, "data: %s\n\n", msg)
			flusher.Flush()
		}
	}
}

// ─── Main ──────────────────────────────────────────────────────────────────

func main() {
	engine := newMetricsEngine()
	hub := newSSEHub()
	go hub.run()

	// Collect and broadcast every 2 seconds
	go func() {
		for {
			m := engine.collect()
			data, err := json.Marshal(m)
			if err == nil {
				hub.broadcast <- data
			}
			time.Sleep(2 * time.Second)
		}
	}()

	// SSE endpoint
	http.HandleFunc("/api/events", hub.serveSSE)

	// Static files
	fs := http.FileServer(http.Dir("static"))
	http.Handle("/", fs)

	defaultPort := "8080"
	if envPort := os.Getenv("PORT"); envPort != "" {
		defaultPort = envPort
	}
	port := flag.String("port", defaultPort, "Puerto HTTP donde escucha el panel (tambien respeta la variable de entorno PORT)")
	flag.Parse()

	addr := ":" + *port

	log.Printf("📊 Panel Admin starting on %s", addr)
	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatal(err)
	}
}
