package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func buildProvider(t *testing.T) string {
	t.Helper()
	root := findModuleRoot(t)
	bin := filepath.Join(t.TempDir(), "bibit-agenthub")
	build := exec.Command("go", "build", "-o", bin, "./cmd/bibit-agenthub")
	build.Dir = root
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("go build failed: %v\n%s", err, out)
	}
	return bin
}

func findModuleRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("no go.mod found")
		}
		dir = parent
	}
}

func writeScript(t *testing.T, name, script string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestProbeInstalledOK(t *testing.T) {
	bin := buildProvider(t)
	home := t.TempDir()
	apm := writeScript(t, "apm", "#!/bin/sh\nprintf '[]'\n")

	report, err := runProbe(probeFlags{executable: bin, scope: "installed", agent: "bibit", apmPath: apm, userHome: home})
	if err != nil {
		t.Fatal(err)
	}
	if report.ProtocolVersion != 1 {
		t.Fatalf("protocolVersion = %d, want 1", report.ProtocolVersion)
	}
	if report.Status != "data" {
		t.Fatalf("status = %q, want data", report.Status)
	}
	if report.RawBytes != 2 {
		t.Fatalf("rawBytes = %d, want 2 (len of [])", report.RawBytes)
	}
	if report.Snapshot != "" {
		t.Fatalf("installed must omit snapshot, got %q", report.Snapshot)
	}
	if report.RPCBytes <= 0 || report.RPCBytes > maxRPCBytes {
		t.Fatalf("rpcBytes = %d out of range", report.RPCBytes)
	}
	if report.RemainingBytes != maxRPCBytes-report.RPCBytes {
		t.Fatalf("remainingBytes = %d, want %d", report.RemainingBytes, maxRPCBytes-report.RPCBytes)
	}
}

func TestProbeMarketAndNotModified(t *testing.T) {
	bin := buildProvider(t)
	var versionCalls, catalogCalls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/resources/version":
			versionCalls++
			fmt.Fprint(w, `{"catalog_sha256":"probe-sha"}`)
		case "/resources":
			catalogCalls++
			fmt.Fprint(w, `{"skills":{"items":[]}}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	data, err := runProbe(probeFlags{executable: bin, scope: "market", apcBaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	if data.Status != "data" || data.Snapshot != "probe-sha" {
		t.Fatalf("unexpected data report: %+v", data)
	}
	if data.RawBytes != len(`{"skills":{"items":[]}}`) {
		t.Fatalf("rawBytes = %d", data.RawBytes)
	}

	unchanged, err := runProbe(probeFlags{executable: bin, scope: "market", knownSnapshot: "probe-sha", apcBaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	if unchanged.Status != "not_modified" || unchanged.Snapshot != "probe-sha" {
		t.Fatalf("unexpected not_modified report: %+v", unchanged)
	}
	if unchanged.RawBytes != 0 {
		t.Fatalf("not_modified rawBytes = %d, want 0", unchanged.RawBytes)
	}
	if versionCalls != 2 || catalogCalls != 1 {
		t.Fatalf("expected 2 version + 1 catalog calls, got %d/%d", versionCalls, catalogCalls)
	}
}

func TestProbeExeFailure(t *testing.T) {
	exe := writeScript(t, "provider", "#!/bin/sh\nexit 1\n")
	if _, err := runProbe(probeFlags{executable: exe, scope: "market"}); err == nil {
		t.Fatal("expected error for failing executable")
	}
}

func TestProbeIllegalLine(t *testing.T) {
	exe := writeScript(t, "provider", "#!/bin/sh\necho garbage\n")
	if _, err := runProbe(probeFlags{executable: exe, scope: "market"}); err == nil {
		t.Fatal("expected error for illegal response line")
	}
}

func TestProbeOverLongLine(t *testing.T) {
	exe := writeScript(t, "provider", "#!/bin/sh\nhead -c 4194305 /dev/zero; echo\n")
	if _, err := runProbe(probeFlags{executable: exe, scope: "market"}); err == nil {
		t.Fatal("expected error for over-long response line")
	}
}

func TestParseFlagsRequiresExecutableAndScope(t *testing.T) {
	if _, err := parseFlags(nil); err == nil {
		t.Fatal("missing --executable must be rejected")
	}
	if _, err := parseFlags([]string{"--executable", "x", "--scope", "bogus"}); err == nil {
		t.Fatal("invalid scope must be rejected")
	}
}

func TestProbeInspectOK(t *testing.T) {
	bin := buildProvider(t)
	home := t.TempDir()
	apm := writeScript(t, "apm", "#!/bin/sh\nprintf '[]'\n")

	report, err := runProbe(probeFlags{
		executable: bin, operation: "powers.inspect.v1", agent: "bibit",
		name: "demo", powerType: "skill", apmPath: apm, userHome: home,
	})
	if err != nil {
		t.Fatal(err)
	}
	if report.Operation != "powers.inspect.v1" {
		t.Fatalf("operation = %q", report.Operation)
	}
	if report.Status != "data" || report.RawBytes != 2 {
		t.Fatalf("unexpected inspect report: %+v", report)
	}
	if report.ExitCode != nil {
		t.Fatalf("inspect must not carry an exit code: %+v", report)
	}
}

func TestProbeUninstallExitZero(t *testing.T) {
	bin := buildProvider(t)
	home := t.TempDir()
	apm := writeScript(t, "apm", "#!/bin/sh\nexit 0\n")

	report, err := runProbe(probeFlags{
		executable: bin, operation: "powers.uninstall.v1", agent: "bibit",
		name: "demo", powerType: "skill", apmPath: apm, userHome: home,
	})
	if err != nil {
		t.Fatal(err)
	}
	if report.Status != "exited" || report.ExitCode == nil || *report.ExitCode != 0 {
		t.Fatalf("unexpected uninstall report: %+v", report)
	}
}

func TestProbeInstallExitOneIsResult(t *testing.T) {
	bin := buildProvider(t)
	home := t.TempDir()
	apm := writeScript(t, "apm", "#!/bin/sh\nexit 1\n")

	report, err := runProbe(probeFlags{
		executable: bin, operation: "powers.install.v1", agent: "bibit",
		name: "demo", powerType: "skill", version: "v1.0.0", apmPath: apm, userHome: home,
	})
	if err != nil {
		t.Fatal(err)
	}
	if report.Status != "exited" || report.ExitCode == nil || *report.ExitCode != 1 {
		t.Fatalf("unexpected install report: %+v", report)
	}
}

func TestParseFlagsRequiresOperationFields(t *testing.T) {
	if _, err := parseFlags([]string{"--executable", "x", "--operation", "powers.inspect.v1"}); err == nil {
		t.Fatal("inspect without --name/--type must be rejected")
	}
	if _, err := parseFlags([]string{"--executable", "x", "--operation", "powers.install.v1", "--name", "demo", "--type", "skill"}); err == nil {
		t.Fatal("install without --version must be rejected")
	}
	if _, err := parseFlags([]string{"--executable", "x", "--operation", "bogus.op"}); err == nil {
		t.Fatal("unknown operation must be rejected")
	}
}
