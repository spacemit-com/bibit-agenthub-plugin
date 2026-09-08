package provider

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"
)

const (
	operationPowersInspect   = "powers.inspect.v1"
	operationPowersInstall   = "powers.install.v1"
	operationPowersUninstall = "powers.uninstall.v1"

	// writeCleanupReserve is the portion of a write request's deadline held back
	// so the provider can clean up the child process and return the result. When
	// the remaining budget is at or below this, the subprocess is not started.
	writeCleanupReserve = 1000 * time.Millisecond
)

var (
	installedAgents = map[string]bool{"bibit": true, "codex": true, "claude-code": true}
	powerTypes      = map[string]bool{"skill": true, "plugin": true, "mcp": true, "agent": true}
	canonicalVersionRE = regexp.MustCompile(`^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`)
)

// isCanonicalPowerName mirrors apm's public `IsCanonicalPowerName`: 1-64 bytes
// of lowercase kebab case where hyphens only separate non-empty alphanumeric
// segments. This naturally rejects option injection, paths and separators.
func isCanonicalPowerName(name string) bool {
	if len(name) < 1 || len(name) > 64 || name[0] == '-' || name[len(name)-1] == '-' || strings.Contains(name, "--") {
		return false
	}
	for i := 0; i < len(name); i++ {
		c := name[i]
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' {
			continue
		}
		return false
	}
	return true
}

func validateTarget(agent, typ, name string) error {
	if !installedAgents[agent] {
		return errors.New("operation input: agent must be a fixed installed agent")
	}
	if !powerTypes[typ] {
		return errors.New("operation input: type must be skill, plugin, mcp or agent")
	}
	if !isCanonicalPowerName(name) {
		return errors.New("operation input: name must be a canonical lowercase kebab power name")
	}
	if typ == "agent" && agent != "bibit" {
		return errors.New("operation input: type=agent is only available for the bibit agent")
	}
	return nil
}

// decodePowerTarget strictly decodes and validates a {agent,type,name} object
// for inspect and uninstall, rejecting extra keys and invalid fields.
func decodePowerTarget(raw json.RawMessage) (PowerTarget, error) {
	obj, err := decodeObject(raw)
	if err != nil {
		return PowerTarget{}, err
	}
	if err := rejectKeys(obj, "agent", "type", "name"); err != nil {
		return PowerTarget{}, err
	}
	agent, ok := parseString(obj["agent"])
	if !ok || agent == "" {
		return PowerTarget{}, errors.New("operation input: agent must be a non-empty string")
	}
	typ, ok := parseString(obj["type"])
	if !ok {
		return PowerTarget{}, errors.New("operation input: type must be a string")
	}
	name, ok := parseString(obj["name"])
	if !ok {
		return PowerTarget{}, errors.New("operation input: name must be a string")
	}
	if err := validateTarget(agent, typ, name); err != nil {
		return PowerTarget{}, err
	}
	return PowerTarget{Agent: agent, Type: typ, Name: name}, nil
}

// decodeInstallInput strictly decodes and validates a {agent,type,name,version}
// object for install.
func decodeInstallInput(raw json.RawMessage) (InstallInput, error) {
	obj, err := decodeObject(raw)
	if err != nil {
		return InstallInput{}, err
	}
	if err := rejectKeys(obj, "agent", "type", "name", "version"); err != nil {
		return InstallInput{}, err
	}
	target, err := decodePowerTarget(jsonFor(obj, "agent", "type", "name"))
	if err != nil {
		return InstallInput{}, err
	}
	version, ok := parseString(obj["version"])
	if !ok || !canonicalVersionRE.MatchString(version) {
		return InstallInput{}, errors.New("operation input: version must be a canonical vMAJOR.MINOR.PATCH string")
	}
	return InstallInput{PowerTarget: target, Version: version}, nil
}

// jsonFor re-marshals a subset of an already-decoded object's fields back into a
// raw message so decodePowerTarget can reuse its validation without duplicating
// it. This is only used internally after rejectKeys has already closed the key
// set, so the re-marshal cannot fail.
func jsonFor(obj map[string]json.RawMessage, keys ...string) json.RawMessage {
	subset := make(map[string]json.RawMessage, len(keys))
	for _, key := range keys {
		if raw, ok := obj[key]; ok {
			subset[key] = raw
		}
	}
	encoded, _ := json.Marshal(subset)
	return encoded
}

// InspectPower runs `apm list <name> --installed --json --agent=<agent>
// --type=<type>` and returns the raw stdout on exit 0. It never parses the
// business JSON.
func InspectPower(ctx context.Context, cfg Config, target PowerTarget) (InspectResult, error) {
	env, err := APMEnvironment(cfg)
	if err != nil {
		return InspectResult{}, err
	}
	output, err := runCommand(ctx, cfg.APMPath, env,
		"list", target.Name, "--installed", "--json", "--agent="+target.Agent, "--type="+target.Type)
	if err != nil {
		return InspectResult{}, err
	}
	return InspectResult{ListJSON: string(output)}, nil
}

// MutatePower runs the install/uninstall command and reports the observed exit
// code. A normal non-zero exit is a result; signal termination, timeout and
// start failure are platform errors. stdout/stderr are discarded.
func MutatePower(ctx context.Context, cfg Config, req OperationRequest) (MutationResult, error) {
	argv, err := mutationArgv(req)
	if err != nil {
		return MutationResult{}, err
	}
	env, err := APMEnvironment(cfg)
	if err != nil {
		return MutationResult{}, err
	}
	childCtx, cancel, err := writeChildContext(ctx)
	if err != nil {
		return MutationResult{}, err
	}
	defer cancel()
	exitCode, err := runMutation(childCtx, cfg.APMPath, env, argv...)
	if err != nil {
		return MutationResult{}, err
	}
	return MutationResult{Status: "exited", ExitCode: exitCode}, nil
}

func mutationArgv(req OperationRequest) ([]string, error) {
	switch req.OperationID {
	case operationPowersInstall:
		if req.Install == nil {
			return nil, newProviderError("incompatible")
		}
		in := req.Install
		return []string{"install", in.Name + "=" + in.Version, "--agent=" + in.Agent, "--type=" + in.Type}, nil
	case operationPowersUninstall:
		if req.Target == nil {
			return nil, newProviderError("incompatible")
		}
		t := req.Target
		return []string{"uninstall", t.Name, "--agent=" + t.Agent, "--type=" + t.Type}, nil
	default:
		return nil, newProviderError("incompatible")
	}
}

// writeChildContext reserves a small cleanup budget from the write deadline so
// the child is killed and the result returned within the overall request budget.
// When the budget is already insufficient, it reports timeout without spawning.
func writeChildContext(ctx context.Context) (context.Context, context.CancelFunc, error) {
	deadline, ok := ctx.Deadline()
	if !ok {
		return ctx, func() {}, nil
	}
	budget := time.Until(deadline)
	if budget <= writeCleanupReserve {
		return nil, nil, newProviderError("timeout")
	}
	child, cancel := context.WithDeadline(ctx, time.Now().Add(budget-writeCleanupReserve))
	return child, cancel, nil
}
