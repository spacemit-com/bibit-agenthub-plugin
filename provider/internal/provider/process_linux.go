//go:build linux

package provider

import (
	"os/exec"
	"syscall"
)

// linuxSysProcAttr puts each spawned data-source process in its own process
// group and arms Pdeathsig so an orphaned child is killed if the provider dies.
func linuxSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setpgid: true, Pdeathsig: syscall.SIGKILL}
}

// killProcessGroup kills the whole process group so grandchildren cannot survive
// a cancelled or orphaned APM process.
func killProcessGroup(cmd *exec.Cmd) {
	if cmd.Process != nil {
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
}
