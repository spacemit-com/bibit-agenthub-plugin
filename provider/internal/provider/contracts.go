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

// InvokeFunc resolves a validated WireInput into a WireResult for one invoke.
// It returns a *ProviderError for platform-mapped failures and a bare error for
// anything else (which the server maps to the unknown platform code).
type InvokeFunc func(context.Context, WireInput) (WireResult, error)
