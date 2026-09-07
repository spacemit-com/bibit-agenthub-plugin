package provider

// ProviderError is a platform error mapped onto the closed set of host codes.
// Code must be one of: cancelled, offline, timeout, unauthorized, incompatible,
// unavailable, provider_crashed, resource_exhausted, unknown.
type ProviderError struct {
	Code      string
	Retryable bool
}

func (e *ProviderError) Error() string {
	return platformMessage(e.Code)
}

// newProviderError builds a ProviderError from a closed-set code and computes
// its retryable flag from the platform convention.
func newProviderError(code string) *ProviderError {
	return &ProviderError{Code: code, Retryable: retryableCode(code)}
}

func retryableCode(code string) bool {
	switch code {
	case "offline", "timeout", "unavailable", "provider_crashed":
		return true
	default:
		return false
	}
}

// platformMessage returns the fixed, safe text for a closed-set platform code.
// It never echoes stderr, upstream bodies, URLs, paths or credentials.
func platformMessage(code string) string {
	switch code {
	case "cancelled":
		return "The service request was cancelled"
	case "offline":
		return "The service is offline"
	case "timeout":
		return "The service request timed out"
	case "unauthorized":
		return "The service rejected authorization"
	case "incompatible":
		return "The service request is incompatible"
	case "unavailable":
		return "The service is unavailable"
	case "provider_crashed":
		return "The service provider stopped unexpectedly"
	case "resource_exhausted":
		return "The service request exceeded a resource limit"
	default:
		return "The service request failed"
	}
}
