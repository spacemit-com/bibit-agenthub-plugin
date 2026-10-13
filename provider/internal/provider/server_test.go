package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const initRequest = "{\"jsonrpc\":\"2.0\",\"id\":\"init\",\"method\":\"bibit.initialize\",\"params\":{\"protocolName\":\"bibit-provider\",\"serviceId\":\"store\",\"supportedProtocolVersions\":[2,1]}}\n"

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  json.RawMessage `json:"result"`
	Error   *rpcError       `json:"error"`
}

func runInput(input string, invoke InvokeFunc) (string, error) {
	var out bytes.Buffer
	err := Serve(context.Background(), strings.NewReader(input), &out, invoke)
	return out.String(), err
}

func parseResponse(t *testing.T, raw string) rpcResponse {
	t.Helper()
	var response rpcResponse
	if err := json.Unmarshal(bytes.TrimSpace([]byte(raw)), &response); err != nil {
		t.Fatalf("invalid response JSON: %v; raw=%q", err, raw)
	}
	return response
}

func TestInitializeV1(t *testing.T) {
	out, err := runInput(initRequest, nil)
	if err != nil {
		t.Fatal(err)
	}
	response := parseResponse(t, out)
	if response.JSONRPC != "2.0" || string(response.ID) != `"init"` {
		t.Fatalf("unexpected envelope: %s", out)
	}
	var result struct {
		ProtocolVersion int `json:"protocolVersion"`
	}
	if err := json.Unmarshal(response.Result, &result); err != nil {
		t.Fatal(err)
	}
	if result.ProtocolVersion != 1 {
		t.Fatal("must negotiate v1")
	}
}

// TestProviderVersionMatchesPackageJSON keeps the version the provider reports
// in `bibit.initialize` equal to the version of the deb that ships it. The two
// drifted apart for three releases (0.3.14-0.3.16 shipped a provider still
// announcing 0.3.13) because nothing compared them: the deb version comes from
// package.json via debian/rules, and providerVersion is a Go constant.
func TestProviderVersionMatchesPackageJSON(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "package.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.Version == "" {
		t.Fatal("package.json has no version")
	}
	if providerVersion != manifest.Version {
		t.Fatalf("providerVersion %q must equal package.json version %q", providerVersion, manifest.Version)
	}
}

func TestInitializeV1ResultShape(t *testing.T) {
	out, err := runInput(initRequest, nil)
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		ProtocolVersion int    `json:"protocolVersion"`
		ProviderVersion string `json:"providerVersion"`
		Capabilities    struct {
			Invoke bool `json:"invoke"`
		} `json:"capabilities"`
		Operations []string `json:"operations"`
	}
	if err := json.Unmarshal(parseResponse(t, out).Result, &result); err != nil {
		t.Fatal(err)
	}
	if result.ProviderVersion == "" {
		t.Fatal("providerVersion must be non-empty")
	}
	if !result.Capabilities.Invoke {
		t.Fatal("capabilities.invoke must be true")
	}
	want := []string{
		"powers.list.v1",
		"powers.inspect.v1",
		"powers.install.v1",
		"powers.uninstall.v1",
		"powers.upgrade.v1",
		"powers.custom.list.v1",
		"powers.upload.v1",
		"powers.delete.v1",
		"settings.get.v2",
		"settings.keys.add.v1",
		"settings.keys.delete.v1",
		"settings.keys.enable.v1",
	}
	if len(result.Operations) != len(want) {
		t.Fatalf("operations = %v, want %v", result.Operations, want)
	}
	for i := range want {
		if result.Operations[i] != want[i] {
			t.Fatalf("operations[%d] = %q, want %q (%v)", i, result.Operations[i], want[i], result.Operations)
		}
	}
}

func TestInitializeV1Only(t *testing.T) {
	input := "{\"jsonrpc\":\"2.0\",\"id\":\"init\",\"method\":\"bibit.initialize\",\"params\":{\"protocolName\":\"bibit-provider\",\"serviceId\":\"store\",\"supportedProtocolVersions\":[1]}}\n"
	out, err := runInput(input, nil)
	if err != nil {
		t.Fatal(err)
	}
	if parseResponse(t, out).Error != nil {
		t.Fatalf("expected v1 negotiation, got error: %s", out)
	}
}

func TestInitializeAcceptsHostClientField(t *testing.T) {
	// The Bibit host sends client: {"name":"Bibit"} in its initialize request.
	// The provider must tolerate it: it is informational and not consumed.
	input := "{\"jsonrpc\":\"2.0\",\"id\":\"init\",\"method\":\"bibit.initialize\",\"params\":{\"protocolName\":\"bibit-provider\",\"serviceId\":\"store\",\"supportedProtocolVersions\":[1],\"client\":{\"name\":\"Bibit\"}}}\n"
	out, err := runInput(input, nil)
	if err != nil {
		t.Fatal(err)
	}
	response := parseResponse(t, out)
	if response.Error != nil {
		t.Fatalf("expected initialize with host client field to succeed, got error: %s", out)
	}
	var result struct {
		ProtocolVersion int `json:"protocolVersion"`
	}
	if err := json.Unmarshal(response.Result, &result); err != nil {
		t.Fatal(err)
	}
	if result.ProtocolVersion != 1 {
		t.Fatal("must negotiate v1")
	}
}

func TestInitializeV2OnlyRejected(t *testing.T) {
	input := "{\"jsonrpc\":\"2.0\",\"id\":\"init\",\"method\":\"bibit.initialize\",\"params\":{\"protocolName\":\"bibit-provider\",\"serviceId\":\"store\",\"supportedProtocolVersions\":[2]}}\n"
	out, err := runInput(input, nil)
	if err != nil {
		t.Fatal(err)
	}
	response := parseResponse(t, out)
	if response.Error == nil || response.Error.Data == nil || response.Error.Data.Code != "incompatible" {
		t.Fatalf("expected incompatible error for v2-only negotiation: %s", out)
	}
}

func TestInvokeBeforeInitialize(t *testing.T) {
	input := "{\"jsonrpc\":\"2.0\",\"id\":\"req\",\"method\":\"bibit.invoke\",\"params\":{\"serviceId\":\"store\",\"operationId\":\"powers.list.v1\",\"params\":{\"scope\":\"installed\",\"agent\":\"bibit\"},\"timeoutMs\":30000}}\n"
	out, err := runInput(input, nil)
	if err != nil {
		t.Fatal(err)
	}
	response := parseResponse(t, out)
	if response.Error == nil || response.Error.Data == nil || response.Error.Data.Code != "incompatible" {
		t.Fatalf("expected incompatible before initialize: %s", out)
	}
}

func TestUnsupportedOperation(t *testing.T) {
	input := initRequest +
		"{\"jsonrpc\":\"2.0\",\"id\":\"req\",\"method\":\"bibit.invoke\",\"params\":{\"serviceId\":\"store\",\"operationId\":\"agents.list.v1\",\"params\":{},\"timeoutMs\":30000}}\n"
	out, err := runInput(input, nil)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 responses, got %d: %s", len(lines), out)
	}
	response := parseResponse(t, lines[1])
	if response.Error == nil || response.Error.Code != -32601 {
		t.Fatalf("expected method-not-found for unsupported operation: %s", lines[1])
	}
}

func TestUnknownMethod(t *testing.T) {
	input := initRequest +
		"{\"jsonrpc\":\"2.0\",\"id\":\"req\",\"method\":\"bibit.frobnicate\",\"params\":{}}\n"
	out, err := runInput(input, nil)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	response := parseResponse(t, lines[1])
	if response.Error == nil || response.Error.Code != -32601 {
		t.Fatalf("expected -32601 for unknown method: %s", lines[1])
	}
}

func TestDuplicateInitializeRejected(t *testing.T) {
	out, err := runInput(initRequest+initRequest, nil)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 responses, got %d", len(lines))
	}
	if parseResponse(t, lines[0]).Error != nil {
		t.Fatalf("first initialize must succeed: %s", lines[0])
	}
	second := parseResponse(t, lines[1])
	if second.Error == nil || second.Error.Code != -32600 {
		t.Fatalf("duplicate initialize must fail: %s", lines[1])
	}
}

func TestInvalidServiceID(t *testing.T) {
	input := "{\"jsonrpc\":\"2.0\",\"id\":\"init\",\"method\":\"bibit.initialize\",\"params\":{\"protocolName\":\"bibit-provider\",\"serviceId\":\"security\",\"supportedProtocolVersions\":[1]}}\n"
	out, err := runInput(input, nil)
	if err != nil {
		t.Fatal(err)
	}
	if parseResponse(t, out).Error == nil {
		t.Fatalf("expected error for wrong serviceId: %s", out)
	}
}

func TestMalformedJSON(t *testing.T) {
	out, err := runInput("this is not json\n", nil)
	if err != nil {
		t.Fatal(err)
	}
	response := parseResponse(t, out)
	if response.Error == nil || response.Error.Code != -32700 {
		t.Fatalf("expected -32700 parse error: %s", out)
	}
}

func TestTrailingJSONRejected(t *testing.T) {
	out, err := runInput("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"bibit.shutdown\"} {\"x\":1}\n", nil)
	if err != nil {
		t.Fatal(err)
	}
	if parseResponse(t, out).Error == nil {
		t.Fatalf("expected parse error for trailing JSON: %s", out)
	}
}

func TestNoTrailingNewlineEOF(t *testing.T) {
	input := "{\"jsonrpc\":\"2.0\",\"id\":\"init\",\"method\":\"bibit.initialize\",\"params\":{\"protocolName\":\"bibit-provider\",\"serviceId\":\"store\",\"supportedProtocolVersions\":[1]}}"
	out, err := runInput(input, nil)
	if err != nil {
		t.Fatal(err)
	}
	if parseResponse(t, out).Error != nil {
		t.Fatalf("expected valid response for unterminated final line: %s", out)
	}
}

func TestNotificationNoResponse(t *testing.T) {
	input := "{\"jsonrpc\":\"2.0\",\"method\":\"bibit.cancel\",\"params\":{\"requestId\":\"req-1\"}}\n"
	out, err := runInput(input, nil)
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(out) != "" {
		t.Fatalf("notification must not produce a response: %q", out)
	}
}

func TestShutdownTerminates(t *testing.T) {
	input := initRequest + "{\"jsonrpc\":\"2.0\",\"method\":\"bibit.shutdown\",\"params\":{}}\n" +
		initRequest
	out, err := runInput(input, nil)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) != 1 {
		t.Fatalf("session must stop after shutdown, got %d responses: %s", len(lines), out)
	}
}

func TestInvokeSuccessEchoesWireResult(t *testing.T) {
	invoke := func(_ context.Context, req OperationRequest) (any, error) {
		if req.OperationID != "powers.list.v1" || req.List == nil || req.List.Scope != "installed" || req.List.Agent != "bibit" {
			t.Fatalf("unexpected operation request: %+v", req)
		}
		listJSON := "[]"
		return WireResult{Scope: "installed", Status: "data", ListJSON: &listJSON}, nil
	}
	input := initRequest +
		"{\"jsonrpc\":\"2.0\",\"id\":\"req-1\",\"method\":\"bibit.invoke\",\"params\":{\"serviceId\":\"store\",\"operationId\":\"powers.list.v1\",\"params\":{\"scope\":\"installed\",\"agent\":\"bibit\"},\"timeoutMs\":30000}}\n"
	out, err := runInput(input, invoke)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	response := parseResponse(t, lines[1])
	if response.Error != nil {
		t.Fatalf("expected success: %s", lines[1])
	}
	var result WireResult
	if err := json.Unmarshal(response.Result, &result); err != nil {
		t.Fatal(err)
	}
	if result.Scope != "installed" || result.Status != "data" || result.ListJSON == nil || *result.ListJSON != "[]" {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestInvokeNilDataSourceUnavailable(t *testing.T) {
	input := initRequest +
		"{\"jsonrpc\":\"2.0\",\"id\":\"req\",\"method\":\"bibit.invoke\",\"params\":{\"serviceId\":\"store\",\"operationId\":\"powers.list.v1\",\"params\":{\"scope\":\"market\"},\"timeoutMs\":30000}}\n"
	out, err := runInput(input, nil)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	response := parseResponse(t, lines[1])
	if response.Error == nil || response.Error.Data == nil || response.Error.Data.Code != "unavailable" {
		t.Fatalf("expected unavailable: %s", lines[1])
	}
}

func TestWireInputStrictValidation(t *testing.T) {
	cases := []struct {
		name   string
		params string
	}{
		{"extra key", `{"scope":"market","page":2}`},
		{"duplicate key", `{"scope":"market","scope":"installed"}`},
		{"empty agent", `{"scope":"installed","agent":""}`},
		{"market agent", `{"scope":"market","agent":"bibit"}`},
		{"installed knownSnapshot", `{"scope":"installed","agent":"bibit","knownSnapshot":"x"}`},
		{"empty knownSnapshot", `{"scope":"market","knownSnapshot":""}`},
		{"null params", `null`},
		{"array params", `[]`},
		{"bad scope", `{"scope":"nope"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			input := initRequest +
				`{"jsonrpc":"2.0","id":"req","method":"bibit.invoke","params":{"serviceId":"store","operationId":"powers.list.v1","params":` + tc.params + `,"timeoutMs":30000}}` + "\n"
			out, err := runInput(input, nil)
			if err != nil {
				t.Fatal(err)
			}
			lines := strings.Split(strings.TrimSpace(out), "\n")
			response := parseResponse(t, lines[1])
			if response.Error == nil || response.Error.Code != -32602 {
				t.Fatalf("expected -32602 for %q, got: %s", tc.name, lines[1])
			}
		})
	}
}

func TestDecodeWireInputTrailingJSON(t *testing.T) {
	if _, err := decodeWireInput(json.RawMessage(`{"scope":"market"} {"x":1}`)); err == nil {
		t.Fatal("expected trailing JSON to be rejected")
	}
}

func TestTimeoutMsValidation(t *testing.T) {
	for _, timeout := range []string{"0", "300001", "-1"} {
		input := initRequest +
			`{"jsonrpc":"2.0","id":"req","method":"bibit.invoke","params":{"serviceId":"store","operationId":"powers.list.v1","params":{"scope":"market"},"timeoutMs":` + timeout + `}}` + "\n"
		out, err := runInput(input, nil)
		if err != nil {
			t.Fatal(err)
		}
		lines := strings.Split(strings.TrimSpace(out), "\n")
		if parseResponse(t, lines[1]).Error == nil {
			t.Fatalf("expected invalid-params for timeoutMs=%s", timeout)
		}
	}
}

func TestUnknownErrorDoesNotLeakContent(t *testing.T) {
	invoke := func(context.Context, OperationRequest) (any, error) {
		return nil, errors.New("SECRET_MARKER: /home/user/.ssh/id_rsa")
	}
	input := initRequest +
		"{\"jsonrpc\":\"2.0\",\"id\":\"req\",\"method\":\"bibit.invoke\",\"params\":{\"serviceId\":\"store\",\"operationId\":\"powers.list.v1\",\"params\":{\"scope\":\"market\"},\"timeoutMs\":30000}}\n"
	out, err := runInput(input, invoke)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out, "SECRET_MARKER") || strings.Contains(out, "id_rsa") {
		t.Fatalf("error leaked content: %s", out)
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	response := parseResponse(t, lines[1])
	if response.Error == nil || response.Error.Data == nil || response.Error.Data.Code != "unknown" {
		t.Fatalf("expected unknown code: %s", lines[1])
	}
}

func TestInvokeTimeoutMapsToTimeout(t *testing.T) {
	invoke := func(ctx context.Context, _ OperationRequest) (any, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	input := initRequest +
		"{\"jsonrpc\":\"2.0\",\"id\":\"req\",\"method\":\"bibit.invoke\",\"params\":{\"serviceId\":\"store\",\"operationId\":\"powers.list.v1\",\"params\":{\"scope\":\"market\"},\"timeoutMs\":10}}\n"
	out, err := runInput(input, invoke)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	response := parseResponse(t, lines[1])
	if response.Error == nil || response.Error.Data == nil || response.Error.Data.Code != "timeout" {
		t.Fatalf("expected timeout code: %s", lines[1])
	}
}

func TestOverLongInputLineStops(t *testing.T) {
	line := `{"jsonrpc":"2.0","id":"req","method":"bibit.invoke","params":{"serviceId":"store","operationId":"powers.list.v1","params":{"scope":"market","pad":"` +
		strings.Repeat("x", maxInputBytes) + `"},"timeoutMs":30000}}` + "\n"
	_, err := runInput(line, nil)
	if err != errLineTooLong {
		t.Fatalf("expected errLineTooLong, got %v", err)
	}
}

func TestOutputBudgetOverflowBecomesResourceExhausted(t *testing.T) {
	invoke := func(context.Context, OperationRequest) (any, error) {
		big := strings.Repeat("x", maxOutputBytes)
		return WireResult{Scope: "market", Status: "data", Snapshot: "abc", CatalogJSON: &big}, nil
	}
	input := initRequest +
		"{\"jsonrpc\":\"2.0\",\"id\":\"req\",\"method\":\"bibit.invoke\",\"params\":{\"serviceId\":\"store\",\"operationId\":\"powers.list.v1\",\"params\":{\"scope\":\"market\"},\"timeoutMs\":30000}}\n"
	out, err := runInput(input, invoke)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	response := parseResponse(t, lines[1])
	if response.Error == nil || response.Error.Data == nil || response.Error.Data.Code != "resource_exhausted" {
		t.Fatalf("expected resource_exhausted on overflow: %s", lines[1][:min(200, len(lines[1]))])
	}
	if len(lines[1]) > maxOutputBytes {
		t.Fatalf("resource_exhausted error must be small: %d bytes", len(lines[1]))
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func TestInspectInvokeDispatch(t *testing.T) {
	invoke := func(_ context.Context, req OperationRequest) (any, error) {
		if req.OperationID != "powers.inspect.v1" || req.Target == nil ||
			req.Target.Agent != "bibit" || req.Target.Type != "skill" || req.Target.Name != "demo" {
			t.Fatalf("unexpected operation request: %+v", req)
		}
		return InspectResult{ListJSON: "[]"}, nil
	}
	input := initRequest +
		`{"jsonrpc":"2.0","id":"req","method":"bibit.invoke","params":{"serviceId":"store","operationId":"powers.inspect.v1","params":{"agent":"bibit","type":"skill","name":"demo"},"timeoutMs":30000}}` + "\n"
	out, err := runInput(input, invoke)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	response := parseResponse(t, lines[1])
	if response.Error != nil {
		t.Fatalf("expected success: %s", lines[1])
	}
	var result InspectResult
	if err := json.Unmarshal(response.Result, &result); err != nil {
		t.Fatal(err)
	}
	if result.ListJSON != "[]" {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestInstallInvokeDispatch(t *testing.T) {
	invoke := func(_ context.Context, req OperationRequest) (any, error) {
		if req.OperationID != "powers.install.v1" || req.Install == nil ||
			req.Install.Agent != "bibit" || req.Install.Type != "skill" ||
			req.Install.Name != "demo" || req.Install.Version != "v1.0.0" {
			t.Fatalf("unexpected operation request: %+v", req)
		}
		return MutationResult{Status: "exited", ExitCode: 1}, nil
	}
	input := initRequest +
		`{"jsonrpc":"2.0","id":"req","method":"bibit.invoke","params":{"serviceId":"store","operationId":"powers.install.v1","params":{"agent":"bibit","type":"skill","name":"demo","version":"v1.0.0"},"timeoutMs":120000}}` + "\n"
	out, err := runInput(input, invoke)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	response := parseResponse(t, lines[1])
	if response.Error != nil {
		t.Fatalf("expected success: %s", lines[1])
	}
	var result MutationResult
	if err := json.Unmarshal(response.Result, &result); err != nil {
		t.Fatal(err)
	}
	if result.Status != "exited" || result.ExitCode != 1 {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestUninstallInvokeDispatch(t *testing.T) {
	invoke := func(_ context.Context, req OperationRequest) (any, error) {
		if req.OperationID != "powers.uninstall.v1" || req.Target == nil ||
			req.Target.Agent != "bibit" || req.Target.Type != "skill" || req.Target.Name != "demo" {
			t.Fatalf("unexpected operation request: %+v", req)
		}
		return MutationResult{Status: "exited", ExitCode: 0}, nil
	}
	input := initRequest +
		`{"jsonrpc":"2.0","id":"req","method":"bibit.invoke","params":{"serviceId":"store","operationId":"powers.uninstall.v1","params":{"agent":"bibit","type":"skill","name":"demo"},"timeoutMs":120000}}` + "\n"
	out, err := runInput(input, invoke)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if parseResponse(t, lines[1]).Error != nil {
		t.Fatalf("expected success: %s", lines[1])
	}
}

func TestOperationInputValidation(t *testing.T) {
	cases := []struct {
		name        string
		operationID string
		params      string
	}{
		{"install missing version", "powers.install.v1", `{"agent":"bibit","type":"skill","name":"demo"}`},
		{"install bad version", "powers.install.v1", `{"agent":"bibit","type":"skill","name":"demo","version":"1.0.0"}`},
		{"install extra key", "powers.install.v1", `{"agent":"bibit","type":"skill","name":"demo","version":"v1.0.0","force":true}`},
		{"uninstall carries version", "powers.uninstall.v1", `{"agent":"bibit","type":"skill","name":"demo","version":"v1.0.0"}`},
		{"inspect extra key", "powers.inspect.v1", `{"agent":"bibit","type":"skill","name":"demo","version":"v1.0.0"}`},
		{"agent all", "powers.inspect.v1", `{"agent":"all","type":"skill","name":"demo"}`},
		{"unknown agent", "powers.inspect.v1", `{"agent":"gpt","type":"skill","name":"demo"}`},
		{"agent type non-bibit", "powers.inspect.v1", `{"agent":"codex","type":"agent","name":"demo"}`},
		{"bad type", "powers.inspect.v1", `{"agent":"bibit","type":"package","name":"demo"}`},
		{"non-canonical name", "powers.inspect.v1", `{"agent":"bibit","type":"skill","name":"Demo"}`},
		{"option injection name", "powers.inspect.v1", `{"agent":"bibit","type":"skill","name":"--help"}`},
		{"missing agent", "powers.inspect.v1", `{"type":"skill","name":"demo"}`},
		{"custom list missing agent", "powers.custom.list.v1", `{}`},
		{"custom list unknown agent", "powers.custom.list.v1", `{"agent":"gpt"}`},
		{"custom list extra key", "powers.custom.list.v1", `{"agent":"bibit","scope":"installed"}`},
		{"upload missing message", "powers.upload.v1", `{"agent":"bibit","type":"skill","name":"demo"}`},
		{"upload blank message", "powers.upload.v1", `{"agent":"bibit","type":"skill","name":"demo","message":"   "}`},
		{"upload multiline message", "powers.upload.v1", `{"agent":"bibit","type":"skill","name":"demo","message":"a\nb"}`},
		{"upload escape name", "powers.upload.v1", `{"agent":"bibit","type":"skill","name":"../escape","message":"ok"}`},
		{"delete carries version", "powers.delete.v1", `{"agent":"bibit","type":"skill","name":"demo","version":"v1.0.0"}`},
		{"delete escape name", "powers.delete.v1", `{"agent":"bibit","type":"skill","name":".."}`},
		{"settings get with payload", "settings.get.v2", `{"scope":"installed"}`},
		{"settings add blank key", "settings.keys.add.v1", `{"apiKey":""}`},
		{"settings add unknown field", "settings.keys.add.v1", `{"apiKey":"k","theme":"dark"}`},
		{"settings add bad key type", "settings.keys.add.v1", `{"apiKey":5}`},
		{"settings delete bad id", "settings.keys.delete.v1", `{"id":"../escape"}`},
		{"settings enable missing id", "settings.keys.enable.v1", `{}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			input := initRequest +
				`{"jsonrpc":"2.0","id":"req","method":"bibit.invoke","params":{"serviceId":"store","operationId":"` + tc.operationID + `","params":` + tc.params + `,"timeoutMs":30000}}` + "\n"
			out, err := runInput(input, nil)
			if err != nil {
				t.Fatal(err)
			}
			lines := strings.Split(strings.TrimSpace(out), "\n")
			response := parseResponse(t, lines[1])
			if response.Error == nil || response.Error.Code != -32602 {
				t.Fatalf("expected -32602 for %q, got: %s", tc.name, lines[1])
			}
		})
	}
}

func TestCustomResourceInvokeDispatch(t *testing.T) {
	seen := map[string]OperationRequest{}
	invoke := func(_ context.Context, req OperationRequest) (any, error) {
		seen[req.OperationID] = req
		switch req.OperationID {
		case operationPowersCustomList:
			return CustomListResult{Scope: "custom", Status: "data", ItemsJSON: `{"items":[],"skipped":[]}`}, nil
		case operationPowersUpload:
			return UploadResult{Status: "exited", ExitCode: 0, Stage: "submit", Stdout: "submission_id: sub_1"}, nil
		case operationPowersDelete:
			return DeleteResult{Status: "deleted"}, nil
		case operationSettingsGet:
			return SettingsView{RefreshMinutes: 15, Keys: []SettingsKeyView{{
				ID:      "0123456789abcdef0123456789abcdef",
				Preview: "apc-****-one",
				Enabled: true,
			}}}, nil
		case operationSettingsKeyAdd:
			return SettingsView{RefreshMinutes: 15}, nil
		case operationSettingsKeyDelete, operationSettingsKeyEnable:
			return SettingsView{ShowExperimental: true, RefreshMinutes: 45}, nil
		default:
			return nil, newProviderError("incompatible")
		}
	}
	input := initRequest +
		`{"jsonrpc":"2.0","id":"custom","method":"bibit.invoke","params":{"serviceId":"store","operationId":"powers.custom.list.v1","params":{"agent":"codex"},"timeoutMs":30000}}` + "\n" +
		`{"jsonrpc":"2.0","id":"upload","method":"bibit.invoke","params":{"serviceId":"store","operationId":"powers.upload.v1","params":{"agent":"bibit","type":"skill","name":"demo","message":"publish it"},"timeoutMs":120000}}` + "\n" +
		`{"jsonrpc":"2.0","id":"delete","method":"bibit.invoke","params":{"serviceId":"store","operationId":"powers.delete.v1","params":{"agent":"bibit","type":"skill","name":"demo"},"timeoutMs":120000}}` + "\n" +
		`{"jsonrpc":"2.0","id":"settings-get","method":"bibit.invoke","params":{"serviceId":"store","operationId":"settings.get.v2","params":{},"timeoutMs":30000}}` + "\n" +
		`{"jsonrpc":"2.0","id":"settings-add","method":"bibit.invoke","params":{"serviceId":"store","operationId":"settings.keys.add.v1","params":{"apiKey":"apc-key-two"},"timeoutMs":30000}}` + "\n" +
		`{"jsonrpc":"2.0","id":"settings-enable","method":"bibit.invoke","params":{"serviceId":"store","operationId":"settings.keys.enable.v1","params":{"id":"0123456789abcdef0123456789abcdef"},"timeoutMs":30000}}` + "\n"
	out, err := runInput(input, invoke)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) != 7 {
		t.Fatalf("expected 7 responses, got %d", len(lines))
	}
	for _, line := range lines[1:] {
		if response := parseResponse(t, line); response.Error != nil {
			t.Fatalf("expected success: %s", line)
		}
	}
	if list := seen[operationPowersCustomList]; list.CustomList == nil || list.CustomList.Agent != "codex" {
		t.Fatalf("custom list request not decoded: %+v", list)
	}
	if upload := seen[operationPowersUpload]; upload.Upload == nil || upload.Upload.Name != "demo" ||
		upload.Upload.Message != "publish it" || upload.Upload.Type != "skill" {
		t.Fatalf("upload request not decoded: %+v", upload)
	}
	if del := seen[operationPowersDelete]; del.Target == nil || del.Target.Name != "demo" {
		t.Fatalf("delete request not decoded: %+v", del)
	}
	if add := seen[operationSettingsKeyAdd]; add.SettingsKey == nil || *add.SettingsKey != "apc-key-two" {
		t.Fatalf("settings key add not decoded: %+v", add)
	}
	if enable := seen[operationSettingsKeyEnable]; enable.SettingsKeyID == nil ||
		*enable.SettingsKeyID != "0123456789abcdef0123456789abcdef" {
		t.Fatalf("settings key enable not decoded: %+v", enable)
	}
}

func TestUndeclaredOperationRejected(t *testing.T) {
	invoke := func(context.Context, OperationRequest) (any, error) {
		t.Fatal("an undeclared operation must not reach the invoker")
		return nil, nil
	}
	input := initRequest +
		`{"jsonrpc":"2.0","id":"req","method":"bibit.invoke","params":{"serviceId":"store","operationId":"powers.custom.remove.v1","params":{"agent":"bibit"},"timeoutMs":30000}}` + "\n"
	out, err := runInput(input, invoke)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	response := parseResponse(t, lines[1])
	if response.Error == nil || response.Error.Code != -32601 {
		t.Fatalf("expected -32601: %s", lines[1])
	}
}

func TestInvalidOperationRequestDoesNotSpawn(t *testing.T) {
	called := 0
	invoke := func(context.Context, OperationRequest) (any, error) {
		called++
		return nil, nil
	}
	input := initRequest +
		`{"jsonrpc":"2.0","id":"req","method":"bibit.invoke","params":{"serviceId":"store","operationId":"powers.install.v1","params":{"agent":"codex","type":"agent","name":"demo","version":"v1.0.0"},"timeoutMs":120000}}` + "\n"
	out, err := runInput(input, invoke)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if parseResponse(t, lines[1]).Error == nil {
		t.Fatalf("expected validation error: %s", lines[1])
	}
	if called != 0 {
		t.Fatalf("invoke must not run for invalid requests, called %d times", called)
	}
}
