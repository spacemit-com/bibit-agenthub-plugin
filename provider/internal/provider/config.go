package provider

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	defaultAPMPath    = "/usr/bin/apm"
	defaultAPCBaseURL = "https://developer.bianbu.xyz/api-server/apc/api/v1"
)

// Config holds the explicit environment for the two data sources. The host runs
// the provider with a cleared environment, so nothing is inherited from HOME or
// PATH; overrides arrive as CLI args in the Registry drop-in.
type Config struct {
	APMPath    string
	UserHome   string
	APCBaseURL string
}

// ParseConfig parses the provider args that follow the "provider" subcommand:
// --apm-path, --user-home and --apc-base-url (each also accepted as --flag=value).
// Overrides must be valid: APM path and user home must be absolute, the APC base
// URL must be an http(s) URL. A missing user home is resolved from the process
// UID via the OS account database; resolution failure only affects installed.
func ParseConfig(args []string) (Config, error) {
	cfg := Config{
		APMPath:    defaultAPMPath,
		APCBaseURL: defaultAPCBaseURL,
	}
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if !strings.HasPrefix(arg, "--") {
			return Config{}, fmt.Errorf("unexpected argument %q", arg)
		}
		flag := arg
		value := ""
		if eq := strings.IndexByte(arg, '='); eq >= 0 {
			flag = arg[:eq]
			value = arg[eq+1:]
		} else {
			if i+1 >= len(args) {
				return Config{}, fmt.Errorf("flag %s requires a value", arg)
			}
			i++
			value = args[i]
		}
		switch flag {
		case "--apm-path":
			if !filepath.IsAbs(value) {
				return Config{}, fmt.Errorf("--apm-path must be an absolute path")
			}
			cfg.APMPath = value
		case "--user-home":
			if !filepath.IsAbs(value) {
				return Config{}, fmt.Errorf("--user-home must be an absolute path")
			}
			cfg.UserHome = value
		case "--apc-base-url":
			u, err := url.Parse(value)
			if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
				return Config{}, fmt.Errorf("--apc-base-url must be an http(s) URL")
			}
			cfg.APCBaseURL = value
		default:
			return Config{}, fmt.Errorf("unknown flag %q", flag)
		}
	}
	if cfg.UserHome == "" {
		cfg.UserHome = resolveUserHome()
	}
	return cfg, nil
}

// resolveUserHome resolves the current process UID's home directory through the
// OS account database (not $HOME), so a pure-Go provider does not depend on the
// inherited environment.
func resolveUserHome() string {
	uid := os.Getuid()
	account, err := user.LookupId(strconv.Itoa(uid))
	if err != nil || account.HomeDir == "" {
		return ""
	}
	return account.HomeDir
}

// APMEnvironment builds the explicit environment for the apm CLI. APM_HOME is
// the user home directory; apm appends ".apm" internally, so it must not be
// passed here. It fails when no user home could be resolved, which only affects
// the installed scope.
func APMEnvironment(cfg Config) ([]string, error) {
	if cfg.UserHome == "" {
		return nil, newProviderError("unavailable")
	}
	return []string{
		"LANG=C.UTF-8",
		"HOME=" + cfg.UserHome,
		"APM_HOME=" + cfg.UserHome,
		"PATH=/usr/bin:/bin:/usr/local/bin",
	}, nil
}

// NewInvoker wires the data sources behind the provider's InvokeFunc, so the
// server dispatches a validated OperationRequest to the matching operation.
func NewInvoker(cfg Config, client *http.Client) InvokeFunc {
	return func(ctx context.Context, req OperationRequest) (any, error) {
		switch req.OperationID {
		case operationPowersList:
			if req.List == nil {
				return nil, newProviderError("incompatible")
			}
			input := *req.List
			switch input.Scope {
			case "installed":
				return ReadInstalled(ctx, cfg, input.Agent)
			case "market":
				return ReadMarket(ctx, client, cfg.APCBaseURL, input.KnownSnapshot)
			default:
				return nil, newProviderError("incompatible")
			}
		case operationPowersInspect:
			if req.Target == nil {
				return nil, newProviderError("incompatible")
			}
			return InspectPower(ctx, cfg, *req.Target)
		case operationPowersInstall, operationPowersUninstall:
			return MutatePower(ctx, cfg, req)
		default:
			return nil, newProviderError("incompatible")
		}
	}
}
