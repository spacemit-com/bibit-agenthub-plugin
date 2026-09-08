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
// controlled process group, returning its bounded, strict-UTF-8 stdout. The read
// runner still requires exit 0: a non-zero exit is mapped to unavailable.
func runCommand(ctx context.Context, path string, env []string, argv ...string) ([]byte, error) {
	data, exitCode, err := runProcess(ctx, path, env, true, argv...)
	if err != nil {
		return nil, err
	}
	if exitCode != 0 {
		return nil, newProviderError("unavailable")
	}
	return data, nil
}

// runMutation runs one write command with stdout/stderr discarded and returns
// the observed exit code for a normally-exited process. Signal termination,
// timeout and start failure surface as platform errors via classifyExit.
func runMutation(ctx context.Context, path string, env []string, argv ...string) (int, error) {
	_, exitCode, err := runProcess(ctx, path, env, false, argv...)
	return exitCode, err
}

// runProcess is the shared process lifecycle: one absolute executable, explicit
// environment, own process group and Pdeathsig, with the whole start/wait
// lifecycle on one pinned OS thread so Pdeathsig stays armed for the child's
// entire lifetime. When captureStdout is true it collects bounded strict-UTF-8
// stdout; otherwise stdout is discarded. It returns the collected stdout and the
// process outcome.
func runProcess(ctx context.Context, path string, env []string, captureStdout bool, argv ...string) ([]byte, int, error) {
	cmd := exec.Command(path, argv...)
	cmd.Env = env
	cmd.Stderr = io.Discard
	cmd.SysProcAttr = linuxSysProcAttr()

	var stdout io.ReadCloser
	if captureStdout {
		pipe, err := cmd.StdoutPipe()
		if err != nil {
			return nil, -1, newProviderError("unavailable")
		}
		stdout = pipe
	} else {
		cmd.Stdout = io.Discard
	}

	// Pdeathsig is tied to the thread that forks, so the whole start/wait
	// lifecycle runs on one pinned OS thread.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if err := cmd.Start(); err != nil {
		return nil, -1, mapStartError(err)
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

	var data []byte
	var readErr error
	if captureStdout {
		data, readErr = readBoundedBytes(stdout, maxOutputBytes)
		if readErr != nil {
			killProcessGroup(cmd)
		}
	}
	waitErr := cmd.Wait()

	if readErr != nil {
		return nil, -1, mapReadError(readErr)
	}
	exitCode, err := classifyExit(ctx, waitErr)
	return data, exitCode, err
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

// classifyExit maps the observed process outcome to an exit code plus error.
// Timeout and cancellation take priority; a signal termination or unknown wait
// failure maps to unavailable; a normal exit (zero or non-zero) returns its code
// with no error so write operations can report it as a result.
func classifyExit(ctx context.Context, waitErr error) (int, error) {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return -1, newProviderError("timeout")
	}
	if ctx.Err() != nil {
		return -1, newProviderError("cancelled")
	}
	if waitErr == nil {
		return 0, nil
	}
	var exitErr *exec.ExitError
	if errors.As(waitErr, &exitErr) {
		code := exitErr.ExitCode()
		if code < 0 {
			return -1, newProviderError("unavailable")
		}
		return code, nil
	}
	return -1, newProviderError("unavailable")
}
