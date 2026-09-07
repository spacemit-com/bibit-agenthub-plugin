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
	if len(args) >= 1 && args[0] == "provider" {
		runProvider(args[1:])
		return
	}
	fmt.Fprintln(os.Stderr, "usage: bibit-agenthub provider [flags] | bibit-agenthub --self-test")
	os.Exit(2)
}

func runProvider(providerArgs []string) {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	cfg, err := provider.ParseConfig(providerArgs)
	if err != nil {
		fmt.Fprintln(os.Stderr, "provider:", err)
		os.Exit(2)
	}
	invoker := provider.NewInvoker(cfg, provider.NewHTTPClient())
	if err := provider.Serve(ctx, os.Stdin, os.Stdout, invoker); err != nil && ctx.Err() == nil {
		fmt.Fprintln(os.Stderr, "provider:", err)
		os.Exit(1)
	}
}
