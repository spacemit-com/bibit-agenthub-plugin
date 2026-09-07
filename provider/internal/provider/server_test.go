package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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
	found := false
	for _, op := range result.Operations {
		if op == "powers.list.v1" {
			found = true
		}
	}
	if !found {
		t.Fatalf("operations must include powers.list.v1: %v", result.Operations)
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
	invoke := func(_ context.Context, input WireInput) (WireResult, error) {
		if input.Scope != "installed" || input.Agent != "bibit" {
			t.Fatalf("unexpected wire input: %+v", input)
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
	invoke := func(context.Context, WireInput) (WireResult, error) {
		return WireResult{}, errors.New("SECRET_MARKER: /home/user/.ssh/id_rsa")
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
	invoke := func(ctx context.Context, _ WireInput) (WireResult, error) {
		<-ctx.Done()
		return WireResult{}, ctx.Err()
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
	invoke := func(context.Context, WireInput) (WireResult, error) {
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
