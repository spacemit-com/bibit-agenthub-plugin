package provider

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSettingsRoundTrip(t *testing.T) {
	home := t.TempDir()
	cfg := Config{UserHome: home}

	defaults, err := GetSettings(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if defaults.RefreshMinutes != 15 || defaults.ShowExperimental || defaults.HasAPIKey {
		t.Fatalf("unexpected defaults: %+v", defaults)
	}

	key := "apc-key-abc"
	updated, err := UpdateSettings(cfg, SettingsUpdate{ShowExperimental: true, RefreshMinutes: 30, APIKey: &key})
	if err != nil {
		t.Fatal(err)
	}
	if !updated.ShowExperimental || updated.RefreshMinutes != 30 || !updated.HasAPIKey {
		t.Fatalf("unexpected update result: %+v", updated)
	}

	reread, err := GetSettings(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if !reread.ShowExperimental || reread.RefreshMinutes != 30 || !reread.HasAPIKey {
		t.Fatalf("settings did not persist: %+v", reread)
	}

	// The stored key must be readable for the upload path but never returned by
	// `get`.
	stored, err := SettingsAPIKey(cfg)
	if err != nil || stored != key {
		t.Fatalf("stored key = %q, err = %v", stored, err)
	}
	raw, err := os.ReadFile(filepath.Join(home, ".local/state/bibit-agenthub/settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), key) {
		t.Fatalf("key missing from the file: %s", raw)
	}
	// `hasApiKey` is the only key-shaped field on the wire.
	encoded, err := json.Marshal(reread)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), key) || strings.Contains(string(encoded), "apiKey") {
		t.Fatalf("the view leaked the credential: %s", encoded)
	}
}

func TestSettingsFilePermissions(t *testing.T) {
	home := t.TempDir()
	cfg := Config{UserHome: home}
	key := "k"
	if _, err := UpdateSettings(cfg, SettingsUpdate{RefreshMinutes: 15, APIKey: &key}); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(home, ".local/state/bibit-agenthub/settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("settings mode = %v, want 0600", info.Mode().Perm())
	}
}

func TestSettingsUpdateKeepsKeyWhenOmitted(t *testing.T) {
	home := t.TempDir()
	cfg := Config{UserHome: home}
	key := "keep-me"
	if _, err := UpdateSettings(cfg, SettingsUpdate{RefreshMinutes: 15, APIKey: &key}); err != nil {
		t.Fatal(err)
	}
	// Omitting apiKey keeps it; an empty string clears it.
	if _, err := UpdateSettings(cfg, SettingsUpdate{ShowExperimental: true, RefreshMinutes: 20}); err != nil {
		t.Fatal(err)
	}
	if stored, err := SettingsAPIKey(cfg); err != nil || stored != key {
		t.Fatalf("key was lost: %q %v", stored, err)
	}
	clear := ""
	if _, err := UpdateSettings(cfg, SettingsUpdate{RefreshMinutes: 20, APIKey: &clear}); err != nil {
		t.Fatal(err)
	}
	if _, err := SettingsAPIKey(cfg); err == nil {
		t.Fatal("cleared key must not be usable")
	}
	view, err := GetSettings(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if view.HasAPIKey {
		t.Fatalf("hasApiKey must be false after clearing: %+v", view)
	}
}

func TestSettingsRejectsInvalidPayloads(t *testing.T) {
	home := t.TempDir()
	cfg := Config{UserHome: home}
	bad := []SettingsUpdate{
		{RefreshMinutes: 0},
		{RefreshMinutes: 4},
		{RefreshMinutes: 121},
	}
	for _, update := range bad {
		if _, err := UpdateSettings(cfg, update); err == nil {
			t.Fatalf("update %+v must be rejected", update)
		}
	}
	for _, key := range []string{"has space", "line\nbreak", "tab\tkey", strings.Repeat("x", maxAPIKeyBytes+1)} {
		value := key
		if _, err := UpdateSettings(cfg, SettingsUpdate{RefreshMinutes: 15, APIKey: &value}); err == nil {
			t.Fatalf("key %q must be rejected", key)
		}
	}
}

func TestSettingsReadRejectsSymlinkAndCorruptFile(t *testing.T) {
	home := t.TempDir()
	cfg := Config{UserHome: home}
	dir := filepath.Join(home, ".local/state/bibit-agenthub")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	// Corrupt file: reported, never silently replaced.
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := GetSettings(cfg); err == nil {
		t.Fatal("a corrupt settings file must be reported")
	}
	// Symlinked file: refused outright.
	if err := os.Remove(filepath.Join(dir, "settings.json")); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(home, "elsewhere.json")
	if err := os.WriteFile(target, []byte(`{"schemaVersion":1,"refreshMinutes":15}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(dir, "settings.json")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := GetSettings(cfg); err == nil {
		t.Fatal("a symlinked settings file must be refused")
	}
	if _, err := UpdateSettings(cfg, SettingsUpdate{RefreshMinutes: 15}); err == nil {
		t.Fatal("writing through a symlink must be refused")
	}
}

func TestSettingsPathUsesDataDirOverride(t *testing.T) {
	dir := t.TempDir()
	cfg := Config{UserHome: t.TempDir(), DataDir: dir}
	key := "k"
	if _, err := UpdateSettings(cfg, SettingsUpdate{RefreshMinutes: 15, APIKey: &key}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "settings.json")); err != nil {
		t.Fatalf("settings must live in the data dir: %v", err)
	}
}

func TestSettingsPathFromEnvironment(t *testing.T) {
	dir := t.TempDir()
	t.Setenv(providerDataDirEnv, dir)
	cfg, err := ParseConfig(nil)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DataDir != dir {
		t.Fatalf("DataDir = %q, want %q", cfg.DataDir, dir)
	}
	path, err := SettingsPath(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if path != filepath.Join(dir, "settings.json") {
		t.Fatalf("SettingsPath = %q", path)
	}
	// A relative environment value is rejected at startup rather than at use.
	t.Setenv(providerDataDirEnv, "relative")
	if _, err := ParseConfig(nil); err == nil {
		t.Fatal("a relative data dir must be rejected")
	}
}

func TestSettingsPathWithoutHomeOrDataDir(t *testing.T) {
	t.Setenv(providerDataDirEnv, "")
	home := t.TempDir()
	if _, err := SettingsPath(Config{UserHome: home}); err != nil {
		t.Fatal(err)
	}
	if _, err := SettingsPath(Config{}); err == nil {
		t.Fatal("without a home there is nowhere to store settings")
	}
}

func TestDecodeSettingsUpdateRejectsUnknownFields(t *testing.T) {
	if _, err := decodeSettingsUpdate(json.RawMessage(`{"refreshMinutes":15,"unknown":1}`)); err == nil {
		t.Fatal("unknown fields must be rejected")
	}
	if _, err := decodeSettingsUpdate(json.RawMessage(`{"refreshMinutes":"15"}`)); err == nil {
		t.Fatal("a string refreshMinutes must be rejected")
	}
	if _, err := decodeSettingsUpdate(json.RawMessage(`{"showExperimental":false,"refreshMinutes":15,"apiKey":"k"}`)); err != nil {
		t.Fatalf("a valid payload must decode: %v", err)
	}
}

func TestDecodePowerTargetForCustomDelete(t *testing.T) {
	target, err := decodePowerTarget(json.RawMessage(`{"agent":"hermes-agent","type":"skill","name":"demo"}`))
	if err != nil || target.Agent != "hermes-agent" {
		t.Fatalf("target = %+v, err = %v", target, err)
	}
	if _, err := decodePowerTarget(json.RawMessage(`{"agent":"hermes-agent","type":"skill","name":"../escape"}`)); err == nil {
		t.Fatal("path separators must be rejected")
	}
	if _, err := decodePowerTarget(json.RawMessage(`{"agent":"hermes-agent","type":"skill","name":"demo","version":"v1.0.0"}`)); err == nil {
		t.Fatal("delete must not accept a version")
	}
}

func TestDecodeUploadInput(t *testing.T) {
	upload, err := decodeUploadInput(json.RawMessage(`{"agent":"bibit","type":"skill","name":"demo","message":"hello"}`))
	if err != nil || upload.Message != "hello" || upload.Name != "demo" {
		t.Fatalf("upload = %+v, err = %v", upload, err)
	}
	for _, payload := range []string{
		`{"agent":"bibit","type":"skill","name":"demo"}`,
		`{"agent":"bibit","type":"skill","name":"demo","message":"  "}`,
		`{"agent":"bibit","type":"skill","name":"demo","message":"a\nb"}`,
		`{"agent":"bibit","type":"skill","name":"demo","message":"ok","extra":1}`,
	} {
		if _, err := decodeUploadInput(json.RawMessage(payload)); err == nil {
			t.Fatalf("payload %s must be rejected", payload)
		}
	}
}

func TestDecodeCustomListInput(t *testing.T) {
	list, err := decodeCustomListInput(json.RawMessage(`{"agent":"codex"}`))
	if err != nil || list.Agent != "codex" {
		t.Fatalf("list = %+v, err = %v", list, err)
	}
	for _, payload := range []string{`{}`, `{"agent":""}`, `{"agent":"unknown"}`, `{"agent":"codex","scope":"installed"}`} {
		if _, err := decodeCustomListInput(json.RawMessage(payload)); err == nil {
			t.Fatalf("payload %s must be rejected", payload)
		}
	}
}

func TestSettingsCredentialPolicyDeclared(t *testing.T) {
	// The host rejects an `apiKey` parameter unless the Registry declares it as
	// the operation's credential, so the drop-in must keep this entry.
	source := mustReadFile(t, filepath.Join("..", "..", "..", "debian", "agenthub-provider.json"))
	if !strings.Contains(source, `"credentialParameters"`) ||
		!strings.Contains(source, `"settings.update.v1"`) ||
		!strings.Contains(source, `"apiKey"`) {
		t.Fatalf("provider registry is missing the settings credential policy: %s", source)
	}
}
