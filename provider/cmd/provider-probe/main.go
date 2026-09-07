// Command provider-probe drives a real provider executable over stdio and prints
// a sanitized measurement report. It is a development tool and is not packaged in
// the CLI deb. It never prints raw catalog text, provider stderr or local paths.
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
)

const maxRPCBytes = 4 << 20 // 4 MiB, matching the host response budget

type probeFlags struct {
	executable    string
	scope         string
	agent         string
	knownSnapshot string
	apmPath       string
	userHome      string
	apcBaseURL    string
}

type probeReport struct {
	ProtocolVersion int    `json:"protocolVersion"`
	Scope           string `json:"scope"`
	Status          string `json:"status"`
	Snapshot        string `json:"snapshot,omitempty"`
	RPCBytes        int    `json:"rpcBytes"`
	RawBytes        int    `json:"rawBytes"`
	RemainingBytes  int    `json:"remainingBytes"`
}

func main() {
	flags, err := parseFlags(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, "probe:", err)
		os.Exit(2)
	}
	report, err := runProbe(flags)
	if err != nil {
		fmt.Fprintln(os.Stderr, "probe:", err)
		os.Exit(1)
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(report); err != nil {
		fmt.Fprintln(os.Stderr, "probe:", err)
		os.Exit(1)
	}
}

func parseFlags(args []string) (probeFlags, error) {
	fs := flag.NewFlagSet("provider-probe", flag.ContinueOnError)
	var flags probeFlags
	fs.StringVar(&flags.executable, "executable", "", "provider executable path (required)")
	fs.StringVar(&flags.scope, "scope", "market", "wire scope: market|installed")
	fs.StringVar(&flags.agent, "agent", "bibit", "installed agent id")
	fs.StringVar(&flags.knownSnapshot, "known-snapshot", "", "market known snapshot")
	fs.StringVar(&flags.apmPath, "apm-path", "", "apm path override")
	fs.StringVar(&flags.userHome, "user-home", "", "user home override")
	fs.StringVar(&flags.apcBaseURL, "apc-base-url", "", "apc base url override")
	if err := fs.Parse(args); err != nil {
		return flags, err
	}
	if flags.executable == "" {
		return flags, errors.New("--executable is required")
	}
	if flags.scope != "market" && flags.scope != "installed" {
		return flags, fmt.Errorf("--scope must be market or installed, got %q", flags.scope)
	}
	return flags, nil
}

func runProbe(flags probeFlags) (probeReport, error) {
	report := probeReport{Scope: flags.scope}

	argv := []string{flags.executable, "provider"}
	if flags.apmPath != "" {
		argv = append(argv, "--apm-path", flags.apmPath)
	}
	if flags.userHome != "" {
		argv = append(argv, "--user-home", flags.userHome)
	}
	if flags.apcBaseURL != "" {
		argv = append(argv, "--apc-base-url", flags.apcBaseURL)
	}

	dataDir, err := os.MkdirTemp("", "provider-probe-")
	if err != nil {
		return report, err
	}
	defer os.RemoveAll(dataDir)

	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Env = []string{
		"LANG=C.UTF-8",
		"BIBIT_PROVIDER_PROTOCOL=1",
		"BIBIT_PROVIDER_DATA_DIR=" + dataDir,
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return report, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return report, err
	}
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		return report, fmt.Errorf("start provider: %w", err)
	}
	defer func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}()

	reader := bufio.NewReaderSize(stdout, 64*1024)

	initID := "probe-initialize"
	if _, err := fmt.Fprintf(stdin, "{\"jsonrpc\":\"2.0\",\"id\":%q,\"method\":\"bibit.initialize\",\"params\":{\"protocolName\":\"bibit-provider\",\"serviceId\":\"store\",\"supportedProtocolVersions\":[1]}}\n", initID); err != nil {
		return report, err
	}
	initLine, err := readBoundedLine(reader)
	if err != nil {
		return report, fmt.Errorf("read initialize response: %w", err)
	}
	protocolVersion, err := validateInitialize(initLine, initID)
	if err != nil {
		return report, err
	}
	report.ProtocolVersion = protocolVersion

	invokeID := "probe-invoke"
	wireInput := buildWireInput(flags)
	if _, err := fmt.Fprintf(stdin, "{\"jsonrpc\":\"2.0\",\"id\":%q,\"method\":\"bibit.invoke\",\"params\":{\"serviceId\":\"store\",\"operationId\":\"powers.list.v1\",\"params\":%s,\"timeoutMs\":30000}}\n", invokeID, wireInput); err != nil {
		return report, err
	}
	invokeLine, err := readBoundedLine(reader)
	if err != nil {
		return report, fmt.Errorf("read invoke response: %w", err)
	}
	report.RPCBytes = len(invokeLine) // the full serialized line, newline included
	report.RemainingBytes = maxRPCBytes - report.RPCBytes
	if err := fillInvokeReport(invokeLine, invokeID, &report); err != nil {
		return report, err
	}
	return report, nil
}

func buildWireInput(flags probeFlags) string {
	if flags.scope == "installed" {
		return fmt.Sprintf("{\"scope\":\"installed\",\"agent\":%q}", flags.agent)
	}
	if flags.knownSnapshot != "" {
		return fmt.Sprintf("{\"scope\":\"market\",\"knownSnapshot\":%q}", flags.knownSnapshot)
	}
	return `{"scope":"market"}`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  json.RawMessage `json:"result"`
	Error   *rpcError       `json:"error"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    *struct {
		Code string `json:"code"`
	} `json:"data,omitempty"`
}

type wireResult struct {
	Scope       string  `json:"scope"`
	Status      string  `json:"status"`
	ListJSON    *string `json:"listJson,omitempty"`
	Snapshot    string  `json:"snapshot,omitempty"`
	CatalogJSON *string `json:"catalogJson,omitempty"`
}

func parseResponse(line []byte) (rpcResponse, error) {
	var response rpcResponse
	if err := json.Unmarshal(bytes.TrimSpace(line), &response); err != nil {
		return response, errors.New("invalid response JSON")
	}
	return response, nil
}

func validateInitialize(line []byte, id string) (int, error) {
	response, err := parseResponse(line)
	if err != nil {
		return 0, err
	}
	if response.JSONRPC != "2.0" || string(response.ID) != quotedID(id) {
		return 0, errors.New("initialize response id mismatch")
	}
	if response.Error != nil {
		return 0, fmt.Errorf("initialize failed: %s", errorCode(response.Error))
	}
	var result struct {
		ProtocolVersion int `json:"protocolVersion"`
	}
	if err := json.Unmarshal(response.Result, &result); err != nil {
		return 0, errors.New("invalid initialize result")
	}
	if result.ProtocolVersion != 1 {
		return 0, fmt.Errorf("unexpected protocolVersion %d", result.ProtocolVersion)
	}
	return result.ProtocolVersion, nil
}

func fillInvokeReport(line []byte, id string, report *probeReport) error {
	response, err := parseResponse(line)
	if err != nil {
		return err
	}
	if response.JSONRPC != "2.0" || string(response.ID) != quotedID(id) {
		return errors.New("invoke response id mismatch")
	}
	if response.Error != nil {
		return fmt.Errorf("provider returned %s", errorCode(response.Error))
	}
	var result wireResult
	if err := json.Unmarshal(response.Result, &result); err != nil {
		return errors.New("invalid invoke result")
	}
	if result.Scope != report.Scope {
		return errors.New("result scope mismatch")
	}
	report.Status = result.Status
	switch result.Status {
	case "data":
		if result.Snapshot != "" {
			report.Snapshot = result.Snapshot
		}
		raw := result.ListJSON
		if result.CatalogJSON != nil {
			raw = result.CatalogJSON
		}
		if raw != nil {
			report.RawBytes = len(*raw)
		}
	case "not_modified":
		report.Snapshot = result.Snapshot
	default:
		return fmt.Errorf("unexpected status %q", result.Status)
	}
	return nil
}

func errorCode(err *rpcError) string {
	if err.Data != nil && err.Data.Code != "" {
		return err.Data.Code
	}
	return "unknown"
}

func quotedID(id string) string {
	encoded, _ := json.Marshal(id)
	return string(encoded)
}

func readBoundedLine(r *bufio.Reader) ([]byte, error) {
	var line []byte
	for {
		fragment, err := r.ReadSlice('\n')
		switch err {
		case nil:
			line = append(line, fragment...)
			if len(line) > maxRPCBytes {
				return nil, errors.New("response line exceeds 4 MiB")
			}
			return line, nil
		case bufio.ErrBufferFull:
			line = append(line, fragment...)
			if len(line) > maxRPCBytes {
				return nil, errors.New("response line exceeds 4 MiB")
			}
		case io.EOF:
			if len(fragment) > 0 {
				line = append(line, fragment...)
				return line, nil
			}
			return nil, io.EOF
		default:
			return nil, err
		}
	}
}
