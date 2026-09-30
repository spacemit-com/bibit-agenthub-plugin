package provider

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSettingsDefaultsToNoKeys(t *testing.T) {
	cfg := Config{UserHome: t.TempDir()}
	defaults, err := GetSettings(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if defaults.RefreshMinutes != 15 || defaults.ShowExperimental || len(defaults.Keys) != 0 {
		t.Fatalf("unexpected defaults: %+v", defaults)
	}
	if _, err := SettingsAPIKey(cfg); err == nil {
		t.Fatal("an empty list must not yield a usable key")
	}
}

func TestSettingsFirstKeyIsEnabledAndLaterKeysAreNot(t *testing.T) {
	cfg := Config{UserHome: t.TempDir()}

	first, err := AddSettingsKey(cfg, "apc-key-one")
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Keys) != 1 || !first.Keys[0].Enabled {
		t.Fatalf("the first key must be enabled: %+v", first)
	}
	if first.Keys[0].Preview != "apc-****-one" {
		t.Fatalf("unexpected preview: %q", first.Keys[0].Preview)
	}
	if first.Keys[0].ID == "" {
		t.Fatal("a saved key needs an id")
	}

	second, err := AddSettingsKey(cfg, "apc-key-two")
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Keys) != 2 {
		t.Fatalf("expected two keys: %+v", second)
	}
	if !second.Keys[0].Enabled || second.Keys[1].Enabled {
		t.Fatalf("adding a key must not switch the enabled one: %+v", second.Keys)
	}

	stored, err := SettingsAPIKey(cfg)
	if err != nil || stored != "apc-key-one" {
		t.Fatalf("the enabled key must be the upload credential: %q %v", stored, err)
	}

	// The view is the only shape on the wire, and it never carries a real key.
	encoded, err := json.Marshal(second)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "apc-key-one") || strings.Contains(string(encoded), "apc-key-two") {
		t.Fatalf("the view leaked a credential: %s", encoded)
	}
	if strings.Contains(string(encoded), `"apiKey"`) || strings.Contains(string(encoded), `"hasApiKey"`) {
		t.Fatalf("the view kept a retired field: %s", encoded)
	}

	// The secret is on disk, readable by the upload path only.
	raw, err := os.ReadFile(filepath.Join(cfg.UserHome, ".local/state/bibit-agenthub/settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "apc-key-one") || !strings.Contains(string(raw), "apc-key-two") {
		t.Fatalf("keys missing from the file: %s", raw)
	}
	if strings.Contains(string(raw), `"apiKey"`) {
		t.Fatalf("the v1 field must not be written: %s", raw)
	}
}

func TestSettingsEnableSwitchesTheOnlyEnabledKey(t *testing.T) {
	cfg := Config{UserHome: t.TempDir()}
	if _, err := AddSettingsKey(cfg, "apc-key-one"); err != nil {
		t.Fatal(err)
	}
	view, err := AddSettingsKey(cfg, "apc-key-two")
	if err != nil {
		t.Fatal(err)
	}
	second := view.Keys[1].ID

	enabled, err := EnableSettingsKey(cfg, second)
	if err != nil {
		t.Fatal(err)
	}
	if enabled.Keys[0].Enabled || !enabled.Keys[1].Enabled {
		t.Fatalf("exactly one key must be enabled: %+v", enabled.Keys)
	}
	stored, err := SettingsAPIKey(cfg)
	if err != nil || stored != "apc-key-two" {
		t.Fatalf("the enabled key must be the upload credential: %q %v", stored, err)
	}

	if _, err := EnableSettingsKey(cfg, "ffffffffffffffffffffffffffffffff"); err == nil {
		t.Fatal("an unknown id must be rejected")
	}
}

func TestSettingsDeleteLeavesNoEnabledKey(t *testing.T) {
	cfg := Config{UserHome: t.TempDir()}
	first, err := AddSettingsKey(cfg, "apc-key-one")
	if err != nil {
		t.Fatal(err)
	}
	view, err := AddSettingsKey(cfg, "apc-key-two")
	if err != nil {
		t.Fatal(err)
	}

	// Deleting the enabled key does not promote the survivor: the user chooses.
	after, err := DeleteSettingsKey(cfg, first.Keys[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(after.Keys) != 1 || after.Keys[0].Enabled {
		t.Fatalf("the survivor must stay disabled: %+v", after.Keys)
	}
	if _, err := SettingsAPIKey(cfg); err == nil {
		t.Fatal("no key is enabled, so upload must be unauthorized")
	}

	// Re-enabling the survivor works, and deleting it empties the list.
	after, err = EnableSettingsKey(cfg, after.Keys[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if !after.Keys[0].Enabled {
		t.Fatalf("the survivor must be enabled: %+v", after.Keys)
	}
	after, err = DeleteSettingsKey(cfg, view.Keys[1].ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(after.Keys) != 0 {
		t.Fatalf("the list must be empty: %+v", after.Keys)
	}

	if _, err := DeleteSettingsKey(cfg, "ffffffffffffffffffffffffffffffff"); err == nil {
		t.Fatal("an unknown id must be rejected")
	}
}

func TestSettingsRejectsUnusableKeys(t *testing.T) {
	cfg := Config{UserHome: t.TempDir()}
	for _, key := range []string{"", "has space", "line\nbreak", "tab\tkey", strings.Repeat("x", maxAPIKeyBytes+1)} {
		if _, err := AddSettingsKey(cfg, key); err == nil {
			t.Fatalf("key %q must be rejected", key)
		}
	}
	if _, err := AddSettingsKey(cfg, "apc-key-one"); err != nil {
		t.Fatal(err)
	}
	if _, err := AddSettingsKey(cfg, "apc-key-one"); err == nil {
		t.Fatal("a duplicate key must be rejected")
	}
}

func TestSettingsFilePermissions(t *testing.T) {
	cfg := Config{UserHome: t.TempDir()}
	if _, err := AddSettingsKey(cfg, "k"); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(cfg.UserHome, ".local/state/bibit-agenthub/settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("settings mode = %v, want 0600", info.Mode().Perm())
	}
}

func TestSettingsMigratesTheV1Key(t *testing.T) {
	home := t.TempDir()
	cfg := Config{UserHome: home}
	dir := filepath.Join(home, ".local/state/bibit-agenthub")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	// The 0.3.11 shape: schemaVersion 1 with one apiKey.
	legacy := `{"schemaVersion":1,"showExperimental":false,"refreshMinutes":15,"apiKey":"apc-legacy"}`
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}

	view, err := GetSettings(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Keys) != 1 || !view.Keys[0].Enabled || view.Keys[0].Preview != "apc-****gacy" {
		t.Fatalf("the v1 key must migrate into an enabled entry: %+v", view.Keys)
	}
	if stored, err := SettingsAPIKey(cfg); err != nil || stored != "apc-legacy" {
		t.Fatalf("the migrated key must stay usable: %q %v", stored, err)
	}

	// The next write lands the v2 shape.
	if _, err := AddSettingsKey(cfg, "apc-second"); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"schemaVersion": 2`) || strings.Contains(string(raw), `"apiKey"`) {
		t.Fatalf("the rewrite must be a v2 document: %s", raw)
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
	// A file with two enabled keys: refused rather than silently repaired.
	two := `{"schemaVersion":2,"refreshMinutes":15,"apiKeys":[` +
		`{"id":"0123456789abcdef0123456789abcdef","key":"a","enabled":true},` +
		`{"id":"fedcba9876543210fedcba9876543210","key":"b","enabled":true}]}`
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(two), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := GetSettings(cfg); err == nil {
		t.Fatal("more than one enabled key must be refused")
	}
	// A v2 file that still carries the v1 field is refused.
	stale := `{"schemaVersion":2,"refreshMinutes":15,"apiKey":"x","apiKeys":[]}`
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(stale), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := GetSettings(cfg); err == nil {
		t.Fatal("a v2 file with the v1 field must be refused")
	}
	// Symlinked file: refused outright.
	if err := os.Remove(filepath.Join(dir, "settings.json")); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(home, "elsewhere.json")
	if err := os.WriteFile(target, []byte(`{"schemaVersion":2,"refreshMinutes":15}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(dir, "settings.json")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := GetSettings(cfg); err == nil {
		t.Fatal("a symlinked settings file must be refused")
	}
	if _, err := AddSettingsKey(cfg, "apc-key"); err == nil {
		t.Fatal("writing through a symlink must be refused")
	}
}

func TestSettingsCapsTheNumberOfKeys(t *testing.T) {
	cfg := Config{UserHome: t.TempDir()}
	for i := 0; i < maxAPIKeys; i++ {
		key := "apc-key-" + strings.Repeat("a", i+1)
		if _, err := AddSettingsKey(cfg, key); err != nil {
			t.Fatalf("key %d: %v", i, err)
		}
	}
	if _, err := AddSettingsKey(cfg, "apc-key-overflow"); err == nil {
		t.Fatal("the list must be capped")
	}
}

func TestMaskAPIKey(t *testing.T) {
	cases := map[string]string{
		"":            "",
		"k":           "k****",
		"abc":         "ab****",
		"abcdefgh":    "ab****",
		"abcdefghi":   "abcd****fghi",
		"apc-key-123": "apc-****-123",
	}
	for input, want := range cases {
		if got := MaskAPIKey(input); got != want {
			t.Fatalf("MaskAPIKey(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestSettingsPathUsesDataDirOverride(t *testing.T) {
	dir := t.TempDir()
	cfg := Config{UserHome: t.TempDir(), DataDir: dir}
	if _, err := AddSettingsKey(cfg, "k"); err != nil {
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

func TestDecodeSettingsKeyPayloads(t *testing.T) {
	key, err := decodeSettingsKeyAdd(json.RawMessage(`{"apiKey":"apc-key"}`))
	if err != nil || key != "apc-key" {
		t.Fatalf("key = %q, err = %v", key, err)
	}
	for _, payload := range []string{
		`{}`,
		`{"apiKey":""}`,
		`{"apiKey":5}`,
		`{"apiKey":"has space"}`,
		`{"apiKey":"ok","extra":1}`,
	} {
		if _, err := decodeSettingsKeyAdd(json.RawMessage(payload)); err == nil {
			t.Fatalf("payload %s must be rejected", payload)
		}
	}

	id, err := decodeSettingsKeyID(json.RawMessage(`{"id":"0123456789abcdef0123456789abcdef"}`))
	if err != nil || id != "0123456789abcdef0123456789abcdef" {
		t.Fatalf("id = %q, err = %v", id, err)
	}
	for _, payload := range []string{
		`{}`,
		`{"id":""}`,
		`{"id":"../escape"}`,
		`{"id":"0123456789ABCDEF0123456789ABCDEF"}`,
		`{"id":"0123456789abcdef0123456789abcdef","key":"k"}`,
	} {
		if _, err := decodeSettingsKeyID(json.RawMessage(payload)); err == nil {
			t.Fatalf("payload %s must be rejected", payload)
		}
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
		!strings.Contains(source, `"settings.keys.add.v1"`) ||
		!strings.Contains(source, `"apiKey"`) {
		t.Fatalf("provider registry is missing the settings credential policy: %s", source)
	}
	if strings.Contains(source, `"settings.update.v1"`) {
		t.Fatalf("the retired operation must not stay in the registry: %s", source)
	}
}
