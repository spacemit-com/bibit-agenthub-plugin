package provider

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Agent Hub settings are owned by the provider because the feature host only
// forwards operations: the plugin cannot read or write files, so the value that
// must survive a page reload (the APC API key) has to live behind
// `settings.get.v1` / `settings.update.v1`.
//
// The file is deliberately tiny and human-repairable: three fields, strict
// validation, 0600 and an atomic replace. `apiKey` is written to disk but never
// returned by `get`; the view only reports whether one is configured.

const (
	settingsSchemaVersion = 1
	settingsFileName      = "settings.json"
	maxSettingsBytes      = 64 << 10
	maxAPIKeyBytes        = 512

	minRefreshMinutes = 5
	maxRefreshMinutes = 120
)

// Settings is the persisted document. SchemaVersion is written so a future
// migration can tell which shape it is reading.
type Settings struct {
	SchemaVersion    int    `json:"schemaVersion"`
	ShowExperimental bool   `json:"showExperimental"`
	RefreshMinutes   int    `json:"refreshMinutes"`
	APIKey           string `json:"apiKey,omitempty"`
}

// SettingsUpdate is the validated `settings.update.v1` input. APIKey is a
// pointer so an omitted field means "keep the stored key" while an empty string
// means "clear it"; the host forwards JSON, so the distinction is observable.
type SettingsUpdate struct {
	ShowExperimental bool    `json:"showExperimental"`
	RefreshMinutes   int     `json:"refreshMinutes"`
	APIKey           *string `json:"apiKey,omitempty"`
}

// SettingsView is what the page is allowed to see: the key is reduced to a
// boolean, so a compromised renderer cannot read the credential back out.
type SettingsView struct {
	ShowExperimental bool `json:"showExperimental"`
	RefreshMinutes   int  `json:"refreshMinutes"`
	HasAPIKey        bool `json:"hasApiKey"`
}

func defaultSettings() Settings {
	return Settings{SchemaVersion: settingsSchemaVersion, ShowExperimental: false, RefreshMinutes: 15}
}

// SettingsPath returns the settings file location. The host always passes
// BIBIT_PROVIDER_DATA_DIR; the fallback keeps `bibit-agenthub provider` usable
// by hand and in tests where that variable is absent.
func SettingsPath(cfg Config) (string, error) {
	dir := strings.TrimSpace(cfg.DataDir)
	if dir == "" {
		dir = strings.TrimSpace(os.Getenv(providerDataDirEnv))
	}
	if dir == "" {
		if cfg.UserHome == "" {
			return "", newProviderError("unavailable")
		}
		dir = filepath.Join(cfg.UserHome, ".local", "state", "bibit-agenthub")
	}
	if !filepath.IsAbs(dir) {
		return "", newProviderError("unavailable")
	}
	return filepath.Join(filepath.Clean(dir), settingsFileName), nil
}

// ReadSettings loads and validates the stored settings. A missing file is the
// documented default; an unreadable, symlinked or invalid file is reported as
// unavailable instead of being silently replaced, so a hand-edited credential
// file is never discarded behind the user's back.
func ReadSettings(cfg Config) (Settings, error) {
	path, err := SettingsPath(cfg)
	if err != nil {
		return Settings{}, err
	}
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return defaultSettings(), nil
	}
	if err != nil {
		return Settings{}, newProviderError("unavailable")
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() || info.Size() > maxSettingsBytes {
		return Settings{}, newProviderError("unavailable")
	}
	file, err := os.Open(path)
	if err != nil {
		return Settings{}, newProviderError("unavailable")
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxSettingsBytes+1))
	if err != nil || len(data) > maxSettingsBytes {
		return Settings{}, newProviderError("unavailable")
	}
	var settings Settings
	if err := json.Unmarshal(data, &settings); err != nil {
		return Settings{}, newProviderError("unavailable")
	}
	if err := validateSettings(&settings); err != nil {
		return Settings{}, newProviderError("unavailable")
	}
	return settings, nil
}

func validateSettings(settings *Settings) error {
	if settings.SchemaVersion == 0 {
		settings.SchemaVersion = settingsSchemaVersion
	}
	if settings.SchemaVersion != settingsSchemaVersion {
		return errors.New("settings: unsupported schemaVersion")
	}
	if settings.RefreshMinutes < minRefreshMinutes || settings.RefreshMinutes > maxRefreshMinutes {
		return errors.New("settings: refreshMinutes out of range")
	}
	if err := validateAPIKey(settings.APIKey); err != nil {
		return err
	}
	return nil
}

// validateAPIKey accepts an empty key (clearing) and otherwise requires a
// printable ASCII token: it is passed verbatim as an environment value to apm,
// so control characters, NUL and newlines must never reach the child.
func validateAPIKey(key string) error {
	if key == "" {
		return nil
	}
	if len(key) > maxAPIKeyBytes || !isPrintableASCII(key) {
		return errors.New("settings: apiKey must be printable ASCII")
	}
	return nil
}

func isPrintableASCII(value string) bool {
	for i := 0; i < len(value); i++ {
		if value[i] < 0x21 || value[i] > 0x7e {
			return false
		}
	}
	return true
}

// ApplySettingsUpdate validates one update against the stored settings and
// returns the document to persist.
func ApplySettingsUpdate(current Settings, update SettingsUpdate) (Settings, error) {
	next := Settings{
		SchemaVersion:    settingsSchemaVersion,
		ShowExperimental: update.ShowExperimental,
		RefreshMinutes:   update.RefreshMinutes,
		APIKey:           current.APIKey,
	}
	if update.APIKey != nil {
		next.APIKey = *update.APIKey
	}
	if err := validateSettings(&next); err != nil {
		return Settings{}, newProviderError("incompatible")
	}
	return next, nil
}

// WriteSettings atomically replaces the settings file with 0600 permissions.
// The temporary file is created in the destination directory, so the rename
// never crosses a filesystem boundary.
func WriteSettings(cfg Config, settings Settings) error {
	if err := validateSettings(&settings); err != nil {
		return newProviderError("incompatible")
	}
	path, err := SettingsPath(cfg)
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return newProviderError("unavailable")
	}
	if info, err := os.Lstat(path); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return newProviderError("unavailable")
	}
	payload, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return newProviderError("unknown")
	}
	payload = append(payload, '\n')
	temp, err := os.CreateTemp(dir, ".settings-*")
	if err != nil {
		return newProviderError("unavailable")
	}
	tempName := temp.Name()
	defer func() {
		if tempName != "" {
			_ = os.Remove(tempName)
		}
	}()
	if err := temp.Chmod(0o600); err != nil {
		_ = temp.Close()
		return newProviderError("unavailable")
	}
	if _, err := temp.Write(payload); err != nil {
		_ = temp.Close()
		return newProviderError("unavailable")
	}
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		return newProviderError("unavailable")
	}
	if err := temp.Close(); err != nil {
		return newProviderError("unavailable")
	}
	if err := os.Rename(tempName, path); err != nil {
		return newProviderError("unavailable")
	}
	tempName = ""
	return nil
}

// GetSettings implements `settings.get.v1`.
func GetSettings(cfg Config) (SettingsView, error) {
	settings, err := ReadSettings(cfg)
	if err != nil {
		return SettingsView{}, err
	}
	return SettingsView{
		ShowExperimental: settings.ShowExperimental,
		RefreshMinutes:   settings.RefreshMinutes,
		HasAPIKey:        settings.APIKey != "",
	}, nil
}

// UpdateSettings implements `settings.update.v1`: it returns the same view as
// `get`, so the page can refresh its "configured / not configured" state from
// the write result without a second round trip.
func UpdateSettings(cfg Config, update SettingsUpdate) (SettingsView, error) {
	current, err := ReadSettings(cfg)
	if err != nil {
		return SettingsView{}, err
	}
	next, err := ApplySettingsUpdate(current, update)
	if err != nil {
		return SettingsView{}, err
	}
	if err := WriteSettings(cfg, next); err != nil {
		return SettingsView{}, err
	}
	return SettingsView{
		ShowExperimental: next.ShowExperimental,
		RefreshMinutes:   next.RefreshMinutes,
		HasAPIKey:        next.APIKey != "",
	}, nil
}

// SettingsAPIKey returns the stored APC API key for the upload operation. It is
// never logged and never included in an operation result.
func SettingsAPIKey(cfg Config) (string, error) {
	settings, err := ReadSettings(cfg)
	if err != nil {
		return "", err
	}
	if settings.APIKey == "" {
		return "", newProviderError("unauthorized")
	}
	return settings.APIKey, nil
}
