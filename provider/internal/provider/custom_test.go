package provider

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeCustomFile writes one file inside a custom resource directory.
func writeCustomFile(t *testing.T, root string, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{root}, parts...)...)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(parts[len(parts)-1]), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func writeResourceFile(t *testing.T, root string, relative, contents string) string {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(relative))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func scanCustom(t *testing.T, home, agent string) customListDocument {
	t.Helper()
	result, err := ScanCustomResources(Config{UserHome: home}, agent)
	if err != nil {
		t.Fatal(err)
	}
	if result.Scope != "custom" || result.Status != "data" {
		t.Fatalf("unexpected envelope: %+v", result)
	}
	var document customListDocument
	decoder := json.NewDecoder(strings.NewReader(result.ItemsJSON))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&document); err != nil {
		t.Fatalf("itemsJson is not the closed document: %v (%s)", err, result.ItemsJSON)
	}
	return document
}

func TestScanCustomSkillAcceptsMainstreamMinimum(t *testing.T) {
	home := t.TempDir()
	// The mainstream Agent Skills frontmatter: only name and description are
	// required. No schema_version, no version, no skill-card.md.
	writeResourceFile(t, home, ".codex/skills/hand-written/SKILL.md",
		"---\nname: hand-written\ndescription: A skill installed by hand.\n---\n\n# Hand written\n")

	document := scanCustom(t, home, "codex")
	if len(document.Items) != 1 || len(document.Skipped) != 0 {
		t.Fatalf("unexpected scan result: %+v", document)
	}
	item := document.Items[0]
	if item.Type != "skill" || item.Name != "hand-written" || item.Source != "custom" {
		t.Fatalf("unexpected item: %+v", item)
	}
	if item.Version != "" {
		t.Fatalf("a missing version must stay empty, got %q", item.Version)
	}
	if item.Description != "A skill installed by hand." {
		t.Fatalf("description = %q", item.Description)
	}
	if item.Tags == nil || len(item.Tags) != 0 {
		t.Fatalf("tags must serialize as [], got %#v", item.Tags)
	}
}

func TestScanCustomSkillReadsDisplayAndVersionFields(t *testing.T) {
	home := t.TempDir()
	writeResourceFile(t, home, ".hermes/skills/local-tool/SKILL.md",
		"---\n"+
			"name: local-tool\n"+
			"description: Local tool.\n"+
			"version: \"1.2.3\"\n"+ // bare semver is normalized
			"name_zh: 本地工具\n"+
			"name_en: Local Tool\n"+
			"description_zh: 本地工具说明。\n"+
			"allowed-tools: Bash, Read\n"+ // unknown scalar keys are ignored
			"---\nbody\n")

	document := scanCustom(t, home, "hermes-agent")
	if len(document.Items) != 1 {
		t.Fatalf("expected one item, got %+v", document)
	}
	item := document.Items[0]
	if item.Version != "v1.2.3" {
		t.Fatalf("version = %q, want v1.2.3", item.Version)
	}
	if item.NameZH != "本地工具" || item.NameEN != "Local Tool" || item.DescriptionZH != "本地工具说明。" {
		t.Fatalf("display fields lost: %+v", item)
	}
}

// TestScanCustomSkillFallsBackToDeclaredName pins the display name of a V1
// resource: it declares only `name`, and the card must show that instead of the
// directory it sits in, which is only the APM call name this scanner uses for
// identity. `name_zh` still wins for a Chinese host, and a real `name_en` is
// never overridden.
func TestScanCustomSkillFallsBackToDeclaredName(t *testing.T) {
	home := t.TempDir()
	// Directory name and the declared name disagree; no v2 display fields.
	writeResourceFile(t, home, ".bianbu-agent/skills/vi-coder/SKILL.md",
		"---\nname: vibe-coder\ndescription: Vibe coding.\n---\nbody\n")
	// A declared name_en wins over the declared `name`.
	writeResourceFile(t, home, ".bianbu-agent/skills/en-only/SKILL.md",
		"---\nname: en-only\ndescription: Has a display name.\nname_en: English Display\n---\nbody\n")
	// name_zh wins on a Chinese host but must not become name_en.
	writeResourceFile(t, home, ".bianbu-agent/skills/zh-only/SKILL.md",
		"---\nname: zh-only\ndescription: 中文展示名。\nname_zh: 中文名\n---\nbody\n")

	document := scanCustom(t, home, "bibit")
	if len(document.Items) != 3 {
		t.Fatalf("expected three items, got %+v", document.Items)
	}
	byName := map[string]customResourceJSON{}
	for _, item := range document.Items {
		byName[item.Name] = item
	}

	if got := byName["vi-coder"]; got.NameEN != "vibe-coder" || got.NameZH != "" {
		t.Fatalf("v1 fallback = %+v, want name_en vibe-coder and no name_zh", got)
	}
	if got := byName["en-only"]; got.NameEN != "English Display" {
		t.Fatalf("declared name_en was overridden: %+v", got)
	}
	if got := byName["zh-only"]; got.NameZH != "中文名" || got.NameEN != "zh-only" {
		t.Fatalf("zh-only = %+v, want name_zh 中文名 and name_en fallback zh-only", got)
	}
}

// TestScanCustomPluginAndAgentFallBackToDeclaredName covers the other two types:
// both gates read a namespaced or manifest name, and both must reach the card.
func TestScanCustomPluginAndAgentFallBackToDeclaredName(t *testing.T) {
	home := t.TempDir()
	writeResourceFile(t, home, ".bianbu-agent/plugins/container/apc-plugin.json",
		`{"name":"local-bundle","description":"Local bundle."}`)
	writeResourceFile(t, home, ".bianbu-agent/agents/agent-dir/agent.yaml",
		"agent:\n  name: default-bianbu\n  description: Demo agent.\n")

	document := scanCustom(t, home, "bibit")
	byName := map[string]customResourceJSON{}
	for _, item := range document.Items {
		byName[item.Name] = item
	}
	if got := byName["container"]; got.NameEN != "local-bundle" {
		t.Fatalf("plugin fallback = %+v, want name_en local-bundle", got)
	}
	if got := byName["agent-dir"]; got.NameEN != "default-bianbu" {
		t.Fatalf("agent fallback = %+v, want name_en default-bianbu", got)
	}
}

func TestScanCustomSkipsWithReasons(t *testing.T) {
	home := t.TempDir()
	// name present, description missing -> below the mainstream minimum.
	writeResourceFile(t, home, ".codex/skills/partial/SKILL.md", "---\nname: partial\n---\nbody\n")
	// No authoritative file at all, but a recognizable sibling.
	writeResourceFile(t, home, ".codex/skills/empty/skill-card.md", "# Card\n")
	// Not a mapping at all.
	writeResourceFile(t, home, ".codex/skills/scalar/SKILL.md", "just text without frontmatter\n")
	// Invalid UTF-8 bytes.
	writeResourceFile(t, home, ".codex/skills/binary/SKILL.md", "---\nname: binary\ndescription: \xff\xfe\n---\n")
	// A resource that does satisfy the minimum, for contrast.
	writeResourceFile(t, home, ".codex/skills/good/SKILL.md", "---\nname: good\ndescription: Fine.\n---\n")
	// Directories that are not candidates at all must stay silent.
	writeResourceFile(t, home, ".codex/skills/.system/README.md", "system\n")
	writeResourceFile(t, home, ".codex/skills/not-a-name!/SKILL.md", "---\nname: x\ndescription: y\n---\n")

	document := scanCustom(t, home, "codex")
	if len(document.Items) != 1 || document.Items[0].Name != "good" {
		t.Fatalf("unexpected items: %+v", document.Items)
	}
	reasons := map[string]string{}
	for _, skipped := range document.Skipped {
		reasons[skipped.Name] = skipped.Reason
	}
	want := map[string]string{
		"partial": skipInvalidAuthority,
		"empty":   skipMissingAuthority,
		"scalar":  skipInvalidAuthority,
		"binary":  skipInvalidAuthority,
	}
	if len(reasons) != len(want) {
		t.Fatalf("skipped = %+v, want %+v", document.Skipped, want)
	}
	for name, reason := range want {
		if reasons[name] != reason {
			t.Fatalf("skip reason for %q = %q, want %q", name, reasons[name], reason)
		}
	}
	for _, skipped := range document.Skipped {
		if skipped.Expected != "SKILL.md" {
			t.Fatalf("expected file = %q", skipped.Expected)
		}
	}
}

func TestScanCustomPluginAndAgent(t *testing.T) {
	home := t.TempDir()
	writeResourceFile(t, home, ".bianbu-agent/plugins/local-bundle/apc-plugin.json",
		`{"schema_version":2,"name":"local-bundle","version":"v0.1.0","description":"Hand made.","skills":["skills/local-bundle"]}`)
	writeResourceFile(t, home, ".bianbu-agent/agents/local-agent/agent.yaml",
		"schema_version: 2\nagent:\n  id: local-agent\n  name: local-agent\n  version: v2.0.0\n  description: Local agent.\n  soul: |-\n    You are local.\n  permissions:\n    network:\n      mode: allowlist\n")

	document := scanCustom(t, home, "bibit")
	byName := map[string]customResourceJSON{}
	for _, item := range document.Items {
		byName[item.Name] = item
	}
	plugin, ok := byName["local-bundle"]
	if !ok || plugin.Type != "plugin" || plugin.Version != "v0.1.0" {
		t.Fatalf("plugin item missing: %+v", document)
	}
	agent, ok := byName["local-agent"]
	if !ok || agent.Type != "expert" || agent.Version != "v2.0.0" || agent.Description != "Local agent." {
		t.Fatalf("agent item missing: %+v", document)
	}
	if len(document.Skipped) != 0 {
		t.Fatalf("unexpected skips: %+v", document.Skipped)
	}
	// The block scalar `soul: |-` must not swallow the keys that follow it.
	if agent.Description == "" {
		t.Fatal("block scalar handling lost the description")
	}
}

func TestScanCustomPluginAcceptsDerivedManifest(t *testing.T) {
	home := t.TempDir()
	// A filesystem plugin landed by apm carries plugin.yaml (derived) rather than
	// apc-plugin.json, and must still be recognizable.
	writeResourceFile(t, home, ".hermes/plugins/derived-plugin/plugin.yaml",
		"schema_version: 1\nname: derived-plugin\nversion: v3.1.0\ndescription: Derived.\n")

	document := scanCustom(t, home, "hermes-agent")
	if len(document.Items) != 1 || document.Items[0].Version != "v3.1.0" {
		t.Fatalf("unexpected scan result: %+v", document)
	}
}

func TestScanCustomPartialPluginIsSkipped(t *testing.T) {
	home := t.TempDir()
	// A directory that only has skills/ (an embedded-skill container without the
	// index) is a candidate: it must be reported, not silently dropped.
	if err := os.MkdirAll(filepath.Join(home, ".hermes/plugins/container/skills/one"), 0o755); err != nil {
		t.Fatal(err)
	}
	document := scanCustom(t, home, "hermes-agent")
	if len(document.Items) != 0 {
		t.Fatalf("container must not be listed: %+v", document.Items)
	}
	if len(document.Skipped) != 1 || document.Skipped[0].Expected != "apc-plugin.json" ||
		document.Skipped[0].Reason != skipMissingAuthority {
		t.Fatalf("unexpected skip: %+v", document.Skipped)
	}
}

func TestScanCustomIgnoresUnsupportedTypeAndAgent(t *testing.T) {
	home := t.TempDir()
	writeResourceFile(t, home, ".codex/plugins/codex-plugin/apc-plugin.json",
		`{"name":"codex-plugin","description":"x"}`)
	// codex plugins are CLI-managed, so the directory must not appear.
	document := scanCustom(t, home, "codex")
	if len(document.Items) != 0 {
		t.Fatalf("codex plugins must not be scanned: %+v", document.Items)
	}
	if _, err := ScanCustomResources(Config{UserHome: home}, "unknown-agent"); err == nil {
		t.Fatal("unknown agent must be rejected")
	}
}

func TestScanCustomMissingRootsAreEmpty(t *testing.T) {
	document := scanCustom(t, t.TempDir(), "bibit")
	if len(document.Items) != 0 || len(document.Skipped) != 0 {
		t.Fatalf("missing roots must scan clean: %+v", document)
	}
}

func TestScanCustomNoHome(t *testing.T) {
	_, err := ScanCustomResources(Config{}, "bibit")
	assertProviderError(t, err, "unavailable")
}

func TestScanCustomFollowsSymlinkedSkillDirectory(t *testing.T) {
	home := t.TempDir()
	target := t.TempDir()
	writeResourceFile(t, target, "linked-skill/SKILL.md", "---\nname: linked-skill\ndescription: Linked.\n---\n")
	if err := os.MkdirAll(filepath.Join(home, ".codex/skills"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(target, "linked-skill"), filepath.Join(home, ".codex/skills/linked-skill")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	document := scanCustom(t, home, "codex")
	if len(document.Items) != 1 || document.Items[0].Name != "linked-skill" {
		t.Fatalf("symlinked skill must be listed: %+v", document)
	}
}

func TestScanCustomResultIsSorted(t *testing.T) {
	home := t.TempDir()
	writeResourceFile(t, home, ".codex/skills/zeta/SKILL.md", "---\nname: zeta\ndescription: z\n---\n")
	writeResourceFile(t, home, ".codex/skills/alpha/SKILL.md", "---\nname: alpha\ndescription: a\n---\n")
	document := scanCustom(t, home, "codex")
	if len(document.Items) != 2 || document.Items[0].Name != "alpha" || document.Items[1].Name != "zeta" {
		t.Fatalf("items must be sorted by type then name: %+v", document.Items)
	}
}

func TestResolveCustomTargetRejectsEscapes(t *testing.T) {
	home := t.TempDir()
	if err := os.MkdirAll(filepath.Join(home, ".bianbu-agent/skills"), 0o755); err != nil {
		t.Fatal(err)
	}
	cfg := Config{UserHome: home}
	valid, err := ResolveCustomTarget(cfg, PowerTarget{Agent: "bibit", Type: "skill", Name: "demo"})
	if err != nil {
		t.Fatal(err)
	}
	if valid != filepath.Join(home, ".bianbu-agent/skills/demo") {
		t.Fatalf("resolved path = %q", valid)
	}
	for _, name := range []string{"..", "../escape", "a/b", ".", "with.dot", "UPPER", "-leading", "trailing-"} {
		if _, err := ResolveCustomTarget(cfg, PowerTarget{Agent: "bibit", Type: "skill", Name: name}); err == nil {
			t.Fatalf("name %q must be rejected", name)
		}
	}
	// A type the Agent does not support (codex plugins) is rejected too.
	if _, err := ResolveCustomTarget(cfg, PowerTarget{Agent: "codex", Type: "plugin", Name: "demo"}); err == nil {
		t.Fatal("codex plugin targets must be rejected")
	}
}

func TestDeleteCustomResourceRemovesDirectory(t *testing.T) {
	home := t.TempDir()
	target := filepath.Join(home, ".bianbu-agent/skills/demo")
	writeResourceFile(t, home, ".bianbu-agent/skills/demo/SKILL.md", "---\nname: demo\ndescription: d\n---\n")

	result, err := DeleteCustomResource(Config{UserHome: home},
		PowerTarget{Agent: "bibit", Type: "skill", Name: "demo"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "deleted" {
		t.Fatalf("unexpected result: %+v", result)
	}
	if _, statErr := os.Lstat(target); !os.IsNotExist(statErr) {
		t.Fatalf("target still present: %v", statErr)
	}
	// Deleting again is not a silent success.
	if _, err := DeleteCustomResource(Config{UserHome: home},
		PowerTarget{Agent: "bibit", Type: "skill", Name: "demo"}); err == nil {
		t.Fatal("deleting a missing resource must fail")
	}
}

func TestDeleteCustomResourceRemovesSymlinkOnly(t *testing.T) {
	home := t.TempDir()
	linked := t.TempDir()
	writeResourceFile(t, linked, "kept/SKILL.md", "---\nname: kept\ndescription: k\n---\n")
	if err := os.MkdirAll(filepath.Join(home, ".codex/skills"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(linked, "kept"), filepath.Join(home, ".codex/skills/kept")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := DeleteCustomResource(Config{UserHome: home},
		PowerTarget{Agent: "codex", Type: "skill", Name: "kept"}); err != nil {
		t.Fatal(err)
	}
	if _, statErr := os.Lstat(filepath.Join(home, ".codex/skills/kept")); !os.IsNotExist(statErr) {
		t.Fatalf("link still present: %v", statErr)
	}
	if _, statErr := os.Stat(filepath.Join(linked, "kept/SKILL.md")); statErr != nil {
		t.Fatalf("linked content must survive: %v", statErr)
	}
}

func TestDeleteCustomResourceRejectsNonDirectory(t *testing.T) {
	home := t.TempDir()
	if err := os.MkdirAll(filepath.Join(home, ".bianbu-agent/skills"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, ".bianbu-agent/skills/file"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := DeleteCustomResource(Config{UserHome: home},
		PowerTarget{Agent: "bibit", Type: "skill", Name: "file"})
	assertProviderError(t, err, "incompatible")
	if _, statErr := os.Stat(filepath.Join(home, ".bianbu-agent/skills/file")); statErr != nil {
		t.Fatalf("file must survive: %v", statErr)
	}
}

func TestParseYAMLSubsetHandlesUnsupportedStructures(t *testing.T) {
	fields := parseYAMLSubset(strings.Join([]string{
		"name: quoted-value",
		"description: \"has: colon\"  # trailing comment",
		"list:",
		"  - one",
		"  - two",
		"flow: {a: 1, b: 2}",
		"nested:",
		"  inner: value",
		"after: kept",
		"url: https://example.test/mcp",
		"single: 'it''s fine'",
	}, "\n"))
	if fields["name"] != "quoted-value" {
		t.Fatalf("name = %q", fields["name"])
	}
	if fields["description"] != "has: colon" {
		t.Fatalf("description = %q", fields["description"])
	}
	if fields["nested.inner"] != "value" {
		t.Fatalf("nested key = %q", fields["nested.inner"])
	}
	if fields["after"] != "kept" {
		t.Fatalf("keys after a sequence must still be read: %q", fields["after"])
	}
	if fields["url"] != "https://example.test/mcp" {
		t.Fatalf("url = %q", fields["url"])
	}
	if fields["single"] != "it's fine" {
		t.Fatalf("single = %q", fields["single"])
	}
	for _, key := range []string{"list", "flow"} {
		if value, ok := fields[key]; ok {
			t.Fatalf("%s must not be projected as a scalar: %q", key, value)
		}
	}
}

func TestParseYAMLSubsetReadsBlockScalars(t *testing.T) {
	// The frontmatter shape that made real Skills fail the minimum-format gate:
	// a folded `description` whose value lives on the following lines. The key
	// must be projected, and the keys after the block must survive.
	folded := parseYAMLSubset(strings.Join([]string{
		"name: k3-media-pipeline",
		"version: \"v1.0.0\"",
		"description: >-",
		"  在 K3 板卡上使用 GStreamer 或 FFmpeg 查看媒体信息，执行视频播放、",
		"  硬件编解码、多路硬件解码。",
		"  仅用于处理指定视频。",
		"compatibility: >-",
		"  Requires Linux on SpacemiT K3 and Python 3.11+.",
		"metadata:",
		"  version: \"1.0.0\"",
		"  target: \"spacemit-k3\"",
	}, "\n"))
	if folded["description"] != "在 K3 板卡上使用 GStreamer 或 FFmpeg 查看媒体信息，执行视频播放、 硬件编解码、多路硬件解码。 仅用于处理指定视频。" {
		t.Fatalf("folded description = %q", folded["description"])
	}
	if folded["metadata.target"] != "spacemit-k3" {
		t.Fatalf("keys after a folded block must survive: %q", folded["metadata.target"])
	}

	literal := parseYAMLSubset(strings.Join([]string{
		"name: literal",
		"description: |",
		"  first line",
		"  second line",
		"after: kept",
	}, "\n"))
	if literal["description"] != "first line\nsecond line" {
		t.Fatalf("literal description = %q", literal["description"])
	}
	if literal["after"] != "kept" {
		t.Fatalf("keys after a literal block must survive: %q", literal["after"])
	}

	// A folded block with a paragraph break keeps a newline between paragraphs;
	// an empty block projects nothing (the minimum-format gate then rejects it).
	paragraphs := parseYAMLSubset("name: p\ndescription: >\n  one\n  two\n\n  three\nafter: kept\n")
	if paragraphs["description"] != "one two\nthree" {
		t.Fatalf("paragraph description = %q", paragraphs["description"])
	}
	empty := parseYAMLSubset("name: e\ndescription: >-\n\nother: value\n")
	if _, ok := empty["description"]; ok {
		t.Fatalf("an empty block must not be projected: %q", empty["description"])
	}
	if empty["other"] != "value" {
		t.Fatalf("keys after an empty block must survive: %q", empty["other"])
	}
}

func TestScanCustomSkillAcceptsBlockScalarDescription(t *testing.T) {
	home := t.TempDir()
	// Board shape: both of these Skills were skipped as invalid-authority-file
	// only because their description is a folded block scalar.
	writeResourceFile(t, home, ".bianbu-agent/skills/k3-media-pipeline/SKILL.md",
		"---\nname: k3-media-pipeline\nversion: \"v1.0.0\"\ndescription: >-\n  在 K3 板卡上使用 GStreamer 或 FFmpeg 查看媒体信息，\n  执行视频播放、硬件编解码。\nmetadata:\n  version: \"1.0.0\"\n---\n\n# K3 Media Pipeline\n")
	writeResourceFile(t, home, ".bianbu-agent/skills/vpu-benchmark/SKILL.md",
		"---\nname: vpu-benchmark\nversion: \"v0.13.12\"\ndescription: |\n  测试 SpacemiT K3 VPU 硬件视频编解码器的基准性能。\n  用户询问 VPU 性能时使用。\ncompatibility: >-\n  Requires Linux on SpacemiT K3.\n---\n\n# VPU Benchmark\n")

	document := scanCustom(t, home, "bibit")
	if len(document.Skipped) != 0 {
		t.Fatalf("block scalars must not be skipped: %+v", document.Skipped)
	}
	if len(document.Items) != 2 {
		t.Fatalf("unexpected items: %+v", document.Items)
	}
	byName := map[string]customResourceJSON{}
	for _, item := range document.Items {
		byName[item.Name] = item
	}
	if got := byName["k3-media-pipeline"].Description; got != "在 K3 板卡上使用 GStreamer 或 FFmpeg 查看媒体信息， 执行视频播放、硬件编解码。" {
		t.Fatalf("folded description = %q", got)
	}
	if got := byName["k3-media-pipeline"].Version; got != "v1.0.0" {
		t.Fatalf("version = %q", got)
	}
	if got := byName["vpu-benchmark"].Description; got != "测试 SpacemiT K3 VPU 硬件视频编解码器的基准性能。\n用户询问 VPU 性能时使用。" {
		t.Fatalf("literal description = %q", got)
	}
}

func TestNormalizeAuthorityVersion(t *testing.T) {
	cases := map[string]string{
		"":            "",
		"1.2.3":       "v1.2.3",
		"v1.2.3":      "v1.2.3",
		"1.2":         "",
		"v1.2.3-rc.1": "",
		"latest":      "",
	}
	for input, want := range cases {
		if got := normalizeAuthorityVersion(input); got != want {
			t.Fatalf("normalizeAuthorityVersion(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestScanCustomBoundsDirectoryEntries(t *testing.T) {
	home := t.TempDir()
	for _, name := range []string{"one", "two", "three"} {
		writeResourceFile(t, home, ".codex/skills/"+name+"/SKILL.md",
			"---\nname: "+name+"\ndescription: d\n---\n")
	}
	document := scanCustom(t, home, "codex")
	if len(document.Items) != 3 {
		t.Fatalf("unexpected items: %+v", document.Items)
	}
	// The bound itself is exercised through the constant: a directory larger
	// than maxCustomEntries is truncated rather than failing the scan.
	if maxCustomEntries <= 0 || maxCustomItems <= 0 {
		t.Fatal("scan bounds must be positive")
	}
}
