package provider

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func mustParseURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

type apcTracker struct {
	versionCalls int
	catalogCalls int
	urls         []string
	snapshot     string
	catalog      string
	versionCode  int
}

func newAPCServer(t *testing.T, tracker *apcTracker) *httptest.Server {
	t.Helper()
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tracker.urls = append(tracker.urls, r.URL.String())
		switch r.URL.Path {
		case "/resources/version":
			tracker.versionCalls++
			if tracker.versionCode != 0 && tracker.versionCode != 200 {
				w.WriteHeader(tracker.versionCode)
				return
			}
			fmt.Fprintf(w, `{"catalog_sha256":%q}`, tracker.snapshot)
		case "/resources":
			tracker.catalogCalls++
			io.WriteString(w, tracker.catalog)
		default:
			http.NotFound(w, r)
		}
	}))
	server.Config.ErrorLog = log.New(io.Discard, "", 0)
	server.StartTLS()
	t.Cleanup(server.Close)
	return server
}

func TestReadMarketNotModified(t *testing.T) {
	tracker := &apcTracker{snapshot: "same", catalog: "should-not-be-fetched"}
	server := newAPCServer(t, tracker)

	result, err := ReadMarket(context.Background(), server.Client(), server.URL, "same")
	if err != nil {
		t.Fatal(err)
	}
	if result.Scope != "market" || result.Status != "not_modified" || result.Snapshot != "same" {
		t.Fatalf("unexpected result: %+v", result)
	}
	if tracker.versionCalls != 1 {
		t.Fatalf("version must be called once, got %d", tracker.versionCalls)
	}
	if tracker.catalogCalls != 0 {
		t.Fatalf("catalog must not be downloaded on not_modified, got %d calls", tracker.catalogCalls)
	}
}

func TestReadMarketDownloadOnChange(t *testing.T) {
	catalog := `{"skills":{"items":[{"name":"demo","version":"v1.0.0"}]}}`
	tracker := &apcTracker{snapshot: "new", catalog: catalog}
	server := newAPCServer(t, tracker)

	result, err := ReadMarket(context.Background(), server.Client(), server.URL, "old")
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "data" || result.Snapshot != "new" {
		t.Fatalf("unexpected result: %+v", result)
	}
	if result.CatalogJSON == nil || *result.CatalogJSON != catalog {
		t.Fatalf("catalog text not preserved: %q", *result.CatalogJSON)
	}
	if tracker.versionCalls != 1 || tracker.catalogCalls != 1 {
		t.Fatalf("expected 1 version + 1 catalog call, got %d/%d", tracker.versionCalls, tracker.catalogCalls)
	}
}

func TestReadMarketFirstLoad(t *testing.T) {
	tracker := &apcTracker{snapshot: "v1", catalog: "{}"}
	server := newAPCServer(t, tracker)

	result, err := ReadMarket(context.Background(), server.Client(), server.URL, "")
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "data" || result.Snapshot != "v1" {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestReadMarketUntrustedCertRejected(t *testing.T) {
	tracker := &apcTracker{snapshot: "v1", catalog: "{}"}
	server := newAPCServer(t, tracker)

	_, err := ReadMarket(context.Background(), NewHTTPClient(), server.URL, "")
	if err == nil {
		t.Fatal("expected untrusted certificate to be rejected")
	}
	if _, ok := err.(*ProviderError); !ok {
		t.Fatalf("expected *ProviderError, got %T: %v", err, err)
	}
}

func TestReadMarketNon2xx(t *testing.T) {
	tracker := &apcTracker{snapshot: "v1", catalog: "{}", versionCode: 503}
	server := newAPCServer(t, tracker)

	_, err := ReadMarket(context.Background(), server.Client(), server.URL, "")
	assertProviderError(t, err, "unavailable")
}

func TestReadMarketOverLimit(t *testing.T) {
	tracker := &apcTracker{snapshot: "new", catalog: strings.Repeat("x", maxCatalogBytes+1)}
	server := newAPCServer(t, tracker)

	_, err := ReadMarket(context.Background(), server.Client(), server.URL, "old")
	assertProviderError(t, err, "resource_exhausted")
}

func TestReadMarketEmptySnapshot(t *testing.T) {
	tracker := &apcTracker{snapshot: "", catalog: "{}"}
	server := newAPCServer(t, tracker)

	_, err := ReadMarket(context.Background(), server.Client(), server.URL, "")
	assertProviderError(t, err, "unavailable")
}

func TestReadMarketKnownSnapshotNotInURL(t *testing.T) {
	tracker := &apcTracker{snapshot: "secret-snapshot-value", catalog: "{}"}
	server := newAPCServer(t, tracker)

	if _, err := ReadMarket(context.Background(), server.Client(), server.URL, "secret-snapshot-value"); err != nil {
		t.Fatal(err)
	}
	for _, u := range tracker.urls {
		if strings.Contains(u, "secret-snapshot-value") {
			t.Fatalf("knownSnapshot leaked into upstream URL: %s", u)
		}
		if strings.Contains(u, "?") {
			t.Fatalf("upstream URL must not carry a query string: %s", u)
		}
	}
}

func TestCheckRedirectDowngrade(t *testing.T) {
	req := &http.Request{URL: mustParseURL(t, "http://plain.example/resource")}
	via := []*http.Request{{URL: mustParseURL(t, "https://secure.example/")}}
	if err := checkRedirect(req, via); err == nil {
		t.Fatal("https to http downgrade must be rejected")
	}
}

func TestCheckRedirectAllowsHTTPS(t *testing.T) {
	req := &http.Request{URL: mustParseURL(t, "https://cdn.example/resource")}
	via := []*http.Request{{URL: mustParseURL(t, "https://secure.example/")}}
	if err := checkRedirect(req, via); err != nil {
		t.Fatalf("https to https redirect must be allowed: %v", err)
	}
}

func TestCheckRedirectTooMany(t *testing.T) {
	via := make([]*http.Request, 5)
	for i := range via {
		via[i] = &http.Request{URL: mustParseURL(t, fmt.Sprintf("https://h%d.example/", i))}
	}
	req := &http.Request{URL: mustParseURL(t, "https://h5.example/")}
	if err := checkRedirect(req, via); err == nil {
		t.Fatal("too many redirects must be rejected")
	}
}
