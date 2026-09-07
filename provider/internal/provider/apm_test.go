package provider

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const apmFixtureOutput = "[{\"agent\":\"bibit\",\"type\":\"skill\",\"name\":\"démo\",\"version\":\"v1.0.0\",\"description\":\"héllo wörld\",\"tags\":[\"ünïcode\",\"with space\"]}]\n"

func writeFixture(t *testing.T, name, script string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func apmConfig(path, home string) Config {
	return Config{APMPath: path, UserHome: home, APCBaseURL: defaultAPCBaseURL}
}

func TestReadInstalledPassthrough(t *testing.T) {
	home := t.TempDir()
	script := "#!/bin/sh\n" +
		"printf '%s\\n' \"$@\" > \"$HOME/apm-argv.txt\"\n" +
		"env | sort > \"$HOME/apm-env.txt\"\n" +
		"cat <<'APMOUT'\n" + apmFixtureOutput + "APMOUT\n"
	fixture := writeFixture(t, "apm", script)

	result, err := ReadInstalled(context.Background(), apmConfig(fixture, home), "bibit")
	if err != nil {
		t.Fatal(err)
	}
	if result.Scope != "installed" || result.Status != "data" {
		t.Fatalf("unexpected envelope: %+v", result)
	}
	if result.ListJSON == nil || *result.ListJSON != apmFixtureOutput {
		t.Fatalf("raw text not preserved verbatim: %q", *result.ListJSON)
	}

	argv, err := os.ReadFile(filepath.Join(home, "apm-argv.txt"))
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Split(strings.TrimRight(string(argv), "\n"), "\n")
	want := []string{"list", "--installed", "--agent=bibit", "--json"}
	if len(got) != len(want) {
		t.Fatalf("argv = %q, want %q", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("argv[%d] = %q, want %q (agent must be one argv, no shell)", i, got[i], want[i])
		}
	}

	env, err := os.ReadFile(filepath.Join(home, "apm-env.txt"))
	if err != nil {
		t.Fatal(err)
	}
	envText := string(env)
	lines := strings.Split(strings.TrimRight(envText, "\n"), "\n")
	hasLinePrefix := func(prefix string) bool {
		for _, line := range lines {
			if strings.HasPrefix(line, prefix) {
				return true
			}
		}
		return false
	}
	for _, needle := range []string{"HOME=" + home, "APM_HOME=" + home, "PATH=", "LANG=C.UTF-8"} {
		if !hasLinePrefix(needle) {
			t.Fatalf("env missing %q: %s", needle, envText)
		}
	}
}

func TestReadInstalledNonZeroExit(t *testing.T) {
	fixture := writeFixture(t, "apm", "#!/bin/sh\nexit 1\n")
	_, err := ReadInstalled(context.Background(), apmConfig(fixture, t.TempDir()), "bibit")
	assertProviderError(t, err, "unavailable")
}

func TestReadInstalledENOENT(t *testing.T) {
	_, err := ReadInstalled(context.Background(), apmConfig("/nonexistent/apm", t.TempDir()), "bibit")
	assertProviderError(t, err, "unavailable")
}

func TestReadInstalledNoHome(t *testing.T) {
	_, err := ReadInstalled(context.Background(), apmConfig("/usr/bin/apm", ""), "bibit")
	assertProviderError(t, err, "unavailable")
}

func TestReadInstalledTimeout(t *testing.T) {
	fixture := writeFixture(t, "apm", "#!/bin/sh\nsleep 60\n")
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	_, err := ReadInstalled(ctx, apmConfig(fixture, t.TempDir()), "bibit")
	assertProviderError(t, err, "timeout")
}

func TestReadInstalledOverLimit(t *testing.T) {
	fixture := writeFixture(t, "apm", "#!/bin/sh\nhead -c 4194305 /dev/zero\n")
	_, err := ReadInstalled(context.Background(), apmConfig(fixture, t.TempDir()), "bibit")
	assertProviderError(t, err, "resource_exhausted")
}

func TestReadInstalledInvalidUTF8(t *testing.T) {
	fixture := writeFixture(t, "apm", "#!/bin/sh\nprintf '\\377'\n")
	_, err := ReadInstalled(context.Background(), apmConfig(fixture, t.TempDir()), "bibit")
	assertProviderError(t, err, "unavailable")
}

func assertProviderError(t *testing.T, err error, code string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected error, got nil")
	}
	pe, ok := err.(*ProviderError)
	if !ok {
		t.Fatalf("expected *ProviderError, got %T: %v", err, err)
	}
	if pe.Code != code {
		t.Fatalf("expected code %q, got %q", code, pe.Code)
	}
}
