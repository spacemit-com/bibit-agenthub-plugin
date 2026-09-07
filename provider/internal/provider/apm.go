package provider

import (
	"context"
	"errors"
	"io"
	"os/exec"
	"runtime"
	"unicode/utf8"
)

var (
	errOutputTooLarge = errors.New("output exceeds limit")
	errInvalidUTF8    = errors.New("output is not valid UTF-8")
)

// ReadInstalled runs `apm list --installed --agent=<agent> --json` and passes the
// raw stdout through on exit 0. It never parses the business JSON; the agent is a
// single argv (no shell). Start failure, non-zero exit, timeout, invalid UTF-8 and
// oversized output are mapped to safe platform errors.
func ReadInstalled(ctx context.Context, cfg Config, agent string) (WireResult, error) {
	env, err := APMEnvironment(cfg)
	if err != nil {
		return WireResult{}, err
	}
	output, err := runCommand(ctx, cfg.APMPath, env, "list", "--installed", "--agent="+agent, "--json")
	if err != nil {
		return WireResult{}, err
	}
	listJSON := string(output)
	return WireResult{Scope: "installed", Status: "data", ListJSON: &listJSON}, nil
}

// runCommand runs one absolute executable with an explicit environment and a
// controlled process group, returning its bounded, strict-UTF-8 stdout.
func runCommand(ctx context.Context, path string, env []string, argv ...string) ([]byte, error) {
	cmd := exec.Command(path, argv...)
	cmd.Env = env
	cmd.Stderr = io.Discard
	cmd.SysProcAttr = linuxSysProcAttr()

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, newProviderError("unavailable")
	}

	// Pdeathsig is tied to the thread that forks, so the whole start/wait
	// lifecycle runs on one pinned OS thread.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if err := cmd.Start(); err != nil {
		return nil, mapStartError(err)
	}

	stopCancel := make(chan struct{})
	defer close(stopCancel)
	go func() {
		select {
		case <-ctx.Done():
			killProcessGroup(cmd)
		case <-stopCancel:
		}
	}()

	data, readErr := readBoundedBytes(stdout, maxOutputBytes)
	if readErr != nil {
		killProcessGroup(cmd)
	}
	waitErr := cmd.Wait()

	if readErr != nil {
		return nil, mapReadError(readErr)
	}
	if waitErr != nil {
		return nil, mapWaitError(ctx, waitErr)
	}
	return data, nil
}

// readBoundedBytes reads at most limit bytes and rejects oversized or non-UTF-8
// output. It returns errOutputTooLarge / errInvalidUTF8 for those cases.
func readBoundedBytes(r io.Reader, limit int) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, int64(limit)+1))
	if err != nil {
		return nil, err
	}
	if len(data) > limit {
		return nil, errOutputTooLarge
	}
	if !utf8.Valid(data) {
		return nil, errInvalidUTF8
	}
	return data, nil
}

func mapReadError(err error) *ProviderError {
	switch err {
	case errOutputTooLarge:
		return newProviderError("resource_exhausted")
	case errInvalidUTF8:
		return newProviderError("unavailable")
	default:
		return newProviderError("unavailable")
	}
}

func mapStartError(err error) *ProviderError {
	// ENOENT (apm missing) and any other spawn failure are both unavailable.
	return newProviderError("unavailable")
}

func mapWaitError(ctx context.Context, err error) *ProviderError {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return newProviderError("timeout")
	}
	if ctx.Err() != nil {
		return newProviderError("cancelled")
	}
	// Non-zero exit (e.g. agent not installed) never fakes an empty list.
	return newProviderError("unavailable")
}
