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

	// providerDataDirEnv is the directory the host hands a managed provider for
	// its own persistent state; settings.json lives here.
	providerDataDirEnv = "BIBIT_PROVIDER_DATA_DIR"
)

// Config holds the explicit environment for the data sources. The host runs
// the provider with a cleared environment, so nothing is inherited from HOME or
// PATH; overrides arrive as CLI args in the Registry drop-in.
type Config struct {
	APMPath    string
	UserHome   string
	APCBaseURL string
	// DataDir is the provider's own writable directory (settings.json). Empty
	// means "take BIBIT_PROVIDER_DATA_DIR, else a state directory under the user
	// home", resolved by SettingsPath.
	DataDir string
	// APCRootURL optionally overrides the host-only APC root used when submitting
	// a custom resource (`apm submit`). Empty means "leave apm's own default
	// (production) in place"; APCBaseURL is deliberately not reused because it
	// carries the /api-server/apc/api/v1 path that apm already appends.
	APCRootURL string
}

// ParseConfig parses the provider args that follow the "provider" subcommand:
// --apm-path, --user-home, --apc-base-url, --data-dir and --apc-root-url (each
// also accepted as --flag=value).
// Overrides must be valid: APM path, user home and data dir must be absolute,
// the APC URLs must be http(s) URLs and the APC root must be host-only. A
// missing user home is resolved from the process UID via the OS account
// database; resolution failure only affects installed.
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
		case "--data-dir":
			if !filepath.IsAbs(value) {
				return Config{}, fmt.Errorf("--data-dir must be an absolute path")
			}
			cfg.DataDir = filepath.Clean(value)
		case "--apc-base-url":
			u, err := url.Parse(value)
			if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
				return Config{}, fmt.Errorf("--apc-base-url must be an http(s) URL")
			}
			cfg.APCBaseURL = value
		case "--apc-root-url":
			u, err := url.Parse(value)
			if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" ||
				u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
				return Config{}, fmt.Errorf("--apc-root-url must be a host-only http(s) URL")
			}
			cfg.APCRootURL = value
		default:
			return Config{}, fmt.Errorf("unknown flag %q", flag)
		}
	}
	if cfg.UserHome == "" {
		cfg.UserHome = resolveUserHome()
	}
	if cfg.DataDir == "" {
		cfg.DataDir = strings.TrimSpace(os.Getenv(providerDataDirEnv))
		if cfg.DataDir != "" && !filepath.IsAbs(cfg.DataDir) {
			return Config{}, fmt.Errorf("%s must be an absolute path", providerDataDirEnv)
		}
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
		case operationPowersCustomList:
			if req.CustomList == nil {
				return nil, newProviderError("incompatible")
			}
			return ScanCustomResources(cfg, req.CustomList.Agent)
		case operationPowersUpload:
			if req.Upload == nil {
				return nil, newProviderError("incompatible")
			}
			return UploadCustomResource(ctx, cfg, req.Upload.PowerTarget, req.Upload.Message)
		case operationPowersDelete:
			if req.Target == nil {
				return nil, newProviderError("incompatible")
			}
			return DeleteCustomResource(cfg, *req.Target)
		case operationSettingsGet:
			return GetSettings(cfg)
		case operationSettingsUpdate:
			if req.Settings == nil {
				return nil, newProviderError("incompatible")
			}
			return UpdateSettings(cfg, *req.Settings)
		default:
			return nil, newProviderError("incompatible")
		}
	}
}
