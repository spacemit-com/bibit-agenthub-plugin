package provider

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Agent Hub settings are owned by the provider because the feature host only
// forwards operations: the plugin cannot read or write files, so the APC API
// keys have to live behind the `settings.*` operations.
//
// The file is deliberately tiny and human-repairable: strict validation, 0600
// and an atomic replace. Keys are written to disk but never returned by `get`:
// the view carries a masked preview instead, so a compromised renderer cannot
// read a credential back out. At most one key is enabled at a time, and that key
// is the one the upload path uses.
//
// schemaVersion 1 stored a single `apiKey` string. Version 2 stores a list; a v1
// file is migrated on read (the single key becomes the enabled entry) and
// rewritten as v2 on the next write, so an existing installation keeps its
// credential.

const (
	settingsSchemaVersion = 2
	settingsFileName      = "settings.json"
	maxSettingsBytes      = 64 << 10
	maxAPIKeyBytes        = 512
	// maxAPIKeys bounds the list so a runaway page cannot grow the file without
	// limit; it is far above any human bookkeeping need.
	maxAPIKeys = 50

	minRefreshMinutes = 5
	maxRefreshMinutes = 120
)

// StoredAPIKey is one saved APC credential. ID is the stable handle the page
// uses to enable or delete the entry; Key is the secret and never leaves the
// provider.
type StoredAPIKey struct {
	ID      string `json:"id"`
	Key     string `json:"key"`
	Enabled bool   `json:"enabled,omitempty"`
}

// Settings is the persisted document. SchemaVersion is written so a migration
// can tell which shape it is reading. APIKey is the v1 field: it is read for
// migration and never written again (`omitempty` keeps it out of a v2 file).
type Settings struct {
	SchemaVersion    int            `json:"schemaVersion"`
	ShowExperimental bool           `json:"showExperimental"`
	RefreshMinutes   int            `json:"refreshMinutes"`
	APIKeys          []StoredAPIKey `json:"apiKeys,omitempty"`
	APIKey           string         `json:"apiKey,omitempty"`
}

// SettingsKeyView is one row of the Settings tab: enough to recognise a key and
// act on it, never enough to reconstruct it.
type SettingsKeyView struct {
	ID      string `json:"id"`
	Preview string `json:"preview"`
	Enabled bool   `json:"enabled"`
}

// SettingsView is what the page is allowed to see. There is no `hasApiKey`
// any more: the list itself says how many keys exist and which one is enabled.
type SettingsView struct {
	ShowExperimental bool              `json:"showExperimental"`
	RefreshMinutes   int               `json:"refreshMinutes"`
	Keys             []SettingsKeyView `json:"keys"`
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
	settings, err = migrateSettings(settings)
	if err != nil {
		return Settings{}, err
	}
	if err := validateSettings(&settings); err != nil {
		return Settings{}, newProviderError("unavailable")
	}
	return settings, nil
}

// migrateSettings upgrades a v1 document in memory. In the one-key world that key
// became the single enabled entry. A zero schemaVersion is the shape older
// builds wrote before the field existed.
func migrateSettings(settings Settings) (Settings, error) {
	if settings.SchemaVersion == settingsSchemaVersion {
		return settings, nil
	}
	if settings.SchemaVersion != 0 && settings.SchemaVersion != 1 {
		return settings, nil
	}
	next := Settings{
		SchemaVersion:    settingsSchemaVersion,
		ShowExperimental: settings.ShowExperimental,
		RefreshMinutes:   settings.RefreshMinutes,
	}
	if settings.APIKey != "" {
		id, err := newAPIKeyID()
		if err != nil {
			return Settings{}, err
		}
		next.APIKeys = []StoredAPIKey{{ID: id, Key: settings.APIKey, Enabled: true}}
	}
	return next, nil
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
	// A v2 document never carries the v1 field; reading one means a migration
	// failed and writing it back would resurrect a two-source-of-truth file.
	if settings.APIKey != "" {
		return errors.New("settings: apiKey is a v1 field")
	}
	if len(settings.APIKeys) > maxAPIKeys {
		return errors.New("settings: too many apiKeys")
	}
	seen := make(map[string]bool, len(settings.APIKeys))
	enabled := 0
	for _, entry := range settings.APIKeys {
		if !isAPIKeyID(entry.ID) {
			return errors.New("settings: apiKey id must be a hex token")
		}
		if seen[entry.ID] {
			return errors.New("settings: duplicate apiKey id")
		}
		seen[entry.ID] = true
		if entry.Key == "" {
			return errors.New("settings: apiKey must be a non-empty string")
		}
		if err := validateAPIKey(entry.Key); err != nil {
			return err
		}
		if entry.Enabled {
			enabled++
		}
	}
	if enabled > 1 {
		return errors.New("settings: at most one apiKey may be enabled")
	}
	return nil
}

// validateAPIKey requires a printable ASCII token: it is passed verbatim as an
// environment value to apm, so control characters, NUL and newlines must never
// reach the child. The empty string is the caller's "nothing to validate" case.
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

// isAPIKeyID accepts the generated hex handle. It is the only shape the page can
// send back, so no free-form identifier ever reaches the file.
func isAPIKeyID(id string) bool {
	if len(id) != 32 {
		return false
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		if (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') {
			continue
		}
		return false
	}
	return true
}

// newAPIKeyID draws a random 128-bit handle.
func newAPIKeyID() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", newProviderError("unknown")
	}
	return hex.EncodeToString(raw[:]), nil
}

// MaskAPIKey is the only shape of a stored credential that may leave the
// provider: a head, a fixed `****` run and a tail. The fixed run keeps the
// preview distinguishable from the key itself even for a very short key.
func MaskAPIKey(key string) string {
	if key == "" {
		return ""
	}
	if len(key) <= 8 {
		head := len(key)
		if head > 2 {
			head = 2
		}
		return key[:head] + "****"
	}
	return key[:4] + "****" + key[len(key)-4:]
}

func settingsView(settings Settings) SettingsView {
	keys := make([]SettingsKeyView, 0, len(settings.APIKeys))
	for _, entry := range settings.APIKeys {
		keys = append(keys, SettingsKeyView{
			ID:      entry.ID,
			Preview: MaskAPIKey(entry.Key),
			Enabled: entry.Enabled,
		})
	}
	return SettingsView{
		ShowExperimental: settings.ShowExperimental,
		RefreshMinutes:   settings.RefreshMinutes,
		Keys:             keys,
	}
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

// GetSettings implements `settings.get.v2`: the keys are reduced to masked
// previews, so the page can list and manage them without ever holding one.
func GetSettings(cfg Config) (SettingsView, error) {
	settings, err := ReadSettings(cfg)
	if err != nil {
		return SettingsView{}, err
	}
	return settingsView(settings), nil
}

// AddSettingsKey implements `settings.keys.add.v1`. The first saved key is
// enabled, because an empty list has nothing to fall back on; every later key
// arrives disabled so adding one never silently switches the credential the
// upload path is using.
func AddSettingsKey(cfg Config, apiKey string) (SettingsView, error) {
	if apiKey == "" || validateAPIKey(apiKey) != nil {
		return SettingsView{}, newProviderError("incompatible")
	}
	current, err := ReadSettings(cfg)
	if err != nil {
		return SettingsView{}, err
	}
	for _, entry := range current.APIKeys {
		if entry.Key == apiKey {
			return SettingsView{}, newProviderError("incompatible")
		}
	}
	if len(current.APIKeys) >= maxAPIKeys {
		return SettingsView{}, newProviderError("incompatible")
	}
	id, err := newAPIKeyID()
	if err != nil {
		return SettingsView{}, err
	}
	next := current
	next.APIKeys = append(append([]StoredAPIKey{}, current.APIKeys...),
		StoredAPIKey{ID: id, Key: apiKey, Enabled: len(current.APIKeys) == 0})
	next.APIKey = ""
	if err := WriteSettings(cfg, next); err != nil {
		return SettingsView{}, err
	}
	return settingsView(next), nil
}

// DeleteSettingsKey implements `settings.keys.delete.v1`. Deleting the enabled
// key leaves the remaining keys disabled rather than promoting one: which key
// the upload path uses next is the user's decision.
func DeleteSettingsKey(cfg Config, id string) (SettingsView, error) {
	current, err := ReadSettings(cfg)
	if err != nil {
		return SettingsView{}, err
	}
	index := -1
	for i, entry := range current.APIKeys {
		if entry.ID == id {
			index = i
			break
		}
	}
	if index < 0 {
		return SettingsView{}, newProviderError("incompatible")
	}
	next := current
	next.APIKeys = append(append([]StoredAPIKey{}, current.APIKeys[:index]...), current.APIKeys[index+1:]...)
	next.APIKey = ""
	if err := WriteSettings(cfg, next); err != nil {
		return SettingsView{}, err
	}
	return settingsView(next), nil
}

// EnableSettingsKey implements `settings.keys.enable.v1`: the named key becomes
// the only enabled one, so the upload path always has exactly one credential.
func EnableSettingsKey(cfg Config, id string) (SettingsView, error) {
	current, err := ReadSettings(cfg)
	if err != nil {
		return SettingsView{}, err
	}
	found := false
	next := current
	next.APIKeys = make([]StoredAPIKey, len(current.APIKeys))
	for i, entry := range current.APIKeys {
		if entry.ID == id {
			found = true
			entry.Enabled = true
		} else {
			entry.Enabled = false
		}
		next.APIKeys[i] = entry
	}
	if !found {
		return SettingsView{}, newProviderError("incompatible")
	}
	next.APIKey = ""
	if err := WriteSettings(cfg, next); err != nil {
		return SettingsView{}, err
	}
	return settingsView(next), nil
}

// SettingsAPIKey returns the enabled APC API key for the upload operation. It is
// never logged and never included in an operation result.
func SettingsAPIKey(cfg Config) (string, error) {
	settings, err := ReadSettings(cfg)
	if err != nil {
		return "", err
	}
	for _, entry := range settings.APIKeys {
		if entry.Enabled {
			return entry.Key, nil
		}
	}
	return "", newProviderError("unauthorized")
}
