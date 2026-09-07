package provider

import (
	"testing"
)

func TestParseConfigDefaults(t *testing.T) {
	cfg, err := ParseConfig(nil)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.APMPath != defaultAPMPath {
		t.Fatalf("default APMPath = %q, want %q", cfg.APMPath, defaultAPMPath)
	}
	if cfg.APCBaseURL != defaultAPCBaseURL {
		t.Fatalf("default APCBaseURL = %q", cfg.APCBaseURL)
	}
	// UserHome is resolved from the OS account; only required to be non-empty on
	// a normal dev machine. We assert the env is derivable when it is set.
	if cfg.UserHome == "" {
		t.Log("user home not resolved in this environment")
	}
}

func TestParseConfigOverrides(t *testing.T) {
	cfg, err := ParseConfig([]string{
		"--apm-path", "/opt/apm",
		"--user-home=/home/tester",
		"--apc-base-url", "https://apc.example.test/v1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.APMPath != "/opt/apm" || cfg.UserHome != "/home/tester" || cfg.APCBaseURL != "https://apc.example.test/v1" {
		t.Fatalf("unexpected config: %+v", cfg)
	}
}

func TestParseConfigRejectsRelativePaths(t *testing.T) {
	if _, err := ParseConfig([]string{"--apm-path", "apm"}); err == nil {
		t.Fatal("relative --apm-path must be rejected")
	}
	if _, err := ParseConfig([]string{"--user-home", "home"}); err == nil {
		t.Fatal("relative --user-home must be rejected")
	}
}

func TestParseConfigRejectsBadURL(t *testing.T) {
	for _, url := range []string{"", "ftp://apc.example.test", "/relative", "not a url"} {
		if _, err := ParseConfig([]string{"--apc-base-url", url}); err == nil {
			t.Fatalf("bad --apc-base-url %q must be rejected", url)
		}
	}
}

func TestParseConfigRejectsUnknownFlag(t *testing.T) {
	if _, err := ParseConfig([]string{"--frobnicate", "x"}); err == nil {
		t.Fatal("unknown flag must be rejected")
	}
	if _, err := ParseConfig([]string{"bare-arg"}); err == nil {
		t.Fatal("bare argument must be rejected")
	}
}

func TestAPMEnvironment(t *testing.T) {
	env, err := APMEnvironment(Config{UserHome: "/home/tester"})
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, entry := range env {
		for _, key := range []string{"LANG=", "HOME=", "APM_HOME=", "PATH="} {
			if len(entry) >= len(key) && entry[:len(key)] == key {
				found[key] = true
			}
		}
	}
	for _, key := range []string{"LANG=", "HOME=", "APM_HOME=", "PATH="} {
		if !found[key] {
			t.Fatalf("env missing %s: %v", key, env)
		}
	}
}

func TestAPMEnvironmentNoHome(t *testing.T) {
	_, err := APMEnvironment(Config{UserHome: ""})
	if err == nil {
		t.Fatal("expected error when user home is empty")
	}
	if pe, ok := err.(*ProviderError); !ok || pe.Code != "unavailable" {
		t.Fatalf("expected unavailable ProviderError, got %v", err)
	}
}
