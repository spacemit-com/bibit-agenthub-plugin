package provider

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"
)

const (
	providerProtocolName = "bibit-provider"
	serviceIDStore       = "store"
	operationPowersList  = "powers.list.v1"

	// Custom-resource operations. `powers.custom.list.v1` reports the Powers a
	// user installed by hand into an Agent's own directory tree; the two writes
	// publish one of them to APC and remove it from disk.
	operationPowersCustomList = "powers.custom.list.v1"
	operationPowersUpload     = "powers.upload.v1"
	operationPowersDelete     = "powers.delete.v1"

	operationSettingsGet    = "settings.get.v1"
	operationSettingsUpdate = "settings.update.v1"

	// maxInputBytes bounds a single NDJSON input line (the host request budget).
	maxInputBytes = 1 << 20 // 1 MiB
	// maxOutputBytes bounds a final serialized RPC response line including '\n'.
	maxOutputBytes = 4 << 20 // 4 MiB
	// maxIDLength bounds a JSON-RPC string id; the host uses 1..128.
	maxIDLength = 128

	providerVersion = "0.3.4"
)

// declaredOperations is the closed set reported to the host at initialize and
// enforced on every invoke.
var declaredOperations = []string{
	operationPowersList,
	operationPowersInspect,
	operationPowersInstall,
	operationPowersUninstall,
	operationPowersCustomList,
	operationPowersUpload,
	operationPowersDelete,
	operationSettingsGet,
	operationSettingsUpdate,
}

func isDeclaredOperation(operationID string) bool {
	for _, declared := range declaredOperations {
		if declared == operationID {
			return true
		}
	}
	return false
}

var errLineTooLong = errors.New("provider: input line exceeds limit")

// Serve runs the v1 NDJSON protocol loop: bounded line reads, initialize state,
// invoke dispatch and bounded response writes. invoke may be nil when no data
// source is wired; invoking then yields a safe unavailable error.
func Serve(ctx context.Context, in io.Reader, out io.Writer, invoke InvokeFunc) error {
	reader := bufio.NewReaderSize(in, 64*1024)
	initialized := false
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		line, err := readBoundedLine(reader)
		if err == io.EOF {
			if len(line) == 0 {
				return nil
			}
			done, werr := dispatch(ctx, line, &initialized, invoke, out)
			if werr != nil {
				return werr
			}
			_ = done
			return nil
		}
		if err == errLineTooLong {
			// Do not keep consuming the oversized line; emit a small error and stop.
			_ = emitResponse(out, json.RawMessage("null"), nil,
				newRPCError(-32700, "Parse error", "resource_exhausted"))
			return err
		}
		if err != nil {
			return err
		}
		done, werr := dispatch(ctx, line, &initialized, invoke, out)
		if werr != nil {
			return werr
		}
		if done {
			return nil
		}
	}
}

// readBoundedLine reads one line, returning its content without the trailing
// newline. err is io.EOF when input ended (line may hold a final unterminated
// line), errLineTooLong when the line exceeded maxInputBytes, or a read error.
func readBoundedLine(r *bufio.Reader) ([]byte, error) {
	var line []byte
	for {
		fragment, err := r.ReadSlice('\n')
		switch err {
		case nil:
			line = append(line, fragment[:len(fragment)-1]...)
			if len(line) > maxInputBytes {
				return nil, errLineTooLong
			}
			return line, nil
		case bufio.ErrBufferFull:
			line = append(line, fragment...)
			if len(line) > maxInputBytes {
				return nil, errLineTooLong
			}
		case io.EOF:
			if len(fragment) > 0 {
				line = append(line, fragment...)
				return line, io.EOF
			}
			return nil, io.EOF
		default:
			return nil, err
		}
	}
}

// dispatch parses one request/notification line and, for requests, writes exactly
// one response. It returns done=true when the session should terminate.
func dispatch(ctx context.Context, line []byte, initialized *bool, invoke InvokeFunc, out io.Writer) (bool, error) {
	obj, err := decodeObject(line)
	if err != nil {
		return false, emitResponse(out, json.RawMessage("null"), nil,
			newRPCError(-32700, "Parse error", "incompatible"))
	}

	jsonrpc, ok := stringField(obj, "jsonrpc")
	if !ok || jsonrpc != "2.0" {
		return false, emitResponse(out, idOrNull(obj), nil,
			newRPCError(-32600, "Invalid Request", "incompatible"))
	}

	id, hasID := obj["id"]
	methodRaw, hasMethod := obj["method"]
	if !hasMethod {
		return false, emitResponse(out, idOrNull(obj), nil,
			newRPCError(-32600, "Invalid Request", "incompatible"))
	}
	method, ok := parseString(methodRaw)
	if !ok {
		return false, emitResponse(out, idOrNull(obj), nil,
			newRPCError(-32600, "Invalid Request", "incompatible"))
	}

	if !hasID {
		return handleNotification(method), nil
	}
	if !validID(id) {
		return false, emitResponse(out, json.RawMessage("null"), nil,
			newRPCError(-32600, "Invalid Request", "incompatible"))
	}

	switch method {
	case "bibit.initialize":
		return false, handleInitialize(obj, id, initialized, out)
	case "bibit.invoke":
		return false, handleInvoke(ctx, obj, id, *initialized, invoke, out)
	default:
		return false, emitResponse(out, id, nil,
			newRPCError(-32601, "Method not found", "incompatible"))
	}
}

func handleNotification(method string) bool {
	// Notifications never produce an id-bearing response and never run business
	// work. bibit.shutdown ends the session; bibit.cancel is a v2 affordance the
	// host sends before terminating a v1 session, so it is ignored here.
	return method == "bibit.shutdown"
}

func handleInitialize(obj map[string]json.RawMessage, id json.RawMessage, initialized *bool, out io.Writer) error {
	if *initialized {
		return emitResponse(out, id, nil, newRPCError(-32600, "Invalid Request", "incompatible"))
	}
	paramsRaw, ok := obj["params"]
	if !ok {
		return emitResponse(out, id, nil, newRPCError(-32602, "Invalid params", "incompatible"))
	}
	var params initializeParams
	if err := strictUnmarshal(paramsRaw, &params); err != nil {
		return emitResponse(out, id, nil, newRPCError(-32602, "Invalid params", "incompatible"))
	}
	if params.ProtocolName != providerProtocolName ||
		params.ServiceID != serviceIDStore ||
		!hasV1(params.SupportedProtocolVersions) {
		return emitResponse(out, id, nil, newRPCError(-32602, "Invalid params", "incompatible"))
	}
	*initialized = true
	result := initializeResult{
		ProtocolVersion: 1,
		ProviderVersion: providerVersion,
		Capabilities:    providerCapabilities{Invoke: true},
		Operations:      append([]string(nil), declaredOperations...),
	}
	return emitResponse(out, id, result, nil)
}

func handleInvoke(ctx context.Context, obj map[string]json.RawMessage, id json.RawMessage, initialized bool, invoke InvokeFunc, out io.Writer) error {
	if !initialized {
		return emitResponse(out, id, nil, newRPCError(-32600, "Invalid Request", "incompatible"))
	}
	paramsRaw, ok := obj["params"]
	if !ok {
		return emitResponse(out, id, nil, newRPCError(-32602, "Invalid params", "incompatible"))
	}
	var params invokeParams
	if err := strictUnmarshal(paramsRaw, &params); err != nil {
		return emitResponse(out, id, nil, newRPCError(-32602, "Invalid params", "incompatible"))
	}
	if params.ServiceID != serviceIDStore {
		return emitResponse(out, id, nil, newRPCError(-32602, "Invalid params", "incompatible"))
	}
	if params.TimeoutMs < 1 || params.TimeoutMs > 300000 {
		return emitResponse(out, id, nil, newRPCError(-32602, "Invalid params", "incompatible"))
	}
	if !isDeclaredOperation(params.OperationID) {
		return emitResponse(out, id, nil, newRPCError(-32601, "Method not found", "incompatible"))
	}
	request, err := decodeOperationRequest(params.OperationID, params.Params)
	if err != nil {
		return emitResponse(out, id, nil, newRPCError(-32602, "Invalid params", "incompatible"))
	}
	if invoke == nil {
		return emitResponse(out, id, nil, newRPCError(-32000, platformMessage("unavailable"), "unavailable"))
	}

	invokeCtx, cancel := context.WithTimeout(ctx, time.Duration(params.TimeoutMs)*time.Millisecond)
	defer cancel()
	result, invokeErr := invoke(invokeCtx, request)
	if invokeErr != nil {
		pe, ok := invokeErr.(*ProviderError)
		if !ok {
			pe = newProviderError("unknown")
		}
		if errors.Is(invokeCtx.Err(), context.DeadlineExceeded) {
			pe = newProviderError("timeout")
		}
		return emitResponse(out, id, nil, newRPCError(-32000, platformMessage(pe.Code), pe.Code))
	}
	return emitResponse(out, id, result, nil)
}

func hasV1(versions []int) bool {
	for _, version := range versions {
		if version == 1 {
			return true
		}
	}
	return false
}

// --- wire input strict validation -----------------------------------------

func decodeWireInput(raw json.RawMessage) (WireInput, error) {
	obj, err := decodeObject(raw)
	if err != nil {
		return WireInput{}, err
	}
	scopeRaw, ok := obj["scope"]
	if !ok {
		return WireInput{}, errors.New("wire input: missing scope")
	}
	scope, ok := parseString(scopeRaw)
	if !ok {
		return WireInput{}, errors.New("wire input: scope must be a string")
	}
	switch scope {
	case "installed":
		if _, has := obj["knownSnapshot"]; has {
			return WireInput{}, errors.New("wire input: knownSnapshot forbidden for installed scope")
		}
		if err := rejectKeys(obj, "scope", "agent"); err != nil {
			return WireInput{}, err
		}
		agentRaw, ok := obj["agent"]
		if !ok {
			return WireInput{}, errors.New("wire input: agent required for installed scope")
		}
		agent, ok := parseString(agentRaw)
		if !ok || agent == "" {
			return WireInput{}, errors.New("wire input: agent must be a non-empty string")
		}
		return WireInput{Scope: "installed", Agent: agent}, nil
	case "market":
		if _, has := obj["agent"]; has {
			return WireInput{}, errors.New("wire input: agent forbidden for market scope")
		}
		if err := rejectKeys(obj, "scope", "knownSnapshot"); err != nil {
			return WireInput{}, err
		}
		if knownRaw, has := obj["knownSnapshot"]; has {
			known, ok := parseString(knownRaw)
			if !ok || known == "" {
				return WireInput{}, errors.New("wire input: knownSnapshot must be a non-empty string")
			}
			return WireInput{Scope: "market", KnownSnapshot: known}, nil
		}
		return WireInput{Scope: "market"}, nil
	default:
		return WireInput{}, errors.New("wire input: invalid scope")
	}
}

func rejectKeys(obj map[string]json.RawMessage, allowed ...string) error {
	set := make(map[string]bool, len(allowed))
	for _, key := range allowed {
		set[key] = true
	}
	for key := range obj {
		if !set[key] {
			return fmt.Errorf("wire input: unexpected field %q", key)
		}
	}
	return nil
}

// decodeOperationRequest validates the params envelope for one known operation
// and returns the typed, closed-union request. Unknown operations are rejected
// by handleInvoke before this runs.
func decodeOperationRequest(operationID string, raw json.RawMessage) (OperationRequest, error) {
	switch operationID {
	case operationPowersList:
		wireInput, err := decodeWireInput(raw)
		if err != nil {
			return OperationRequest{}, err
		}
		return OperationRequest{OperationID: operationID, List: &wireInput}, nil
	case operationPowersInspect:
		target, err := decodePowerTarget(raw)
		if err != nil {
			return OperationRequest{}, err
		}
		return OperationRequest{OperationID: operationID, Target: &target}, nil
	case operationPowersInstall:
		install, err := decodeInstallInput(raw)
		if err != nil {
			return OperationRequest{}, err
		}
		return OperationRequest{OperationID: operationID, Install: &install}, nil
	case operationPowersUninstall:
		target, err := decodePowerTarget(raw)
		if err != nil {
			return OperationRequest{}, err
		}
		return OperationRequest{OperationID: operationID, Target: &target}, nil
	case operationPowersCustomList:
		list, err := decodeCustomListInput(raw)
		if err != nil {
			return OperationRequest{}, err
		}
		return OperationRequest{OperationID: operationID, CustomList: &list}, nil
	case operationPowersUpload:
		upload, err := decodeUploadInput(raw)
		if err != nil {
			return OperationRequest{}, err
		}
		return OperationRequest{OperationID: operationID, Upload: &upload}, nil
	case operationPowersDelete:
		target, err := decodePowerTarget(raw)
		if err != nil {
			return OperationRequest{}, err
		}
		return OperationRequest{OperationID: operationID, Target: &target}, nil
	case operationSettingsGet:
		if _, err := decodeObject(raw); err != nil {
			return OperationRequest{}, err
		}
		if err := rejectKeys(mustDecodeObject(raw)); err != nil {
			return OperationRequest{}, err
		}
		return OperationRequest{OperationID: operationID}, nil
	case operationSettingsUpdate:
		update, err := decodeSettingsUpdate(raw)
		if err != nil {
			return OperationRequest{}, err
		}
		return OperationRequest{OperationID: operationID, Settings: &update}, nil
	default:
		return OperationRequest{}, errors.New("unknown operation")
	}
}

// mustDecodeObject re-decodes an already validated raw object; the caller has
// run decodeObject first, so the only failure mode is a programming error.
func mustDecodeObject(raw json.RawMessage) map[string]json.RawMessage {
	obj, _ := decodeObject(raw)
	return obj
}

// --- JSON-RPC helpers ------------------------------------------------------

type initializeParams struct {
	ProtocolName              string          `json:"protocolName"`
	ServiceID                 string          `json:"serviceId"`
	SupportedProtocolVersions []int           `json:"supportedProtocolVersions"`
	Client                    json.RawMessage `json:"client,omitempty"`
}

type invokeParams struct {
	ServiceID   string          `json:"serviceId"`
	OperationID string          `json:"operationId"`
	Params      json.RawMessage `json:"params"`
	TimeoutMs   int64           `json:"timeoutMs"`
}

type initializeResult struct {
	ProtocolVersion int                  `json:"protocolVersion"`
	ProviderVersion string               `json:"providerVersion"`
	Capabilities    providerCapabilities `json:"capabilities"`
	Operations      []string             `json:"operations"`
}

type providerCapabilities struct {
	Invoke bool `json:"invoke"`
}

type rpcSuccess struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result"`
}

type rpcFailure struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Error   *rpcError       `json:"error"`
}

type rpcError struct {
	Code    int                `json:"code"`
	Message string             `json:"message"`
	Data    *platformErrorData `json:"data,omitempty"`
}

type platformErrorData struct {
	Code string `json:"code"`
}

func newRPCError(code int, message, dataCode string) *rpcError {
	return &rpcError{Code: code, Message: message, Data: &platformErrorData{Code: dataCode}}
}

// emitResponse marshals one response, appends a newline, enforces the output
// budget (substituting a small resource_exhausted error on overflow), and writes
// it. It is the single response writer used by the serial Serve loop.
func emitResponse(out io.Writer, id json.RawMessage, result any, rpcErr *rpcError) error {
	var payload []byte
	var err error
	if rpcErr != nil {
		payload, err = json.Marshal(rpcFailure{JSONRPC: "2.0", ID: id, Error: rpcErr})
	} else {
		payload, err = json.Marshal(rpcSuccess{JSONRPC: "2.0", ID: id, Result: result})
	}
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	if len(payload) > maxOutputBytes {
		payload, err = json.Marshal(rpcFailure{
			JSONRPC: "2.0",
			ID:      id,
			Error:   newRPCError(-32000, platformMessage("resource_exhausted"), "resource_exhausted"),
		})
		if err != nil {
			return err
		}
		payload = append(payload, '\n')
	}
	_, err = out.Write(payload)
	return err
}

// decodeObject strictly decodes a single JSON object, rejecting duplicate keys,
// trailing JSON, and non-object values.
func decodeObject(raw []byte) (map[string]json.RawMessage, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	tok, err := dec.Token()
	if err != nil {
		return nil, errors.New("invalid JSON")
	}
	delim, ok := tok.(json.Delim)
	if !ok || delim != '{' {
		return nil, errors.New("expected a JSON object")
	}
	obj := make(map[string]json.RawMessage)
	for dec.More() {
		keyTok, err := dec.Token()
		if err != nil {
			return nil, errors.New("invalid JSON")
		}
		key, ok := keyTok.(string)
		if !ok {
			return nil, errors.New("expected a string object key")
		}
		if _, exists := obj[key]; exists {
			return nil, fmt.Errorf("duplicate field %q", key)
		}
		var raw json.RawMessage
		if err := dec.Decode(&raw); err != nil {
			return nil, errors.New("invalid JSON")
		}
		obj[key] = raw
	}
	if _, err := dec.Token(); err != nil { // closing brace
		return nil, errors.New("invalid JSON")
	}
	if _, err := dec.Token(); err != io.EOF {
		if err == nil {
			return nil, errors.New("trailing JSON after object")
		}
		return nil, errors.New("invalid JSON")
	}
	return obj, nil
}

// strictUnmarshal decodes a raw JSON object into target with closed keys
// (unknown fields rejected) after duplicate/trailing checks via decodeObject.
func strictUnmarshal(raw json.RawMessage, target any) error {
	obj, err := decodeObject(raw)
	if err != nil {
		return err
	}
	clean, err := json.Marshal(obj)
	if err != nil {
		return err
	}
	dec := json.NewDecoder(bytes.NewReader(clean))
	dec.DisallowUnknownFields()
	return dec.Decode(target)
}

func stringField(obj map[string]json.RawMessage, key string) (string, bool) {
	raw, ok := obj[key]
	if !ok {
		return "", false
	}
	return parseString(raw)
}

func parseString(raw json.RawMessage) (string, bool) {
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", false
	}
	return value, true
}

func idOrNull(obj map[string]json.RawMessage) json.RawMessage {
	if id, ok := obj["id"]; ok {
		return id
	}
	return json.RawMessage("null")
}

func validID(id json.RawMessage) bool {
	trimmed := bytes.TrimSpace(id)
	if len(trimmed) == 0 || len(trimmed) > maxIDLength+2 {
		return false
	}
	if trimmed[0] == '"' {
		var value string
		if err := json.Unmarshal(trimmed, &value); err != nil {
			return false
		}
		return value != "" && len(value) <= maxIDLength
	}
	if trimmed[0] == '-' || (trimmed[0] >= '0' && trimmed[0] <= '9') {
		var value json.Number
		return json.Unmarshal(trimmed, &value) == nil
	}
	return false
}
