//go:build linux

package provider

import (
	"bufio"
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// TestOrphanAPMProcessDiesWithProvider verifies the Pdeathsig wiring end-to-end:
// when the provider process is SIGKILLed mid-invoke, the apm fixture process must
// die with it rather than surviving as an orphan.
func TestOrphanAPMProcessDiesWithProvider(t *testing.T) {
	bin := buildProviderBinary(t)

	home := t.TempDir()
	fixture := writeFixture(t, "apm", "#!/bin/sh\necho $$ > \"$HOME/apm-pid.txt\"\nexec sleep 60\n")

	cmd := exec.Command(bin, "provider", "--apm-path", fixture, "--user-home", home)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()

	reader := bufio.NewReader(stdout)
	if _, err := fmt.Fprint(stdin, initRequest); err != nil {
		t.Fatal(err)
	}
	if _, err := reader.ReadString('\n'); err != nil {
		t.Fatalf("initialize: %v (stderr: %s)", err, stderr.String())
	}

	if _, err := fmt.Fprint(stdin, "{\"jsonrpc\":\"2.0\",\"id\":\"req\",\"method\":\"bibit.invoke\",\"params\":{\"serviceId\":\"store\",\"operationId\":\"powers.list.v1\",\"params\":{\"scope\":\"installed\",\"agent\":\"bibit\"},\"timeoutMs\":30000}}\n"); err != nil {
		t.Fatal(err)
	}

	pid := waitForFixturePID(t, home)
	if pid <= 0 {
		t.Fatal("fixture pid never recorded")
	}

	// Kill the whole provider process; Pdeathsig must reap the fixture.
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = cmd.Wait()

	waitForProcessGone(t, pid)
}

func buildProviderBinary(t *testing.T) string {
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

func waitForFixturePID(t *testing.T, home string) int {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(filepath.Join(home, "apm-pid.txt"))
		if err == nil {
			if pid, err := strconv.Atoi(strings.TrimSpace(string(data))); err == nil && pid > 0 {
				return pid
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	return 0
}

func waitForProcessGone(t *testing.T, pid int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if processGone(pid) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("orphan apm process %d survived provider death", pid)
}

// processGone reports whether a PID no longer represents a running process. A
// zombie counts as gone (the process is dead, awaiting reaping by init).
func processGone(pid int) bool {
	if err := syscall.Kill(pid, 0); err == syscall.ESRCH {
		return true
	}
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return true
	}
	closeParen := strings.LastIndexByte(string(data), ')')
	if closeParen == -1 || closeParen+2 >= len(data) {
		return false
	}
	return data[closeParen+2] == 'Z'
}
