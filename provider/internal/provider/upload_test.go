package provider

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// uploadConfig builds a config with an installed resource and one stored,
// enabled key.
func uploadConfig(t *testing.T, home, apmPath, key string) Config {
	t.Helper()
	cfg := Config{APMPath: apmPath, UserHome: home, DataDir: filepath.Join(home, "state")}
	if key != "" {
		if err := WriteSettings(cfg, Settings{
			SchemaVersion:  settingsSchemaVersion,
			RefreshMinutes: 15,
			APIKeys:        []StoredAPIKey{{ID: "0123456789abcdef0123456789abcdef", Key: key, Enabled: true}},
		}); err != nil {
			t.Fatal(err)
		}
	}
	return cfg
}

func writeUploadSkill(t *testing.T, home string) {
	t.Helper()
	writeResourceFile(t, home, ".bianbu-agent/skills/demo/SKILL.md",
		"---\nschema_version: 2\nname: demo\nname_zh: 演示\nname_en: Demo\nversion: \"v1.0.0\"\ndescription: Demo skill.\ndescription_zh: 演示技能。\n---\n")
	writeResourceFile(t, home, ".bianbu-agent/skills/demo/skill-card.md", "---\nschema_version: 2\n---\n")
}

func TestUploadCustomResourceRunsValidateThenSubmit(t *testing.T) {
	home := t.TempDir()
	writeUploadSkill(t, home)
	script := "#!/bin/sh\n" +
		"printf '%s\\n' \"$@\" >> \"$HOME/apm-argv.txt\"\n" +
		"printf 'ENV=%s\\n' \"$APC_API_KEY\" >> \"$HOME/apm-env.txt\"\n" +
		"case \"$1\" in\n" +
		"  validate) printf '{\"type\":\"skill\",\"name\":\"demo\"}\\n' ;;\n" +
		"  submit) printf 'outcome: accepted\\nsubmission_id: sub_01DEMO\\nstatus: received\\n' ;;\n" +
		"esac\n" +
		"exit 0\n"
	fixture := writeFixture(t, "apm", script)
	cfg := uploadConfig(t, home, fixture, "secret-key-123")

	result, err := UploadCustomResource(context.Background(), cfg,
		PowerTarget{Agent: "bibit", Type: "skill", Name: "demo"}, "Publish the local demo skill")
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "exited" || result.ExitCode != 0 || result.Stage != "submit" {
		t.Fatalf("unexpected result: %+v", result)
	}
	if !strings.Contains(result.Stdout, "sub_01DEMO") {
		t.Fatalf("submit report not carried through: %q", result.Stdout)
	}
	argv, err := os.ReadFile(filepath.Join(home, "apm-argv.txt"))
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimRight(string(argv), "\n"), "\n")
	wantPath := filepath.Join(home, ".bianbu-agent/skills/demo")
	want := []string{
		"validate", wantPath, "--type=skill", "--json",
		"submit", wantPath, "--type=skill", "--message=Publish the local demo skill",
	}
	if len(lines) != len(want) {
		t.Fatalf("argv lines = %q, want %q", lines, want)
	}
	for i := range want {
		if lines[i] != want[i] {
			t.Fatalf("argv[%d] = %q, want %q", i, lines[i], want[i])
		}
	}
	env, err := os.ReadFile(filepath.Join(home, "apm-env.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(env), "ENV=secret-key-123") {
		t.Fatalf("the API key must reach apm through the environment: %q", env)
	}
}

func TestUploadCustomResourceRequiresKey(t *testing.T) {
	home := t.TempDir()
	writeUploadSkill(t, home)
	fixture := writeFixture(t, "apm", "#!/bin/sh\ntouch \"$HOME/apm-ran\"\nexit 0\n")
	cfg := uploadConfig(t, home, fixture, "")

	_, err := UploadCustomResource(context.Background(), cfg,
		PowerTarget{Agent: "bibit", Type: "skill", Name: "demo"}, "Publish")
	assertProviderError(t, err, "unauthorized")
	if _, statErr := os.Stat(filepath.Join(home, "apm-ran")); statErr == nil {
		t.Fatal("apm must not run without a configured key")
	}
}

func TestUploadCustomResourceReportsValidateFailure(t *testing.T) {
	home := t.TempDir()
	writeUploadSkill(t, home)
	// mimicks apm validate: a non-zero exit with the reason on stdout.
	script := "#!/bin/sh\nprintf '%s\\n' \"$@\" >> \"$HOME/apm-argv.txt\"\n" +
		"printf 'error: SKILL.md is version 1; upgrade to 2\\n'\nexit 1\n"
	fixture := writeFixture(t, "apm", script)
	cfg := uploadConfig(t, home, fixture, "secret-key-123")

	result, err := UploadCustomResource(context.Background(), cfg,
		PowerTarget{Agent: "bibit", Type: "skill", Name: "demo"}, "Publish")
	if err != nil {
		t.Fatal(err)
	}
	if result.Stage != "validate" || result.ExitCode != 1 {
		t.Fatalf("unexpected result: %+v", result)
	}
	if !strings.Contains(result.Reason, "upgrade to 2") {
		t.Fatalf("validate reason must reach the caller: %q", result.Reason)
	}
	lines := strings.Split(strings.TrimRight(string(mustReadFile(t, filepath.Join(home, "apm-argv.txt"))), "\n"), "\n")
	if len(lines) != 4 || lines[0] != "validate" {
		t.Fatalf("submit must not run after a failed validate: %q", lines)
	}
}

func TestUploadCustomResourceReportsSubmitFailure(t *testing.T) {
	home := t.TempDir()
	writeUploadSkill(t, home)
	script := "#!/bin/sh\n" +
		"case \"$1\" in\n" +
		"  validate) exit 0 ;;\n" +
		"  submit) printf 'UNAUTHORIZED\\n'\nexit 2 ;;\n" +
		"esac\n"
	fixture := writeFixture(t, "apm", script)
	cfg := uploadConfig(t, home, fixture, "secret-key-123")

	result, err := UploadCustomResource(context.Background(), cfg,
		PowerTarget{Agent: "bibit", Type: "skill", Name: "demo"}, "Publish")
	if err != nil {
		t.Fatal(err)
	}
	if result.Stage != "submit" || result.ExitCode != 2 || result.Reason != "UNAUTHORIZED" {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestUploadCustomResourceRedactsKeyFromOutput(t *testing.T) {
	home := t.TempDir()
	writeUploadSkill(t, home)
	script := "#!/bin/sh\nprintf 'rejected credential: %s\\n' \"$APC_API_KEY\"\nexit 1\n"
	fixture := writeFixture(t, "apm", script)
	cfg := uploadConfig(t, home, fixture, "secret-key-123")

	result, err := UploadCustomResource(context.Background(), cfg,
		PowerTarget{Agent: "bibit", Type: "skill", Name: "demo"}, "Publish")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(result.Reason, "secret-key-123") {
		t.Fatalf("the API key leaked into the reason: %q", result.Reason)
	}
	if !strings.Contains(result.Reason, "***") {
		t.Fatalf("the redaction marker is missing: %q", result.Reason)
	}
}

func TestUploadCustomResourceRejectsBadMessage(t *testing.T) {
	home := t.TempDir()
	writeUploadSkill(t, home)
	fixture := writeFixture(t, "apm", "#!/bin/sh\nexit 0\n")
	cfg := uploadConfig(t, home, fixture, "secret-key-123")
	target := PowerTarget{Agent: "bibit", Type: "skill", Name: "demo"}
	for _, message := range []string{"", "   ", "line one\nline two", strings.Repeat("x", 201), "tab\there"} {
		if _, err := UploadCustomResource(context.Background(), cfg, target, message); err == nil {
			t.Fatalf("message %q must be rejected", message)
		}
	}
}

func TestUploadCustomResourceRejectsUnknownTarget(t *testing.T) {
	home := t.TempDir()
	fixture := writeFixture(t, "apm", "#!/bin/sh\nexit 0\n")
	cfg := uploadConfig(t, home, fixture, "secret-key-123")
	// The resource directory does not exist.
	_, err := UploadCustomResource(context.Background(), cfg,
		PowerTarget{Agent: "bibit", Type: "skill", Name: "absent"}, "Publish")
	assertProviderError(t, err, "incompatible")
}

func mustReadFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(data)
}

// apmFailureScript repeats apm's real failure shape: the actionable sentence is
// logged to stderr as a slog logfmt line, followed by Cobra's usage block, and
// stdout stays empty. The reason must still reach the caller.
func apmFailureScript(stage, reason string) string {
	return "#!/bin/sh\n" +
		"case \"$1\" in\n" +
		"  validate) if [ \"" + stage + "\" = validate ]; then\n" +
		"      printf 'level=ERROR msg=\"command failed\" error=\"%s\"\\n' '" + reason + "' >&2\n" +
		"      printf 'Usage:\\n  apm validate <path> [flags]\\n' >&2\n" +
		"      exit 1\n" +
		"    fi\n" +
		"    exit 0 ;;\n" +
		"  submit) if [ \"" + stage + "\" = submit ]; then\n" +
		"      printf 'level=ERROR msg=\"command failed\" error=\"%s\"\\n' '" + reason + "' >&2\n" +
		"      printf 'Usage:\\n  apm submit <path> [flags]\\n' >&2\n" +
		"      exit 1\n" +
		"    fi\n" +
		"    exit 0 ;;\n" +
		"esac\n"
}

func TestUploadCustomResourceReadsApmStderrReason(t *testing.T) {
	// apm 0.1.6 writes a failed validate to stderr only; the usage block that
	// follows must not end up in the user-facing reason.
	home := t.TempDir()
	writeUploadSkill(t, home)
	fixture := writeFixture(t, "apm", apmFailureScript("validate",
		`required file \"skill-card.md\" is missing`))
	cfg := uploadConfig(t, home, fixture, "secret-key-123")

	result, err := UploadCustomResource(context.Background(), cfg,
		PowerTarget{Agent: "bibit", Type: "skill", Name: "demo"}, "Publish")
	if err != nil {
		t.Fatal(err)
	}
	if result.Stage != "validate" || result.ExitCode != 1 {
		t.Fatalf("unexpected result: %+v", result)
	}
	if result.Reason != `required file "skill-card.md" is missing` {
		t.Fatalf("stderr reason not extracted: %q", result.Reason)
	}
	if strings.Contains(result.Reason, "Usage") || strings.Contains(result.Reason, "level=ERROR") {
		t.Fatalf("the logger prefix or usage block leaked into the reason: %q", result.Reason)
	}
}

func TestUploadCustomResourceReportsSubmitFailureFromStderr(t *testing.T) {
	home := t.TempDir()
	writeUploadSkill(t, home)
	fixture := writeFixture(t, "apm", apmFailureScript("submit",
		"submission requires APC_API_KEY: cloud provider configuration error"))
	cfg := uploadConfig(t, home, fixture, "secret-key-123")

	result, err := UploadCustomResource(context.Background(), cfg,
		PowerTarget{Agent: "bibit", Type: "skill", Name: "demo"}, "Publish")
	if err != nil {
		t.Fatal(err)
	}
	if result.Stage != "submit" || result.ExitCode != 1 {
		t.Fatalf("unexpected result: %+v", result)
	}
	if !strings.Contains(result.Reason, "requires APC_API_KEY") {
		t.Fatalf("stderr reason not extracted: %q", result.Reason)
	}
}

func TestUploadCustomResourceRedactsKeyFromStderr(t *testing.T) {
	home := t.TempDir()
	writeUploadSkill(t, home)
	script := "#!/bin/sh\nprintf 'error=\"rejected credential: %s\"\\n' \"$APC_API_KEY\" >&2\nexit 1\n"
	fixture := writeFixture(t, "apm", script)
	cfg := uploadConfig(t, home, fixture, "secret-key-123")

	result, err := UploadCustomResource(context.Background(), cfg,
		PowerTarget{Agent: "bibit", Type: "skill", Name: "demo"}, "Publish")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(result.Reason, "secret-key-123") {
		t.Fatalf("the API key leaked from stderr into the reason: %q", result.Reason)
	}
	if !strings.Contains(result.Reason, "***") {
		t.Fatalf("the stderr redaction marker is missing: %q", result.Reason)
	}
}

func TestUploadCustomResourceUnboundedStderrDoesNotBlock(t *testing.T) {
	// A child that writes far more stderr than the buffer keeps must not block on
	// a full pipe; the bounded sink drops the excess and the exit code still wins.
	home := t.TempDir()
	writeUploadSkill(t, home)
	script := "#!/bin/sh\n" +
		"i=0\n" +
		"while [ $i -lt 400 ]; do\n" +
		"  printf 'level=ERROR msg=\"command failed\" error=\"noise %s\"\\n' \"$i\" >&2\n" +
		"  i=$((i+1))\n" +
		"done\n" +
		"exit 3\n"
	fixture := writeFixture(t, "apm", script)
	cfg := uploadConfig(t, home, fixture, "secret-key-123")

	result, err := UploadCustomResource(context.Background(), cfg,
		PowerTarget{Agent: "bibit", Type: "skill", Name: "demo"}, "Publish")
	if err != nil {
		t.Fatal(err)
	}
	if result.ExitCode != 3 || result.Stage != "validate" {
		t.Fatalf("unexpected result: %+v", result)
	}
	if result.Reason == "" {
		t.Fatal("a bounded stderr prefix must still yield a reason")
	}
}

func TestLogfmtAttribute(t *testing.T) {
	cases := map[string]string{
		`level=ERROR msg="command failed" error="missing skill-card.md"` + "\nUsage:\n": "missing skill-card.md",
		`level=ERROR msg="command failed" error="has \"quotes\" inside"`:                `has "quotes" inside`,
		`error="trailing" level=ERROR`:                                                  "trailing",
		`level=ERROR msg="command failed"`:                                              "",
		``:                                                                              "",
	}
	for input, want := range cases {
		if got := logfmtAttribute(input, "error"); got != want {
			t.Fatalf("logfmtAttribute(%q) = %q, want %q", input, got, want)
		}
	}
	// The first logfmt line wins: apm logs exactly one error line, and any later
	// mention inside the usage block is not the reason.
	multi := "level=ERROR msg=\"command failed\" error=\"first\"\nerror=\"second\"\n"
	if got := logfmtAttribute(multi, "error"); got != "first" {
		t.Fatalf("logfmtAttribute picked %q, want the first line", got)
	}
}

func TestSanitizeReasonSingleLine(t *testing.T) {
	got := sanitizeReason("first\r\n\tsecond \x1b[31mthird\x1b[0m\n", "")
	if got != "first second third" {
		t.Fatalf("sanitizeReason = %q", got)
	}
	long := sanitizeReason(strings.Repeat("a", maxReasonBytes*3), "")
	if len(long) > maxReasonBytes+4 {
		t.Fatalf("reason is not bounded: %d bytes", len(long))
	}
	if !strings.HasPrefix(sanitizeReason(strings.Repeat("你", maxReasonBytes), ""), "你") {
		t.Fatal("truncation must keep valid UTF-8")
	}
}
