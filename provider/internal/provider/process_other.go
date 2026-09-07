//go:build !linux

package provider

import (
	"os/exec"
	"syscall"
)

// linuxSysProcAttr is a no-op on non-Linux platforms; process-group and
// Pdeathsig semantics are Linux-only.
func linuxSysProcAttr() *syscall.SysProcAttr {
	return nil
}

func killProcessGroup(cmd *exec.Cmd) {
	if cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}
