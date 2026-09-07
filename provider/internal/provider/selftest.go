package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// SelfTest runs the provider protocol against in-memory fixtures with no network
// and no APM process. It returns nil when initialize, v1 negotiation, invoke,
// error mapping and malformed-input handling all behave, and a non-nil error
// otherwise. The CLI --self-test exits 0 only when this returns nil.
func SelfTest() error {
	checks := []struct {
		name string
		run  func() error
	}{
		{"happy path", selfTestHappyPath},
		{"v2-only negotiation", selfTestV2Only},
		{"invoke error mapping", selfTestInvokeError},
		{"malformed input", selfTestMalformed},
	}
	for _, check := range checks {
		if err := check.run(); err != nil {
			return fmt.Errorf("self-test %s: %w", check.name, err)
		}
	}
	return nil
}

func selfTestHappyPath() error {
	fixture := func(_ context.Context, input WireInput) (WireResult, error) {
		if input.Scope != "installed" {
			return WireResult{}, newProviderError("incompatible")
		}
		listJSON := "[]"
		return WireResult{Scope: "installed", Status: "data", ListJSON: &listJSON}, nil
	}
	input := "{\"jsonrpc\":\"2.0\",\"id\":\"self-init\",\"method\":\"bibit.initialize\",\"params\":{\"protocolName\":\"bibit-provider\",\"serviceId\":\"store\",\"supportedProtocolVersions\":[1]}}\n" +
		"{\"jsonrpc\":\"2.0\",\"id\":\"self-invoke\",\"method\":\"bibit.invoke\",\"params\":{\"serviceId\":\"store\",\"operationId\":\"powers.list.v1\",\"params\":{\"scope\":\"installed\",\"agent\":\"bibit\"},\"timeoutMs\":30000}}\n"
	var out bytes.Buffer
	if err := Serve(context.Background(), strings.NewReader(input), &out, fixture); err != nil {
		return err
	}
	lines := splitResponseLines(out.String())
	if len(lines) != 2 {
		return fmt.Errorf("expected exactly 2 responses, got %d", len(lines))
	}

	initResp, err := parseSelfTestResponse(lines[0])
	if err != nil {
		return err
	}
	if initResp.Error != nil {
		return fmt.Errorf("initialize failed: %+v", initResp.Error)
	}
	var initResult struct {
		ProtocolVersion int `json:"protocolVersion"`
		Capabilities    struct {
			Invoke bool `json:"invoke"`
		} `json:"capabilities"`
	}
	if err := json.Unmarshal(initResp.Result, &initResult); err != nil {
		return err
	}
	if initResult.ProtocolVersion != 1 || !initResult.Capabilities.Invoke {
		return fmt.Errorf("unexpected initialize result: %s", initResp.Result)
	}

	invokeResp, err := parseSelfTestResponse(lines[1])
	if err != nil {
		return err
	}
	if invokeResp.Error != nil {
		return fmt.Errorf("invoke failed: %+v", invokeResp.Error)
	}
	var result map[string]json.RawMessage
	if err := json.Unmarshal(invokeResp.Result, &result); err != nil {
		return err
	}
	for _, forbidden := range []string{"items", "facets", "page", "total", "warnings", "nextPage"} {
		if _, ok := result[forbidden]; ok {
			return fmt.Errorf("invoke result leaked business field %q", forbidden)
		}
	}
	if string(result["scope"]) != `"installed"` ||
		string(result["status"]) != `"data"` ||
		string(result["listJson"]) != `"[]"` {
		return fmt.Errorf("unexpected invoke result: %s", invokeResp.Result)
	}
	return nil
}

func selfTestV2Only() error {
	input := "{\"jsonrpc\":\"2.0\",\"id\":\"self-init\",\"method\":\"bibit.initialize\",\"params\":{\"protocolName\":\"bibit-provider\",\"serviceId\":\"store\",\"supportedProtocolVersions\":[2]}}\n"
	var out bytes.Buffer
	if err := Serve(context.Background(), strings.NewReader(input), &out, nil); err != nil {
		return err
	}
	resp, err := parseSelfTestResponse(strings.TrimSpace(out.String()))
	if err != nil {
		return err
	}
	if resp.Error == nil || resp.Error.Data == nil || resp.Error.Data.Code != "incompatible" {
		return fmt.Errorf("v2-only negotiation must be rejected as incompatible, got %s", out.String())
	}
	return nil
}

func selfTestInvokeError() error {
	fixture := func(context.Context, WireInput) (WireResult, error) {
		return WireResult{}, newProviderError("unavailable")
	}
	input := "{\"jsonrpc\":\"2.0\",\"id\":\"self-init\",\"method\":\"bibit.initialize\",\"params\":{\"protocolName\":\"bibit-provider\",\"serviceId\":\"store\",\"supportedProtocolVersions\":[1]}}\n" +
		"{\"jsonrpc\":\"2.0\",\"id\":\"self-invoke\",\"method\":\"bibit.invoke\",\"params\":{\"serviceId\":\"store\",\"operationId\":\"powers.list.v1\",\"params\":{\"scope\":\"market\"},\"timeoutMs\":30000}}\n"
	var out bytes.Buffer
	if err := Serve(context.Background(), strings.NewReader(input), &out, fixture); err != nil {
		return err
	}
	lines := splitResponseLines(out.String())
	if len(lines) != 2 {
		return fmt.Errorf("expected 2 responses, got %d", len(lines))
	}
	resp, err := parseSelfTestResponse(lines[1])
	if err != nil {
		return err
	}
	if resp.Error == nil || resp.Error.Data == nil || resp.Error.Data.Code != "unavailable" {
		return fmt.Errorf("expected unavailable error, got %s", lines[1])
	}
	return nil
}

func selfTestMalformed() error {
	var out bytes.Buffer
	if err := Serve(context.Background(), strings.NewReader("this is not json\n"), &out, nil); err != nil {
		return err
	}
	resp, err := parseSelfTestResponse(strings.TrimSpace(out.String()))
	if err != nil {
		return err
	}
	if resp.Error == nil || resp.Error.Code != -32700 {
		return fmt.Errorf("expected -32700 parse error, got %s", out.String())
	}
	return nil
}

type selfTestResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error"`
}

func parseSelfTestResponse(line string) (selfTestResponse, error) {
	var response selfTestResponse
	if err := json.Unmarshal([]byte(line), &response); err != nil {
		return response, fmt.Errorf("invalid response JSON: %w", err)
	}
	return response, nil
}

func splitResponseLines(s string) []string {
	trimmed := strings.TrimSpace(s)
	if trimmed == "" {
		return nil
	}
	return strings.Split(trimmed, "\n")
}
