package provider

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestHermesOperations(t *testing.T) {
	home := t.TempDir()
	fixture := writeFixture(t, "apm", "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$HOME/apm-argv.txt\"\nprintf '[]'\n")
	invoke := NewInvoker(apmConfig(fixture, home), nil)
	for _, tc := range []struct {
		operation string
		params    string
		argv      []string
	}{
		{operationPowersList, `{"scope":"installed","agent":"hermes-agent"}`, []string{"list", "--installed", "--agent=hermes-agent", "--json"}},
		{operationPowersInspect, `{"agent":"hermes-agent","type":"skill","name":"demo"}`, []string{"list", "demo", "--installed", "--json", "--agent=hermes-agent", "--type=skill"}},
		{operationPowersInstall, `{"agent":"hermes-agent","type":"plugin","name":"demo","version":"v1.0.0"}`, []string{"install", "demo=v1.0.0", "--agent=hermes-agent", "--type=plugin"}},
		{operationPowersUninstall, `{"agent":"hermes-agent","type":"mcp","name":"demo"}`, []string{"uninstall", "demo", "--agent=hermes-agent", "--type=mcp"}},
	} {
		t.Run(tc.operation, func(t *testing.T) {
			req, err := decodeOperationRequest(tc.operation, json.RawMessage(tc.params))
			if err != nil {
				t.Fatal(err)
			}
			if _, err := invoke(context.Background(), req); err != nil {
				t.Fatal(err)
			}
			assertArgv(t, home, tc.argv...)
		})
	}
	if err := validateTarget("hermes-agent", "expert", "demo"); err == nil || !strings.Contains(err.Error(), "only available for the bibit agent") {
		t.Fatalf("Hermes agent-type validation: %v", err)
	}
}

func readArgv(t *testing.T, home string) []string {
	t.Helper()
	argv, err := os.ReadFile(filepath.Join(home, "apm-argv.txt"))
	if err != nil {
		t.Fatalf("fixture did not record argv: %v", err)
	}
	return strings.Split(strings.TrimRight(string(argv), "\n"), "\n")
}

func assertArgv(t *testing.T, home string, want ...string) {
	t.Helper()
	got := readArgv(t, home)
	if len(got) != len(want) {
		t.Fatalf("argv = %q, want %q", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("argv[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestInspectPowerPassthrough(t *testing.T) {
	home := t.TempDir()
	script := "#!/bin/sh\n" +
		"printf '%s\\n' \"$@\" > \"$HOME/apm-argv.txt\"\n" +
		"cat <<'APMOUT'\n" + apmFixtureOutput + "APMOUT\n"
	fixture := writeFixture(t, "apm", script)

	result, err := InspectPower(context.Background(), apmConfig(fixture, home),
		PowerTarget{Agent: "bibit", Type: "skill", Name: "demo"})
	if err != nil {
		t.Fatal(err)
	}
	if result.ListJSON != apmFixtureOutput {
		t.Fatalf("raw text not preserved verbatim: %q", result.ListJSON)
	}
	assertArgv(t, home, "list", "demo", "--installed", "--json", "--agent=bibit", "--type=skill")
}

func TestInspectPowerNonZeroExit(t *testing.T) {
	fixture := writeFixture(t, "apm", "#!/bin/sh\nexit 1\n")
	_, err := InspectPower(context.Background(), apmConfig(fixture, t.TempDir()),
		PowerTarget{Agent: "bibit", Type: "skill", Name: "demo"})
	assertProviderError(t, err, "unavailable")
}

func TestInspectPowerNoHome(t *testing.T) {
	_, err := InspectPower(context.Background(), Config{APMPath: "/usr/bin/apm", UserHome: ""},
		PowerTarget{Agent: "bibit", Type: "skill", Name: "demo"})
	assertProviderError(t, err, "unavailable")
}

func TestMutatePowerInstallExitOneIsResult(t *testing.T) {
	home := t.TempDir()
	fixture := writeFixture(t, "apm", "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$HOME/apm-argv.txt\"\nexit 1\n")

	result, err := MutatePower(context.Background(), apmConfig(fixture, home), OperationRequest{
		OperationID: operationPowersInstall,
		Install: &InstallInput{
			PowerTarget: PowerTarget{Agent: "bibit", Type: "skill", Name: "demo"},
			Version:     "v1.0.0",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "exited" || result.ExitCode != 1 {
		t.Fatalf("unexpected result: %+v", result)
	}
	assertArgv(t, home, "install", "demo=v1.0.0", "--agent=bibit", "--type=skill")
}

func TestMutatePowerUninstallExitZero(t *testing.T) {
	home := t.TempDir()
	fixture := writeFixture(t, "apm", "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$HOME/apm-argv.txt\"\nexit 0\n")

	result, err := MutatePower(context.Background(), apmConfig(fixture, home), OperationRequest{
		OperationID: operationPowersUninstall,
		Target:      &PowerTarget{Agent: "codex", Type: "plugin", Name: "demo-plugin"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "exited" || result.ExitCode != 0 {
		t.Fatalf("unexpected result: %+v", result)
	}
	assertArgv(t, home, "uninstall", "demo-plugin", "--agent=codex", "--type=plugin")
}

func TestMutatePowerLargeOutputDiscarded(t *testing.T) {
	// 10 MiB of stdout must not block or be captured: it is discarded and the
	// normal non-zero exit code is still reported.
	fixture := writeFixture(t, "apm", "#!/bin/sh\nhead -c 10485760 /dev/zero\nexit 3\n")

	result, err := MutatePower(context.Background(), apmConfig(fixture, t.TempDir()), OperationRequest{
		OperationID: operationPowersInstall,
		Install: &InstallInput{
			PowerTarget: PowerTarget{Agent: "bibit", Type: "skill", Name: "demo"},
			Version:     "v1.0.0",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "exited" || result.ExitCode != 3 {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestMutatePowerNoHome(t *testing.T) {
	_, err := MutatePower(context.Background(), Config{APMPath: "/usr/bin/apm", UserHome: ""}, OperationRequest{
		OperationID: operationPowersInstall,
		Install:     &InstallInput{PowerTarget: PowerTarget{Agent: "bibit", Type: "skill", Name: "demo"}, Version: "v1.0.0"},
	})
	assertProviderError(t, err, "unavailable")
}

func TestMutatePowerENOENT(t *testing.T) {
	_, err := MutatePower(context.Background(), apmConfig("/nonexistent/apm", t.TempDir()), OperationRequest{
		OperationID: operationPowersInstall,
		Install:     &InstallInput{PowerTarget: PowerTarget{Agent: "bibit", Type: "skill", Name: "demo"}, Version: "v1.0.0"},
	})
	assertProviderError(t, err, "unavailable")
}

func TestMutatePowerSignalTermination(t *testing.T) {
	fixture := writeFixture(t, "apm", "#!/bin/sh\nkill -TERM $$\n")
	_, err := MutatePower(context.Background(), apmConfig(fixture, t.TempDir()), OperationRequest{
		OperationID: operationPowersUninstall,
		Target:      &PowerTarget{Agent: "bibit", Type: "skill", Name: "demo"},
	})
	assertProviderError(t, err, "unavailable")
}

func TestMutatePowerTimeout(t *testing.T) {
	// The 1000 ms cleanup reserve leaves a 200 ms child budget from a 1200 ms
	// deadline, so the sleeping fixture is killed and maps to timeout.
	fixture := writeFixture(t, "apm", "#!/bin/sh\nsleep 60\n")
	ctx, cancel := context.WithTimeout(context.Background(), 1200*time.Millisecond)
	defer cancel()
	_, err := MutatePower(ctx, apmConfig(fixture, t.TempDir()), OperationRequest{
		OperationID: operationPowersInstall,
		Install:     &InstallInput{PowerTarget: PowerTarget{Agent: "bibit", Type: "skill", Name: "demo"}, Version: "v1.0.0"},
	})
	assertProviderError(t, err, "timeout")
}

func TestMutatePowerShortDeadlineDoesNotSpawn(t *testing.T) {
	home := t.TempDir()
	fixture := writeFixture(t, "apm", "#!/bin/sh\nprintf ran > \"$HOME/apm-ran.txt\"\n")
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	_, err := MutatePower(ctx, apmConfig(fixture, home), OperationRequest{
		OperationID: operationPowersInstall,
		Install:     &InstallInput{PowerTarget: PowerTarget{Agent: "bibit", Type: "skill", Name: "demo"}, Version: "v1.0.0"},
	})
	assertProviderError(t, err, "timeout")
	if _, statErr := os.Stat(filepath.Join(home, "apm-ran.txt")); statErr == nil {
		t.Fatal("fixture ran despite insufficient budget")
	}
}

func TestMutatePowerInconsistentRequest(t *testing.T) {
	_, err := MutatePower(context.Background(), apmConfig("/usr/bin/apm", t.TempDir()), OperationRequest{
		OperationID: operationPowersInstall,
		Target:      &PowerTarget{Agent: "bibit", Type: "skill", Name: "demo"},
	})
	assertProviderError(t, err, "incompatible")
}

// --- powers.upgrade.v1 -----------------------------------------------------

func TestUpgradeArgvCarriesYesAndJSON(t *testing.T) {
	home := t.TempDir()
	// Both flags are load-bearing, so the argv is asserted exactly: without
	// `--yes` apm fails closed on a non-terminal stdin, and without `--json`
	// there are no per-item outcomes to summarize.
	fixture := writeFixture(t, "apm", "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$HOME/apm-argv.txt\"\nprintf '[]'\n")

	result, err := UpgradePowers(context.Background(), apmConfig(fixture, home), OperationRequest{
		OperationID: operationPowersUpgrade,
		Upgrade:     &UpgradeInput{Agent: "bibit"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "exited" || result.ExitCode != 0 {
		t.Fatalf("unexpected result: %+v", result)
	}
	assertArgv(t, home, "upgrade", "--agent=bibit", "--yes", "--json")
}

func TestUpgradeAcceptsAllAndFixedAgents(t *testing.T) {
	for _, agent := range []string{"all", "bibit", "codex", "claude-code", "hermes-agent"} {
		t.Run(agent, func(t *testing.T) {
			req, err := decodeOperationRequest(operationPowersUpgrade, json.RawMessage(`{"agent":"`+agent+`"}`))
			if err != nil {
				t.Fatalf("agent %q must be accepted: %v", agent, err)
			}
			if req.Upgrade == nil || req.Upgrade.Agent != agent {
				t.Fatalf("decoded request = %+v", req)
			}
		})
	}
}

func TestUpgradeRejectsUnknownAgentAndExtraKeys(t *testing.T) {
	for name, params := range map[string]string{
		"unknown agent": `{"agent":"nope"}`,
		"empty agent":   `{"agent":""}`,
		"extra key":     `{"agent":"bibit","type":"skill"}`,
		"missing agent": `{}`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := decodeOperationRequest(operationPowersUpgrade, json.RawMessage(params)); err == nil {
				t.Fatalf("expected %s to be rejected", params)
			}
		})
	}
}

func TestUpgradeParsesItemsFromJSON(t *testing.T) {
	home := t.TempDir()
	payload := `[{"agent":"bibit","type":"skill","name":"demo","current_version":"v1.0.0","target_version":"v2.0.0","outcome":"upgraded","skip":""},` +
		`{"agent":"bibit","type":"mcp","name":"gone","current_version":"v1.0.0","target_version":"","outcome":"skipped","skip":"not-in-catalog"}]`
	fixture := writeFixture(t, "apm", "#!/bin/sh\ncat <<'JSON'\n"+payload+"\nJSON\n")

	result, err := UpgradePowers(context.Background(), apmConfig(fixture, home), OperationRequest{
		OperationID: operationPowersUpgrade,
		Upgrade:     &UpgradeInput{Agent: "all"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 2 {
		t.Fatalf("items = %+v", result.Items)
	}
	// apm's snake_case becomes the wire's camelCase.
	if result.Items[0].CurrentVersion != "v1.0.0" || result.Items[0].TargetVersion != "v2.0.0" {
		t.Fatalf("versions not carried through: %+v", result.Items[0])
	}
	if result.Items[0].Outcome != "upgraded" {
		t.Fatalf("outcome = %q", result.Items[0].Outcome)
	}
	if result.Items[1].Skip != "not-in-catalog" || result.Items[1].Outcome != "skipped" {
		t.Fatalf("skip not carried through: %+v", result.Items[1])
	}
	if result.Reason != "" {
		t.Fatalf("a parsed result must carry no reason, got %q", result.Reason)
	}
}

func TestUpgradeKeepsItemsOnBatchFailure(t *testing.T) {
	// apm renders the complete result to stdout and *then* exits non-zero when
	// some entries failed. Discarding the output on a non-zero exit would throw
	// away the only account of what actually happened.
	home := t.TempDir()
	payload := `[{"agent":"bibit","type":"skill","name":"demo","current_version":"v1.0.0","target_version":"v2.0.0","outcome":"failed"}]`
	fixture := writeFixture(t, "apm", "#!/bin/sh\ncat <<'JSON'\n"+payload+"\nJSON\nexit 1\n")

	result, err := UpgradePowers(context.Background(), apmConfig(fixture, home), OperationRequest{
		OperationID: operationPowersUpgrade,
		Upgrade:     &UpgradeInput{Agent: "bibit"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.ExitCode != 1 {
		t.Fatalf("exit code = %d, want 1", result.ExitCode)
	}
	if len(result.Items) != 1 || result.Items[0].Outcome != "failed" {
		t.Fatalf("items must survive a failing batch: %+v", result.Items)
	}
}

func TestUpgradeReportsSanitizedReasonWhenStdoutIsUnusable(t *testing.T) {
	// An occupied lock, or an apm predating these flags, produces no JSON at all.
	// The user then needs the reason, and it must be the sanitized single-line
	// form: no raw multi-line stderr, no ANSI escapes.
	home := t.TempDir()
	fixture := writeFixture(t, "apm",
		"#!/bin/sh\nprintf '\\033[31mAPM lock is already held\\033[0m\\nsecond line\\n' >&2\nexit 1\n")

	result, err := UpgradePowers(context.Background(), apmConfig(fixture, home), OperationRequest{
		OperationID: operationPowersUpgrade,
		Upgrade:     &UpgradeInput{Agent: "bibit"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.ExitCode != 1 {
		t.Fatalf("exit code = %d, want 1", result.ExitCode)
	}
	if len(result.Items) != 0 {
		t.Fatalf("no items expected, got %+v", result.Items)
	}
	if !strings.Contains(result.Reason, "APM lock is already held") {
		t.Fatalf("reason must explain the failure: %q", result.Reason)
	}
	if strings.Contains(result.Reason, "\x1b") || strings.Contains(result.Reason, "[31m") {
		t.Fatalf("reason leaked an ANSI escape: %q", result.Reason)
	}
	if strings.Contains(result.Reason, "\n") {
		t.Fatalf("reason must be a single line: %q", result.Reason)
	}
}

func TestUpgradeUnknownOutcomeIsPreserved(t *testing.T) {
	// A future apm may add an outcome. Pass it through rather than failing the
	// whole response: the frontend classifies what it does not know.
	home := t.TempDir()
	payload := `[{"agent":"bibit","type":"skill","name":"demo","current_version":"v1.0.0","target_version":"v2.0.0","outcome":"reinstalled"}]`
	fixture := writeFixture(t, "apm", "#!/bin/sh\ncat <<'JSON'\n"+payload+"\nJSON\n")

	result, err := UpgradePowers(context.Background(), apmConfig(fixture, home), OperationRequest{
		OperationID: operationPowersUpgrade,
		Upgrade:     &UpgradeInput{Agent: "bibit"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 1 || result.Items[0].Outcome != "reinstalled" {
		t.Fatalf("unknown outcome must survive: %+v", result.Items)
	}
}

func TestUpgradeTimeoutIsPlatformError(t *testing.T) {
	home := t.TempDir()
	fixture := writeFixture(t, "apm", "#!/bin/sh\nsleep 30\n")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, err := UpgradePowers(ctx, apmConfig(fixture, home), OperationRequest{
		OperationID: operationPowersUpgrade,
		Upgrade:     &UpgradeInput{Agent: "all"},
	})
	assertProviderError(t, err, "timeout")
}

func TestUpgradeShortDeadlineDoesNotSpawn(t *testing.T) {
	home := t.TempDir()
	fixture := writeFixture(t, "apm", "#!/bin/sh\nprintf ran > \"$HOME/apm-ran.txt\"\n")
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	_, err := UpgradePowers(ctx, apmConfig(fixture, home), OperationRequest{
		OperationID: operationPowersUpgrade,
		Upgrade:     &UpgradeInput{Agent: "all"},
	})
	assertProviderError(t, err, "timeout")
	if _, statErr := os.Stat(filepath.Join(home, "apm-ran.txt")); statErr == nil {
		t.Fatal("fixture ran despite insufficient budget")
	}
}

func TestUpgradeInconsistentRequest(t *testing.T) {
	_, err := UpgradePowers(context.Background(), apmConfig("/usr/bin/apm", t.TempDir()), OperationRequest{
		OperationID: operationPowersUpgrade,
	})
	assertProviderError(t, err, "incompatible")
}
