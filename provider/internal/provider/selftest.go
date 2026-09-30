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
		{"power operations", selfTestOperations},
		{"custom resources", selfTestCustomResources},
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
	fixture := func(_ context.Context, req OperationRequest) (any, error) {
		if req.OperationID != "powers.list.v1" || req.List == nil || req.List.Scope != "installed" {
			return nil, newProviderError("incompatible")
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

// selfTestOperations drives the three new operations through the server with an
// in-memory fixture and asserts their result shapes and that no stdout/stderr
// text is leaked in the RPC result.
func selfTestOperations() error {
	fixture := func(_ context.Context, req OperationRequest) (any, error) {
		switch req.OperationID {
		case operationPowersInspect:
			if req.Target == nil || req.Target.Name != "demo" {
				return nil, newProviderError("incompatible")
			}
			return InspectResult{ListJSON: "[]"}, nil
		case operationPowersInstall:
			if req.Install == nil || req.Install.Version != "v1.0.0" {
				return nil, newProviderError("incompatible")
			}
			return MutationResult{Status: "exited", ExitCode: 1}, nil
		case operationPowersUninstall:
			if req.Target == nil {
				return nil, newProviderError("incompatible")
			}
			return MutationResult{Status: "exited", ExitCode: 0}, nil
		default:
			return nil, newProviderError("incompatible")
		}
	}
	input := "{\"jsonrpc\":\"2.0\",\"id\":\"self-init\",\"method\":\"bibit.initialize\",\"params\":{\"protocolName\":\"bibit-provider\",\"serviceId\":\"store\",\"supportedProtocolVersions\":[1]}}\n" +
		"{\"jsonrpc\":\"2.0\",\"id\":\"self-inspect\",\"method\":\"bibit.invoke\",\"params\":{\"serviceId\":\"store\",\"operationId\":\"powers.inspect.v1\",\"params\":{\"agent\":\"bibit\",\"type\":\"skill\",\"name\":\"demo\"},\"timeoutMs\":30000}}\n" +
		"{\"jsonrpc\":\"2.0\",\"id\":\"self-install\",\"method\":\"bibit.invoke\",\"params\":{\"serviceId\":\"store\",\"operationId\":\"powers.install.v1\",\"params\":{\"agent\":\"bibit\",\"type\":\"skill\",\"name\":\"demo\",\"version\":\"v1.0.0\"},\"timeoutMs\":120000}}\n" +
		"{\"jsonrpc\":\"2.0\",\"id\":\"self-uninstall\",\"method\":\"bibit.invoke\",\"params\":{\"serviceId\":\"store\",\"operationId\":\"powers.uninstall.v1\",\"params\":{\"agent\":\"bibit\",\"type\":\"skill\",\"name\":\"demo\"},\"timeoutMs\":120000}}\n"
	var out bytes.Buffer
	if err := Serve(context.Background(), strings.NewReader(input), &out, fixture); err != nil {
		return err
	}
	lines := splitResponseLines(out.String())
	if len(lines) != 4 {
		return fmt.Errorf("expected 4 responses, got %d", len(lines))
	}

	// initialize response must declare all four operations.
	initResp, err := parseSelfTestResponse(lines[0])
	if err != nil {
		return err
	}
	if initResp.Error != nil {
		return fmt.Errorf("initialize failed: %+v", initResp.Error)
	}
	var initResult struct {
		Operations []string `json:"operations"`
	}
	if err := json.Unmarshal(initResp.Result, &initResult); err != nil {
		return err
	}
	wantOps := declaredOperations
	if len(initResult.Operations) != len(wantOps) {
		return fmt.Errorf("initialize operations = %v", initResult.Operations)
	}
	for i := range wantOps {
		if initResult.Operations[i] != wantOps[i] {
			return fmt.Errorf("initialize operations[%d] = %q, want %q", i, initResult.Operations[i], wantOps[i])
		}
	}

	inspectResp, err := parseSelfTestResponse(lines[1])
	if err != nil {
		return err
	}
	if inspectResp.Error != nil {
		return fmt.Errorf("inspect failed: %+v", inspectResp.Error)
	}
	var inspectResult InspectResult
	if err := json.Unmarshal(inspectResp.Result, &inspectResult); err != nil {
		return err
	}
	if inspectResult.ListJSON != "[]" {
		return fmt.Errorf("unexpected inspect result: %s", inspectResp.Result)
	}

	for _, line := range []string{lines[2], lines[3]} {
		resp, err := parseSelfTestResponse(line)
		if err != nil {
			return err
		}
		if resp.Error != nil {
			return fmt.Errorf("mutation failed: %+v", resp.Error)
		}
		var mutation MutationResult
		if err := json.Unmarshal(resp.Result, &mutation); err != nil {
			return err
		}
		if mutation.Status != "exited" {
			return fmt.Errorf("unexpected mutation result: %s", resp.Result)
		}
		var result map[string]json.RawMessage
		if err := json.Unmarshal(resp.Result, &result); err != nil {
			return err
		}
		for _, forbidden := range []string{"stdout", "stderr", "output", "message"} {
			if _, ok := result[forbidden]; ok {
				return fmt.Errorf("mutation result leaked field %q", forbidden)
			}
		}
	}
	return nil
}

// selfTestCustomResources drives the three custom-resource operations plus the
// four settings operations through the server with an in-memory fixture, and
// asserts their closed result shapes and that no path or credential is leaked.
func selfTestCustomResources() error {
	fixture := func(_ context.Context, req OperationRequest) (any, error) {
		switch req.OperationID {
		case operationPowersCustomList:
			if req.CustomList == nil || req.CustomList.Agent != "bibit" {
				return nil, newProviderError("incompatible")
			}
			return CustomListResult{Scope: "custom", Status: "data", ItemsJSON: "{\"items\":[],\"skipped\":[]}"}, nil
		case operationPowersUpload:
			if req.Upload == nil || req.Upload.Name != "demo" || req.Upload.Message != "publish demo" {
				return nil, newProviderError("incompatible")
			}
			return UploadResult{Status: "exited", ExitCode: 0, Stage: "submit", Stdout: "submission_id: sub_demo"}, nil
		case operationPowersDelete:
			if req.Target == nil || req.Target.Name != "demo" {
				return nil, newProviderError("incompatible")
			}
			return DeleteResult{Status: "deleted"}, nil
		case operationSettingsGet:
			return SettingsView{
				ShowExperimental: false,
				RefreshMinutes:   15,
				Keys: []SettingsKeyView{
					{ID: "0123456789abcdef0123456789abcdef", Preview: "apc-****-key1", Enabled: true},
				},
			}, nil
		case operationSettingsKeyAdd:
			if req.SettingsKey == nil || *req.SettingsKey != "apc-key-two" {
				return nil, newProviderError("incompatible")
			}
			return SettingsView{RefreshMinutes: 15}, nil
		case operationSettingsKeyDelete:
			if req.SettingsKeyID == nil || *req.SettingsKeyID != "0123456789abcdef0123456789abcdef" {
				return nil, newProviderError("incompatible")
			}
			return SettingsView{RefreshMinutes: 15}, nil
		case operationSettingsKeyEnable:
			if req.SettingsKeyID == nil || *req.SettingsKeyID != "0123456789abcdef0123456789abcdef" {
				return nil, newProviderError("incompatible")
			}
			return SettingsView{RefreshMinutes: 15}, nil
		default:
			return nil, newProviderError("incompatible")
		}
	}
	input := "{\"jsonrpc\":\"2.0\",\"id\":\"self-init\",\"method\":\"bibit.initialize\",\"params\":{\"protocolName\":\"bibit-provider\",\"serviceId\":\"store\",\"supportedProtocolVersions\":[1]}}\n" +
		"{\"jsonrpc\":\"2.0\",\"id\":\"self-custom\",\"method\":\"bibit.invoke\",\"params\":{\"serviceId\":\"store\",\"operationId\":\"powers.custom.list.v1\",\"params\":{\"agent\":\"bibit\"},\"timeoutMs\":30000}}\n" +
		"{\"jsonrpc\":\"2.0\",\"id\":\"self-upload\",\"method\":\"bibit.invoke\",\"params\":{\"serviceId\":\"store\",\"operationId\":\"powers.upload.v1\",\"params\":{\"agent\":\"bibit\",\"type\":\"skill\",\"name\":\"demo\",\"message\":\"publish demo\"},\"timeoutMs\":120000}}\n" +
		"{\"jsonrpc\":\"2.0\",\"id\":\"self-delete\",\"method\":\"bibit.invoke\",\"params\":{\"serviceId\":\"store\",\"operationId\":\"powers.delete.v1\",\"params\":{\"agent\":\"bibit\",\"type\":\"skill\",\"name\":\"demo\"},\"timeoutMs\":120000}}\n" +
		"{\"jsonrpc\":\"2.0\",\"id\":\"self-settings-get\",\"method\":\"bibit.invoke\",\"params\":{\"serviceId\":\"store\",\"operationId\":\"settings.get.v2\",\"params\":{},\"timeoutMs\":30000}}\n" +
		"{\"jsonrpc\":\"2.0\",\"id\":\"self-settings-add\",\"method\":\"bibit.invoke\",\"params\":{\"serviceId\":\"store\",\"operationId\":\"settings.keys.add.v1\",\"params\":{\"apiKey\":\"apc-key-two\"},\"timeoutMs\":30000}}\n" +
		"{\"jsonrpc\":\"2.0\",\"id\":\"self-settings-delete\",\"method\":\"bibit.invoke\",\"params\":{\"serviceId\":\"store\",\"operationId\":\"settings.keys.delete.v1\",\"params\":{\"id\":\"0123456789abcdef0123456789abcdef\"},\"timeoutMs\":30000}}\n" +
		"{\"jsonrpc\":\"2.0\",\"id\":\"self-settings-enable\",\"method\":\"bibit.invoke\",\"params\":{\"serviceId\":\"store\",\"operationId\":\"settings.keys.enable.v1\",\"params\":{\"id\":\"0123456789abcdef0123456789abcdef\"},\"timeoutMs\":30000}}\n"
	var out bytes.Buffer
	if err := Serve(context.Background(), strings.NewReader(input), &out, fixture); err != nil {
		return err
	}
	lines := splitResponseLines(out.String())
	if len(lines) != 8 {
		return fmt.Errorf("expected 8 responses, got %d", len(lines))
	}
	shapes := []struct {
		index     int
		required  []string
		forbidden []string
	}{
		{1, []string{"scope", "status", "itemsJson"}, []string{"items", "paths", "path"}},
		{2, []string{"status", "exitCode", "stage"}, []string{"stderr", "apiKey", "path"}},
		{3, []string{"status"}, []string{"path", "stdout", "stderr"}},
		{4, []string{"showExperimental", "refreshMinutes", "keys"}, []string{"apiKey", "hasApiKey", "key"}},
		{5, []string{"showExperimental", "refreshMinutes", "keys"}, []string{"apiKey", "hasApiKey", "key"}},
		{6, []string{"showExperimental", "refreshMinutes", "keys"}, []string{"apiKey", "hasApiKey", "key"}},
		{7, []string{"showExperimental", "refreshMinutes", "keys"}, []string{"apiKey", "hasApiKey", "key"}},
	}
	for _, shape := range shapes {
		resp, err := parseSelfTestResponse(lines[shape.index])
		if err != nil {
			return err
		}
		if resp.Error != nil {
			return fmt.Errorf("invoke %d failed: %+v", shape.index, resp.Error)
		}
		var result map[string]json.RawMessage
		if err := json.Unmarshal(resp.Result, &result); err != nil {
			return err
		}
		for _, key := range shape.required {
			if _, ok := result[key]; !ok {
				return fmt.Errorf("invoke %d result is missing %q: %s", shape.index, key, resp.Result)
			}
		}
		for _, key := range shape.forbidden {
			if _, ok := result[key]; ok {
				return fmt.Errorf("invoke %d result leaked field %q", shape.index, key)
			}
		}
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
	fixture := func(context.Context, OperationRequest) (any, error) {
		return nil, newProviderError("unavailable")
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
