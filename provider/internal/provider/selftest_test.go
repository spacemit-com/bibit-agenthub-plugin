package provider

import "testing"

func TestSelfTestPasses(t *testing.T) {
	if err := SelfTest(); err != nil {
		t.Fatalf("SelfTest must pass: %v", err)
	}
}
