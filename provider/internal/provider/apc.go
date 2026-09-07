package provider

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
)

const (
	maxVersionBytes = 64 << 10 // 64 KiB, version body is tiny
	maxCatalogBytes = maxOutputBytes
)

type versionResponse struct {
	CatalogSHA256 string `json:"catalog_sha256"`
}

// NewHTTPClient builds the production HTTP client: default trusted CA roots, at
// most 5 redirects, and no HTTPS-to-HTTP downgrade. There is no option to skip
// TLS verification; tests inject a client that trusts their fixture instead.
func NewHTTPClient() *http.Client {
	return &http.Client{CheckRedirect: checkRedirect}
}

// checkRedirect enforces the redirect policy: at most 5 hops, and never a
// downgrade from https to http.
func checkRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= 5 {
		return errors.New("too many redirects")
	}
	if len(via) > 0 && via[0].URL.Scheme == "https" && req.URL.Scheme == "http" {
		return errors.New("refusing https to http downgrade")
	}
	return nil
}

// ReadMarket checks `resources/version` first; when catalog_sha256 equals
// knownSnapshot it returns not_modified without downloading `resources`.
// Otherwise it downloads the full catalog as original UTF-8 text (never
// re-serialized) alongside the version snapshot.
func ReadMarket(ctx context.Context, client *http.Client, baseURL, knownSnapshot string) (WireResult, error) {
	snapshot, err := fetchVersion(ctx, client, baseURL)
	if err != nil {
		return WireResult{}, err
	}
	if snapshot == knownSnapshot {
		return WireResult{Scope: "market", Status: "not_modified", Snapshot: snapshot}, nil
	}
	catalog, err := fetchCatalog(ctx, client, baseURL)
	if err != nil {
		return WireResult{}, err
	}
	return WireResult{Scope: "market", Status: "data", Snapshot: snapshot, CatalogJSON: &catalog}, nil
}

func fetchVersion(ctx context.Context, client *http.Client, baseURL string) (string, error) {
	body, err := getBody(ctx, client, baseURL+"/resources/version", maxVersionBytes)
	if err != nil {
		return "", err
	}
	var version versionResponse
	if err := json.Unmarshal(body, &version); err != nil {
		return "", newProviderError("unavailable")
	}
	if version.CatalogSHA256 == "" {
		return "", newProviderError("unavailable")
	}
	return version.CatalogSHA256, nil
}

func fetchCatalog(ctx context.Context, client *http.Client, baseURL string) (string, error) {
	body, err := getBody(ctx, client, baseURL+"/resources", maxCatalogBytes)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func getBody(ctx context.Context, client *http.Client, url string, limit int) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, newProviderError("unavailable")
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, mapHTTPError(ctx, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, mapHTTPStatus(resp.StatusCode)
	}
	body, err := readBoundedBytes(resp.Body, limit)
	if err != nil {
		return nil, mapReadError(err)
	}
	return body, nil
}

func mapHTTPError(ctx context.Context, err error) *ProviderError {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return newProviderError("timeout")
	}
	if ctx.Err() != nil {
		return newProviderError("cancelled")
	}
	return newProviderError("offline")
}

func mapHTTPStatus(status int) *ProviderError {
	switch status {
	case 401, 403:
		return newProviderError("unauthorized")
	case 408, 504:
		return newProviderError("timeout")
	case 426:
		return newProviderError("incompatible")
	default:
		return newProviderError("unavailable")
	}
}
