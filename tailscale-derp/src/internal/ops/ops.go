package ops

import (
	"errors"
	"net/http"
	"os/exec"

	"github.com/lk/openwrt-tailscale-derp/internal/httpjson"
	"github.com/lk/openwrt-tailscale-derp/internal/service"
)

type Config struct {
	Version string
	Listen  string
	STUN    bool
	Mesh    bool
	OpsAddr string
	Health  string
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

type Executor func(action string) error
type Snapshot func() (bool, string)

func StatusFromConfig(cfg Config, snapshot Snapshot) Status {
	running := true
	errMsg := ""
	if snapshot != nil {
		running, errMsg = snapshot()
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
		Version: cfg.Version,
		Running: running,
		Listen:  cfg.Listen,
		STUN:    cfg.STUN,
		Mesh:    cfg.Mesh,
		Metrics: metricsAddr,
		Health:  healthAddr,
		Error:   errMsg,
	}
}

func HandleOpsWithExecutor(executor Executor) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			httpjson.Write(w, http.StatusMethodNotAllowed, ActionResult{Error: "POST required", Result: "error"})
			return
		}
		action := r.URL.Query().Get("action")
		if !service.AllowedAction(action) {
			httpjson.Write(w, http.StatusBadRequest, ActionResult{Action: action, Result: "error", Error: "unknown action"})
			return
		}
		if err := executor(action); err != nil {
			status := http.StatusBadGateway
			if errors.Is(err, exec.ErrNotFound) {
				status = http.StatusServiceUnavailable
			}
			httpjson.Write(w, status, ActionResult{Action: action, Result: "error", Error: err.Error()})
			return
		}

		httpjson.Write(w, http.StatusOK, ActionResult{Action: action, Result: "ok"})
	}
}

func HandleStatus(cfg Config, snapshot Snapshot) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			httpjson.Write(w, http.StatusMethodNotAllowed, map[string]string{"error": "GET required"})
			return
		}

		httpjson.Write(w, http.StatusOK, StatusFromConfig(cfg, snapshot))
	}
}

func HandleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpjson.Write(w, http.StatusMethodNotAllowed, map[string]string{"error": "GET required"})
		return
	}

	httpjson.Write(w, http.StatusOK, map[string]string{"status": "ok"})
}

func HandleVersion(version string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			httpjson.Write(w, http.StatusMethodNotAllowed, map[string]string{"error": "GET required"})
			return
		}

		httpjson.Write(w, http.StatusOK, map[string]string{"version": version})
	}
}

func NewMux(cfg Config, snapshot Snapshot, executor Executor) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/status", HandleStatus(cfg, snapshot))
	mux.HandleFunc("/health", HandleHealth)
	mux.HandleFunc("/version", HandleVersion(cfg.Version))
	mux.HandleFunc("/ops", HandleOpsWithExecutor(executor))
	return mux
}
