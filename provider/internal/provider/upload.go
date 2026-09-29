package provider

import (
	"context"
	"strings"
	"unicode/utf8"
)

const (
	// maxReasonBytes bounds the sanitized diagnostic echoed back to the page.
	maxReasonBytes = 300
	// maxRawReasonBytes bounds how much of the command output is inspected.
	maxRawReasonBytes = 8 << 10
)

// UploadCustomResource publishes one hand-installed resource to APC.
//
// The plugin never rewrites a resource to satisfy apm, so the flow is: run
// `apm validate` first and report its verdict verbatim (sanitized) when it
// fails, then `apm submit`. The APC credential comes from the persisted
// settings and is passed to the child as `APC_API_KEY`; it is never logged and
// never leaves this function.
func UploadCustomResource(ctx context.Context, cfg Config, target PowerTarget, message string) (UploadResult, error) {
	path, err := customResourcePathForUpload(cfg, target)
	if err != nil {
		return UploadResult{}, err
	}
	if strings.TrimSpace(message) == "" || !singleLineASCII(message) {
		return UploadResult{}, newProviderError("incompatible")
	}
	apiKey, err := SettingsAPIKey(cfg)
	if err != nil {
		return UploadResult{}, err
	}
	env, err := apmEnvironmentWithCredential(cfg, apiKey)
	if err != nil {
		return UploadResult{}, err
	}
	childCtx, cancel, err := writeChildContext(ctx)
	if err != nil {
		return UploadResult{}, err
	}
	defer cancel()

	validateOut, exitCode, err := runMutationWithOutput(childCtx, cfg.APMPath, env,
		"validate", path, "--type="+target.Type, "--json")
	if err != nil {
		return UploadResult{}, err
	}
	if exitCode != 0 {
		return UploadResult{
			Status:   "exited",
			ExitCode: exitCode,
			Reason:   failureReason(validateOut, apiKey),
			Stage:    "validate",
		}, nil
	}

	submitOut, exitCode, err := runMutationWithOutput(childCtx, cfg.APMPath, env,
		"submit", path, "--type="+target.Type, "--message="+message)
	if err != nil {
		return UploadResult{}, err
	}
	if exitCode != 0 {
		return UploadResult{
			Status:   "exited",
			ExitCode: exitCode,
			Reason:   failureReason(submitOut, apiKey),
			Stage:    "submit",
		}, nil
	}
	return UploadResult{
		Status:   "exited",
		ExitCode: 0,
		Stdout:   sanitizeReason(submitOut.stdout, apiKey),
		Stage:    "submit",
	}, nil
}

// failureReason picks the actionable sentence out of a failed write command.
//
// apm's own convention decides where that sentence lives: a *successful*
// `validate`/`submit` reports through stdout, while a *failed* one logs to
// stderr and leaves stdout empty. The stderr line is slog logfmt, so the value
// of its `error` attribute is the message without the logger prefix, the usage
// block and the Go error wrapping.
func failureReason(out mutationOutput, apiKey string) string {
	if reason := logfmtAttribute(out.stderr, "error"); reason != "" {
		return sanitizeReason(reason, apiKey)
	}
	if trimmed := strings.TrimSpace(out.stdout); trimmed != "" {
		return sanitizeReason(trimmed, apiKey)
	}
	return sanitizeReason(out.stderr, apiKey)
}

// logfmtAttribute reads one quoted attribute out of a slog logfmt line. apm
// logs `level=ERROR msg="command failed" error="…"`, and the error value uses
// Go's `%q` escaping, so the naive key=value split is not enough.
func logfmtAttribute(line, key string) string {
	for _, field := range strings.Split(line, "\n") {
		marker := key + "=\""
		start := strings.Index(field, marker)
		if start < 0 {
			continue
		}
		// Walk the quoted value so escaped quotes inside it do not end it early.
		value := field[start+len(marker):]
		var builder strings.Builder
		closed := false
		for index := 0; index < len(value); index++ {
			character := value[index]
			if character == '\\' && index+1 < len(value) {
				unescaped, size := unescapeQuoted(value[index:])
				builder.WriteString(unescaped)
				index += size - 1
				continue
			}
			if character == '"' {
				closed = true
				break
			}
			builder.WriteByte(character)
		}
		if !closed {
			continue
		}
		return strings.TrimSpace(builder.String())
	}
	return ""
}

// unescapeQuoted resolves one backslash escape of a Go quoted string and
// reports how many source bytes it consumed.
func unescapeQuoted(value string) (string, int) {
	switch value[1] {
	case 'n':
		return "\n", 2
	case 't':
		return "\t", 2
	case 'r':
		return "\r", 2
	case '"':
		return "\"", 2
	case '\\':
		return "\\", 2
	default:
		return value[1:2], 2
	}
}

// singleLineASCII keeps the publish message a plain argument: apm receives it
// as one argv element, and a control character or newline would end up in the
// published metadata.
func singleLineASCII(value string) bool {
	if !utf8.ValidString(value) || len(value) > 200 {
		return false
	}
	for _, character := range value {
		if character < 0x20 || character == 0x7f {
			return false
		}
	}
	return true
}

// apmEnvironmentWithCredential extends the explicit apm environment with the
// APC credential. APC_BASE_URL is only set when the Registry pinned a root, so
// the default keeps using apm's own production endpoint.
func apmEnvironmentWithCredential(cfg Config, apiKey string) ([]string, error) {
	env, err := APMEnvironment(cfg)
	if err != nil {
		return nil, err
	}
	env = append(env, "APC_API_KEY="+apiKey)
	if root := strings.TrimSpace(cfg.APCRootURL); root != "" {
		env = append(env, "APC_BASE_URL="+root)
	}
	return env, nil
}

// sanitizeReason turns raw command output into a short, single-line, credential
// -free diagnostic. Command output is untrusted data: it may contain the API
// key (apm echoes rejected credentials in some paths), ANSI colouring, carriage
// returns and very long lines, none of which may reach the UI or a log.
func sanitizeReason(output, apiKey string) string {
	trimmed := output
	if len(trimmed) > maxRawReasonBytes {
		trimmed = truncateUTF8(trimmed, maxRawReasonBytes)
	}
	if apiKey != "" {
		trimmed = strings.ReplaceAll(trimmed, apiKey, "***")
	}
	var builder strings.Builder
	builder.Grow(len(trimmed))
	spacePending := false
	for index := 0; index < len(trimmed); {
		character, size := utf8.DecodeRuneInString(trimmed[index:])
		index += size
		// Drop ANSI escape sequences whole, so removing the ESC byte does not
		// leave `[31m` behind in the message the user reads.
		if character == 0x1b && strings.HasPrefix(trimmed[index:], "[") {
			if end := ansiSequenceEnd(trimmed[index:]); end >= 0 {
				index += end
				continue
			}
		}
		if character == '\n' || character == '\r' || character == '\t' {
			spacePending = builder.Len() > 0
			continue
		}
		if character < 0x20 || character == 0x7f {
			continue
		}
		if spacePending {
			builder.WriteByte(' ')
			spacePending = false
		}
		builder.WriteRune(character)
		// The budget is in bytes; WriteRune only ever emits whole runes, so the
		// result stays valid UTF-8 and is at most three bytes over.
		if builder.Len() >= maxReasonBytes {
			break
		}
	}
	return strings.TrimSpace(builder.String())
}

// ansiSequenceEnd returns the byte length of a CSI sequence body starting at
// "[", or -1 when the text only looks like one.
func ansiSequenceEnd(value string) int {
	for index := 1; index < len(value) && index < 32; index++ {
		character := value[index]
		switch {
		case character >= '0' && character <= '9':
		case character == ';' || character == '?':
		default:
			if character >= 0x40 && character <= 0x7e {
				return index + 1
			}
			return -1
		}
	}
	return -1
}

// truncateUTF8 cuts a string at a byte budget without splitting a rune.
func truncateUTF8(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	cut := value[:limit]
	for len(cut) > 0 && !utf8.ValidString(cut) {
		cut = cut[:len(cut)-1]
	}
	return cut
}
