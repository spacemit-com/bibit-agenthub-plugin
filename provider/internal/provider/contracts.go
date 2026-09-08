package provider

import "context"

// WireInput is the closed-union request envelope the frontend sends for the
// powers.list.v1 operation. It carries no business filtering fields: those stay
// in the frontend data layer. The provider validates only the envelope shape.
type WireInput struct {
	Scope         string `json:"scope"`
	Agent         string `json:"agent,omitempty"`
	KnownSnapshot string `json:"knownSnapshot,omitempty"`
}

// WireResult is the closed-union response envelope carrying original UTF-8 JSON
// text (listJson / catalogJson) that the frontend parses and aggregates.
type WireResult struct {
	Scope       string  `json:"scope"`
	Status      string  `json:"status"`
	ListJSON    *string `json:"listJson,omitempty"`
	Snapshot    string  `json:"snapshot,omitempty"`
	CatalogJSON *string `json:"catalogJson,omitempty"`
}

// PowerTarget identifies one Power for inspect and uninstall. It is validated
// at the protocol boundary: agent must be a fixed installed agent, type one of
// the four Power types, and name a canonical lowercase kebab name. type=agent is
// only available for the bibit agent.
type PowerTarget struct {
	Agent string `json:"agent"`
	Type  string `json:"type"`
	Name  string `json:"name"`
}

// InstallInput is PowerTarget plus a canonical vMAJOR.MINOR.PATCH version.
type InstallInput struct {
	PowerTarget
	Version string `json:"version"`
}

// InspectResult carries the raw `apm list` JSON for one Power; the frontend
// parses and validates it.
type InspectResult struct {
	ListJSON string `json:"listJson"`
}

// MutationResult reports an observed subprocess exit: the process ran to a
// normal exit and produced an exit code. A non-zero code is a result, not a
// business success or failure, and no stdout/stderr is returned.
type MutationResult struct {
	Status   string `json:"status"`
	ExitCode int    `json:"exitCode"`
}

// OperationRequest is the validated, operation-specific request the server hands
// to an InvokeFunc. Exactly one data pointer is set for a given OperationID.
type OperationRequest struct {
	OperationID string
	List        *WireInput
	Target      *PowerTarget
	Install     *InstallInput
}

// InvokeFunc resolves a validated OperationRequest into an operation-specific
// result for one invoke. It returns a *ProviderError for platform-mapped
// failures and a bare error for anything else (which the server maps to the
// unknown platform code).
type InvokeFunc func(context.Context, OperationRequest) (any, error)
