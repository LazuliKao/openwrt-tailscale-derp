package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"expvar"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"tailscale.com/derp"
	"tailscale.com/derp/derphttp"
	"tailscale.com/net/stunserver"
	"tailscale.com/types/key"
)

var version = "dev"

const defaultNodeKeyPath = "/var/lib/go-tailscale-derp/node.key"

type Config struct {
	Enabled  bool
	Listen   string
	STUN     bool
	CertFile string
	KeyFile  string
	Mesh     bool
	MeshKey  string
	OpsAddr  string
	Health   string
}

type Status struct {
	Version string `json:"version"`
	Running bool   `json:"running"`
	Listen  string `json:"listen"`
	STUN    bool   `json:"stun"`
	Mesh    bool   `json:"mesh"`
	Metrics string `json:"metrics"`
	Health  string `json:"health"`
	Error   string `json:"error,omitempty"`
}

type ActionResult struct {
	Action string `json:"action"`
	Result string `json:"result"`
	Error  string `json:"error,omitempty"`
}

type runtimeState struct {
	mu      sync.RWMutex
	running bool
	err     string
}

func (s *runtimeState) setRunning(running bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.running = running
	if running {
		s.err = ""
	}
}

func (s *runtimeState) setError(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.running = false
	if err == nil {
		s.err = ""
		return
	}
	s.err = err.Error()
}

func (s *runtimeState) snapshot() (bool, string) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.running, s.err
}

type configFlags struct {
	Enabled    *bool
	Listen     *string
	STUN       *bool
	CertFile   *string
	KeyFile    *string
	Mesh       *bool
	MeshKey    *string
	OpsAddr    *string
	HealthAddr *string
	ConfigPath *string
}

type uciConfig struct {
	values map[string]map[string][]string
}

type actionExecutor func(action string) error

var execServiceAction actionExecutor = runServiceAction

const serviceScriptPath = "/etc/init.d/go-tailscale-derp"

func isLoopbackOpsAddress(value string) bool {
	trimmed := strings.TrimSpace(value)

	if trimmed == "" {
		return false
	}

	if strings.HasPrefix(trimmed, ":") {
		_, err := strconv.Atoi(strings.TrimPrefix(trimmed, ":"))
		return err == nil
	}

	for _, prefix := range []string{"127.0.0.1:", "localhost:", "[::1]:"} {
		if strings.HasPrefix(trimmed, prefix) {
			_, err := strconv.Atoi(strings.TrimPrefix(trimmed, prefix))
			return err == nil
		}
	}

	return false
}

func newFlagSet(args []string) (*flag.FlagSet, *configFlags, error) {
	fs := flag.NewFlagSet("go-tailscale-derp", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)

	flags := &configFlags{
		Enabled:    fs.Bool("enabled", false, "enable DERP service"),
		Listen:     fs.String("listen", "", "listen address"),
		STUN:       fs.Bool("stun", false, "enable STUN"),
		CertFile:   fs.String("certfile", "", "TLS certificate file"),
		KeyFile:    fs.String("keyfile", "", "TLS key file"),
		Mesh:       fs.Bool("mesh", false, "enable mesh mode"),
		MeshKey:    fs.String("mesh-key", "", "shared mesh key"),
		OpsAddr:    fs.String("ops", "", "ops server address"),
		HealthAddr: fs.String("health", "", "health server address"),
		ConfigPath: fs.String("config", defaultConfigPath(), "UCI config path"),
	}

	if err := fs.Parse(args); err != nil {
		return nil, nil, err
	}

	return fs, flags, nil
}

func defaultConfigPath() string {
	if path := os.Getenv("GO_TAILSCALE_DERP_CONFIG"); path != "" {
		return path
	}

	return "/etc/config/go-tailscale-derp"
}

func parseBoolValue(value string) (bool, error) {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "1", "true", "yes", "on":
		return true, nil
	case "0", "false", "no", "off", "":
		return false, nil
	default:
		return false, fmt.Errorf("invalid boolean value %q", value)
	}
}

func parseUCIConfig(path string) (*uciConfig, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	parsed := &uciConfig{values: make(map[string]map[string][]string)}
	scanner := bufio.NewScanner(file)
	currentSection := ""

	for lineNum := 1; scanner.Scan(); lineNum++ {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}

		switch fields[0] {
		case "config":
			if len(fields) < 3 {
				return nil, fmt.Errorf("invalid config declaration on line %d", lineNum)
			}
			currentSection = trimQuotes(fields[2])
			parsed.values[currentSection] = make(map[string][]string)
		case "option":
			if currentSection == "" || len(fields) < 3 {
				return nil, fmt.Errorf("invalid option declaration on line %d", lineNum)
			}
			key := trimQuotes(fields[1])
			value := trimQuotes(strings.Join(fields[2:], " "))
			parsed.values[currentSection][key] = []string{value}
		case "list":
			if currentSection == "" || len(fields) < 3 {
				return nil, fmt.Errorf("invalid list declaration on line %d", lineNum)
			}
			key := trimQuotes(fields[1])
			value := trimQuotes(strings.Join(fields[2:], " "))
			parsed.values[currentSection][key] = append(parsed.values[currentSection][key], value)
		default:
			return nil, fmt.Errorf("unsupported directive %q on line %d", fields[0], lineNum)
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	return parsed, nil
}

func trimQuotes(value string) string {
	return strings.Trim(value, "'\"")
}

func boolFlagProvided(fs *flag.FlagSet, name string) bool {
	provided := false
	fs.Visit(func(f *flag.Flag) {
		if f.Name == name {
			provided = true
		}
	})
	return provided
}

func stringFlagProvided(fs *flag.FlagSet, name string) bool {
	return boolFlagProvided(fs, name)
}

func buildConfig(args []string, openFile func(string) (*uciConfig, error)) (*Config, error) {
	fs, flags, err := newFlagSet(args)
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		Enabled: false,
		Listen:  ":3478",
		STUN:    true,
		OpsAddr: "127.0.0.1:9911",
		Health:  ":9912",
	}

	if flags.ConfigPath != nil && *flags.ConfigPath != "" {
		uci, err := openFile(*flags.ConfigPath)
		if err != nil {
			if !os.IsNotExist(err) {
				return nil, err
			}
		} else {
			if err := applyUCIConfig(cfg, uci); err != nil {
				return nil, err
			}
		}
	}

	applyFlagOverrides(cfg, fs, flags)
	return cfg, nil
}

func applyUCIConfig(cfg *Config, parsed *uciConfig) error {
	if parsed == nil {
		return nil
	}

	if value, ok := parsed.first("global", "enabled"); ok {
		parsedBool, err := parseBoolValue(value)
		if err != nil {
			return fmt.Errorf("global.enabled: %w", err)
		}
		cfg.Enabled = parsedBool
	}

	if value, ok := parsed.first("global", "listen"); ok && value != "" {
		cfg.Listen = value
	}

	if value, ok := parsed.first("global", "stun"); ok {
		parsedBool, err := parseBoolValue(value)
		if err != nil {
			return fmt.Errorf("global.stun: %w", err)
		}
		cfg.STUN = parsedBool
	}

	if value, ok := parsed.first("tls", "certfile"); ok {
		cfg.CertFile = value
	}

	if value, ok := parsed.first("tls", "keyfile"); ok {
		cfg.KeyFile = value
	}

	if value, ok := parsed.first("mesh", "enabled"); ok {
		parsedBool, err := parseBoolValue(value)
		if err != nil {
			return fmt.Errorf("mesh.enabled: %w", err)
		}
		cfg.Mesh = parsedBool
	}

	if value, ok := parsed.first("mesh", "key"); ok {
		cfg.MeshKey = strings.TrimSpace(value)
	}

	if value, ok := parsed.first("ops", "metrics"); ok && value != "" {
		cfg.OpsAddr = value
	}

	if value, ok := parsed.first("ops", "health"); ok && value != "" {
		cfg.Health = value
	}

	return nil
}

func (u *uciConfig) first(section, key string) (string, bool) {
	if u == nil {
		return "", false
	}
	sectionValues, ok := u.values[section]
	if !ok {
		return "", false
	}
	values, ok := sectionValues[key]
	if !ok || len(values) == 0 {
		return "", false
	}
	return values[0], true
}

func applyFlagOverrides(cfg *Config, fs *flag.FlagSet, flags *configFlags) {
	if boolFlagProvided(fs, "enabled") {
		cfg.Enabled = *flags.Enabled
	}
	if stringFlagProvided(fs, "listen") {
		cfg.Listen = strings.TrimSpace(*flags.Listen)
	}
	if boolFlagProvided(fs, "stun") {
		cfg.STUN = *flags.STUN
	}
	if stringFlagProvided(fs, "certfile") {
		cfg.CertFile = strings.TrimSpace(*flags.CertFile)
	}
	if stringFlagProvided(fs, "keyfile") {
		cfg.KeyFile = strings.TrimSpace(*flags.KeyFile)
	}
	if boolFlagProvided(fs, "mesh") {
		cfg.Mesh = *flags.Mesh
	}
	if stringFlagProvided(fs, "mesh-key") {
		cfg.MeshKey = strings.TrimSpace(*flags.MeshKey)
	}
	if stringFlagProvided(fs, "ops") {
		cfg.OpsAddr = strings.TrimSpace(*flags.OpsAddr)
	}
	if stringFlagProvided(fs, "health") {
		cfg.Health = strings.TrimSpace(*flags.HealthAddr)
	}
}

func loadConfig() (*Config, error) {
	return buildConfig(os.Args[1:], parseUCIConfig)
}

func validateConfig(cfg *Config) error {
	if cfg.Listen == "" {
		return fmt.Errorf("listen address is required")
	}
	if cfg.Mesh && cfg.MeshKey == "" {
		return fmt.Errorf("mesh requires a shared key")
	}
	if cfg.CertFile != "" && cfg.KeyFile == "" {
		return fmt.Errorf("certfile requires keyfile")
	}
	if cfg.KeyFile != "" && cfg.CertFile == "" {
		return fmt.Errorf("keyfile requires certfile")
	}
	if _, err := strconv.Atoi(strings.TrimPrefix(cfg.Listen, ":")); strings.HasPrefix(cfg.Listen, ":") && err != nil {
		return fmt.Errorf("listen must use a valid port")
	}
	if _, err := strconv.Atoi(strings.TrimPrefix(cfg.OpsAddr, ":")); strings.HasPrefix(cfg.OpsAddr, ":") && err != nil {
		return fmt.Errorf("ops must use a valid port")
	}
	if !isLoopbackOpsAddress(cfg.OpsAddr) {
		return fmt.Errorf("ops must bind to loopback only")
	}
	if _, err := strconv.Atoi(strings.TrimPrefix(cfg.Health, ":")); strings.HasPrefix(cfg.Health, ":") && err != nil {
		return fmt.Errorf("health must use a valid port")
	}
	return nil
}

func startDERP(cfg *Config, state *runtimeState) error {
	privateKey, err := loadOrCreateNodeKey(defaultNodeKeyPath)
	if err != nil {
		if state != nil {
			state.setError(err)
		}
		return fmt.Errorf("load node key: %w", err)
	}

	server := derp.NewServer(privateKey, log.Printf)
	if cfg.Mesh {
		server.SetMeshKey(cfg.MeshKey)
	}
	publishDERPMetrics(server)

	if cfg.STUN {
		stun := stunserver.New(context.Background())
		go func() {
			if err := stun.ListenAndServe(cfg.Listen); err != nil {
				log.Printf("STUN server stopped: %v", err)
			}
		}()
	}

	mux := http.NewServeMux()
	mux.Handle("/derp", derphttp.Handler(server))
	mux.HandleFunc("/derp/probe", derphttp.ProbeHandler)
	mux.HandleFunc("/derp/latency-check", derphttp.ProbeHandler)
	mux.HandleFunc("/generate_204", derphttp.ServeNoContent)

	httpServer := &http.Server{
		Addr:    cfg.Listen,
		Handler: mux,
	}

	log.Printf("Starting DERP server on %s", cfg.Listen)
	if state != nil {
		state.setRunning(true)
		defer state.setRunning(false)
	}
	if cfg.CertFile != "" && cfg.KeyFile != "" {
		httpServer.TLSConfig = &tls.Config{
			GetCertificate: func(*tls.ClientHelloInfo) (*tls.Certificate, error) {
				certificate, err := tls.LoadX509KeyPair(cfg.CertFile, cfg.KeyFile)
				if err != nil {
					return nil, err
				}
				certificate.Certificate = append(certificate.Certificate, server.MetaCert())
				return &certificate, nil
			},
		}
		err := httpServer.ListenAndServeTLS("", "")
		if state != nil && err != nil {
			state.setError(err)
		}
		return err
	}

	log.Printf("TLS cert/key not configured; serving DERP over plain HTTP for baseline testing only")
	err = httpServer.ListenAndServe()
	if state != nil && err != nil {
		state.setError(err)
	}
	return err
}

func publishDERPMetrics(server *derp.Server) {
	if expvar.Get("derp") == nil {
		expvar.Publish("derp", server.ExpVar())
	}
}

func loadOrCreateNodeKey(path string) (key.NodePrivate, error) {
	raw, err := os.ReadFile(path)
	if err == nil {
		var parsed key.NodePrivate
		if parseErr := parsed.UnmarshalText(bytes.TrimSpace(raw)); parseErr != nil {
			return key.NodePrivate{}, parseErr
		}
		return parsed, nil
	}
	if !os.IsNotExist(err) {
		return key.NodePrivate{}, err
	}

	privateKey := key.NewNode()
	marshaled, err := privateKey.MarshalText()
	if err != nil {
		return key.NodePrivate{}, err
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return key.NodePrivate{}, err
	}
	if err := os.WriteFile(path, append(marshaled, '\n'), 0o600); err != nil {
		return key.NodePrivate{}, err
	}

	return privateKey, nil
}

func allowedAction(action string) bool {
	switch action {
	case "start", "stop", "restart", "reload":
		return true
	default:
		return false
	}
}

func runServiceAction(action string) error {
	if !allowedAction(action) {
		return fmt.Errorf("unknown action %q", action)
	}

	command := exec.Command(serviceScriptPath, action)
	output, err := command.CombinedOutput()
	if err != nil {
		trimmed := strings.TrimSpace(string(output))
		if trimmed == "" {
			return fmt.Errorf("service action %s failed: %w", action, err)
		}
		return fmt.Errorf("service action %s failed: %s", action, trimmed)
	}

	return nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		http.Error(w, `{"error":"failed to encode response"}`, http.StatusInternalServerError)
	}
}

func handleOpsWithExecutor(executor actionExecutor) http.HandlerFunc {
	if executor == nil {
		executor = execServiceAction
	}

	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, ActionResult{Error: "POST required", Result: "error"})
			return
		}
		action := r.URL.Query().Get("action")
		if !allowedAction(action) {
			writeJSON(w, http.StatusBadRequest, ActionResult{Action: action, Result: "error", Error: "unknown action"})
			return
		}
		if err := executor(action); err != nil {
			status := http.StatusBadGateway
			if errors.Is(err, exec.ErrNotFound) {
				status = http.StatusServiceUnavailable
			}
			writeJSON(w, status, ActionResult{Action: action, Result: "error", Error: err.Error()})
			return
		}

		writeJSON(w, http.StatusOK, ActionResult{Action: action, Result: "ok"})
	}
}

func handleOps(w http.ResponseWriter, r *http.Request) {
	handleOpsWithExecutor(execServiceAction)(w, r)
}

func statusFromConfig(cfg *Config, state *runtimeState) Status {
	running := true
	errMsg := ""
	if state != nil {
		running, errMsg = state.snapshot()
	}
	metricsAddr := cfg.OpsAddr
	if metricsAddr == "" {
		metricsAddr = "127.0.0.1:9911"
	}
	healthAddr := cfg.Health
	if healthAddr == "" {
		healthAddr = ":9912"
	}

	return Status{
		Version: version,
		Running: running,
		Listen:  cfg.Listen,
		STUN:    cfg.STUN,
		Mesh:    cfg.Mesh,
		Metrics: metricsAddr,
		Health:  healthAddr,
		Error:   errMsg,
	}
}

func handleStatus(cfg *Config, state *runtimeState) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(statusFromConfig(cfg, state)); err != nil {
			http.Error(w, `{"error":"failed to encode status"}`, http.StatusInternalServerError)
		}
	}
}

func startOps(cfg *Config, state *runtimeState) error {
	mux := http.NewServeMux()
	mux.HandleFunc("/status", handleStatus(cfg, state))
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, `{"status":"ok"}`)
	})
	mux.HandleFunc("/version", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, `{"version":"%s"}`, version)
	})
	mux.HandleFunc("/ops", handleOps)
	log.Printf("Starting ops server on %s", cfg.OpsAddr)
	return http.ListenAndServe(cfg.OpsAddr, mux)
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Printf("go-tailscale-derp %s", version)

	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	if err := validateConfig(cfg); err != nil {
		log.Fatalf("Invalid config: %v", err)
	}

	state := &runtimeState{}

	if !cfg.Enabled {
		log.Println("Service disabled")
		os.Exit(0)
	}

	go func() {
		if err := startOps(cfg, state); err != nil {
			log.Fatalf("Ops server failed: %v", err)
		}
	}()

	if err := startDERP(cfg, state); err != nil {
		log.Fatalf("DERP server failed: %v", err)
	}
}
