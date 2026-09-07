package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"bibit-agenthub-provider/internal/provider"
)

func main() {
	args := os.Args[1:]
	if len(args) == 1 && args[0] == "--self-test" {
		// Self-test is wired in a later task; never report a false pass.
		fmt.Fprintln(os.Stderr, "self-test: not implemented")
		os.Exit(1)
	}
	if len(args) == 1 && args[0] == "provider" {
		runProvider()
		return
	}
	fmt.Fprintln(os.Stderr, "usage: bibit-agenthub provider | bibit-agenthub --self-test")
	os.Exit(2)
}

func runProvider() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Data sources (APM/APC) are wired in a later task; passing nil invoke makes
	// any powers.list.v1 invoke fail with a safe unavailable error.
	if err := provider.Serve(ctx, os.Stdin, os.Stdout, nil); err != nil && ctx.Err() == nil {
		fmt.Fprintln(os.Stderr, "provider:", err)
		os.Exit(1)
	}
}
