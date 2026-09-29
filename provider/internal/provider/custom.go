package provider

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Custom resources are Powers the user installed by hand into an Agent's own
// directory tree instead of through Agent Hub. They are discovered by scanning
// the exact directories apm's adapters install into, so the same directory can
// hold both Hub-managed and hand-managed Powers; the frontend removes the ones
// apm already reports.
//
// Two different bars apply and must not be confused:
//
//   - Display uses the mainstream minimum format of each Power type (any
//     version of the format). A resource that does not clear that bar is
//     skipped with a readable reason, because showing a card for something the
//     Agent cannot actually load would be worse than showing nothing.
//   - Upload goes through `apm validate` + `apm submit`, so it keeps apm's own
//     (v2-only) requirements. The plugin never rewrites a resource to make it
//     uploadable; it reports what apm said.

const (
	// maxCustomEntries bounds one scanned directory.
	maxCustomEntries = 200
	// maxCustomItems bounds the whole result so a pathological tree cannot
	// overflow the host response budget.
	maxCustomItems = 1000
	// maxCustomFileBytes bounds one authority file read.
	maxCustomFileBytes = 64 << 10
	// maxCustomSkipped bounds the reported skip reasons.
	maxCustomSkipped = 20
)

// customTypeSpec describes one scanned Power type: which directory under the
// Agent root holds it, which files mark a candidate directory, and which files
// can carry the machine-readable definition (in priority order).
type customTypeSpec struct {
	typeName  string
	dirName   string
	authority []string
	candidate []string
	// extraCandidate is a directory that marks a candidate without being an
	// authority file; a Plugin directory holding only `skills/` is exactly that.
	extraCandidate string
}

var customTypeSpecs = map[string]customTypeSpec{
	"skill": {
		typeName:  "skill",
		dirName:   "skills",
		authority: []string{"SKILL.md"},
		candidate: []string{"SKILL.md", "skill-card.md"},
	},
	"plugin": {
		typeName: "plugin",
		dirName:  "plugins",
		authority: []string{
			"apc-plugin.json",
			"plugin.yaml",
			".claude-plugin/plugin.json",
			".codex-plugin/plugin.json",
		},
		candidate: []string{
			"apc-plugin.json",
			"plugin.yaml",
			".claude-plugin/plugin.json",
			".codex-plugin/plugin.json",
		},
		extraCandidate: "skills",
	},
	"agent": {
		typeName:  "agent",
		dirName:   "agents",
		authority: []string{"agent.yaml"},
		candidate: []string{"agent.yaml"},
	},
}

// expectedFile is the name a skip warning points at when nothing usable was
// found: the primary authority file of the type.
func (spec customTypeSpec) expectedFile() string {
	return spec.authority[0]
}

// customAgentRoots mirrors apm's built-in agent profiles (`agentProfile
// defaultRoot`). The provider runs with a cleared environment, so apm's own
// CODEX_HOME/HERMES_HOME/CLAUDE_CONFIG_DIR/BIANBU_AGENT_HOME overrides are not
// observable here; the defaults are the directories the CLI itself creates.
var customAgentRoots = map[string]string{
	"bibit":        ".bianbu-agent",
	"codex":        ".codex",
	"claude-code":  ".claude",
	"hermes-agent": ".hermes",
}

// customAgentTypes lists the directory-shaped types a user can drop into each
// Agent's tree. MCP is deliberately absent: apm registers MCP servers into the
// Agent's own configuration or CLI, so there is no directory to scan.
//
// codex and claude-code manage Plugins through their own CLI (marketplace
// entries plus a cache), so a hand-dropped plugin directory is not a resource
// those Agents can load.
var customAgentTypes = map[string][]string{
	"bibit":        {"skill", "plugin", "agent"},
	"codex":        {"skill"},
	"claude-code":  {"skill"},
	"hermes-agent": {"skill", "plugin"},
}

// customResourceJSON is the wire shape of one discovered resource. It matches
// the frontend PowerRecord plus the `source` discriminator, and version may be
// an empty string when the file does not declare one.
type customResourceJSON struct {
	Type          string   `json:"type"`
	Name          string   `json:"name"`
	Version       string   `json:"version"`
	Description   string   `json:"description"`
	Tags          []string `json:"tags"`
	Source        string   `json:"source"`
	NameZH        string   `json:"name_zh,omitempty"`
	NameEN        string   `json:"name_en,omitempty"`
	DescriptionZH string   `json:"description_zh,omitempty"`
}

// customSkippedJSON explains one candidate directory that was not listed.
type customSkippedJSON struct {
	Type     string `json:"type"`
	Name     string `json:"name"`
	Expected string `json:"expected"`
	Reason   string `json:"reason"`
}

type customListDocument struct {
	Items   []customResourceJSON `json:"items"`
	Skipped []customSkippedJSON  `json:"skipped"`
}

const (
	skipMissingAuthority = "missing-authority-file"
	skipInvalidAuthority = "invalid-authority-file"
)

// CustomListResult is the `powers.custom.list.v1` result: the discovered items
// as original JSON text so the frontend owns business parsing, exactly like
// `listJson`/`catalogJson`.
type CustomListResult struct {
	Scope     string `json:"scope"`
	Status    string `json:"status"`
	ItemsJSON string `json:"itemsJson"`
}

// ScanCustomResources lists hand-installed resources for one Agent. A missing
// Agent root or missing type directory is an empty list, not an error; only an
// unusable home directory or an unreadable root fails the whole scan.
func ScanCustomResources(cfg Config, agent string) (CustomListResult, error) {
	types, ok := customAgentTypes[agent]
	if !ok {
		return CustomListResult{}, newProviderError("incompatible")
	}
	document := customListDocument{
		Items:   []customResourceJSON{},
		Skipped: []customSkippedJSON{},
	}
	for _, typeName := range types {
		root, err := customTypeDir(cfg, agent, typeName)
		if err != nil {
			return CustomListResult{}, err
		}
		if err := scanCustomType(root, customTypeSpecs[typeName], &document); err != nil {
			return CustomListResult{}, err
		}
	}
	// A stable order keeps the frontend snapshot (and therefore page 2
	// invalidation) deterministic across identical scans.
	sort.Slice(document.Items, func(i, j int) bool {
		if document.Items[i].Type != document.Items[j].Type {
			return document.Items[i].Type < document.Items[j].Type
		}
		return document.Items[i].Name < document.Items[j].Name
	})
	if len(document.Items) > maxCustomItems {
		document.Items = document.Items[:maxCustomItems]
	}
	encoded, err := json.Marshal(document)
	if err != nil {
		return CustomListResult{}, newProviderError("unknown")
	}
	return CustomListResult{Scope: "custom", Status: "data", ItemsJSON: string(encoded)}, nil
}

// customTypeDir resolves `<agentRoot>/<typeDir>` for one Agent and type.
func customTypeDir(cfg Config, agent, typeName string) (string, error) {
	spec, ok := customTypeSpecs[typeName]
	if !ok {
		return "", newProviderError("incompatible")
	}
	root, err := customAgentRoot(cfg, agent)
	if err != nil {
		return "", err
	}
	return filepath.Join(root, spec.dirName), nil
}

// customAgentRoot resolves the Agent's own directory under the user home. The
// home is resolved from the account database, so it is authoritative even
// though the host clears the environment.
func customAgentRoot(cfg Config, agent string) (string, error) {
	relative, ok := customAgentRoots[agent]
	if !ok {
		return "", newProviderError("incompatible")
	}
	if cfg.UserHome == "" {
		return "", newProviderError("unavailable")
	}
	if !filepath.IsAbs(cfg.UserHome) {
		return "", newProviderError("unavailable")
	}
	return filepath.Join(filepath.Clean(cfg.UserHome), relative), nil
}

// scanCustomType scans one type directory at depth 1. Every entry that carries a
// recognized file name is reported: either as an item, or as a skip reason.
func scanCustomType(dir string, spec customTypeSpec, document *customListDocument) error {
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return newProviderError("unavailable")
	}
	if len(entries) > maxCustomEntries {
		entries = entries[:maxCustomEntries]
	}
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		if !isCanonicalPowerName(name) {
			continue
		}
		path := filepath.Join(dir, name)
		if !isDirectoryOrDirLink(path) {
			continue
		}
		authority, found := findAuthorityFile(path, spec)
		if !found {
			continue
		}
		if authority == "" {
			document.recordSkip(spec, name, skipMissingAuthority)
			continue
		}
		resource, ok := parseCustomAuthorityFile(filepath.Join(path, filepath.FromSlash(authority)), spec.typeName)
		if !ok {
			document.recordSkip(spec, name, skipInvalidAuthority)
			continue
		}
		document.Items = append(document.Items, customResourceJSON{
			Type:          spec.typeName,
			Name:          name,
			Version:       resource.version,
			Description:   resource.description,
			Tags:          []string{},
			Source:        "custom",
			NameZH:        resource.nameZH,
			NameEN:        resource.nameEN,
			DescriptionZH: resource.descriptionZH,
		})
	}
	return nil
}

func (document *customListDocument) recordSkip(spec customTypeSpec, name, reason string) {
	if len(document.Skipped) >= maxCustomSkipped {
		return
	}
	document.Skipped = append(document.Skipped, customSkippedJSON{
		Type:     spec.typeName,
		Name:     name,
		Expected: spec.expectedFile(),
		Reason:   reason,
	})
}

// findAuthorityFile reports whether a directory is a candidate and, when it is,
// which authority file to read. An empty name with found=true means the
// directory looks like a resource but does not carry any file the type can be
// defined in (for example a Skill directory holding only skill-card.md).
func findAuthorityFile(dir string, spec customTypeSpec) (string, bool) {
	for _, authority := range spec.authority {
		if isRegularFile(filepath.Join(dir, filepath.FromSlash(authority))) {
			return authority, true
		}
	}
	for _, candidate := range spec.candidate {
		if isRegularFile(filepath.Join(dir, filepath.FromSlash(candidate))) {
			return "", true
		}
	}
	if spec.extraCandidate != "" && isDirectoryOrDirLink(filepath.Join(dir, spec.extraCandidate)) {
		return "", true
	}
	return "", false
}

func isRegularFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

func isDirectoryOrDirLink(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// parsedAuthority is the subset of a resource file this provider reads. It is a
// display projection only: identity always comes from the directory name.
type parsedAuthority struct {
	version       string
	description   string
	nameZH        string
	nameEN        string
	descriptionZH string
}

// parseCustomAuthorityFile reads one authority file and applies the mainstream
// minimum format of its Power type.
func parseCustomAuthorityFile(path, typeName string) (parsedAuthority, bool) {
	contents, ok := readBoundedTextFile(path)
	if !ok {
		return parsedAuthority{}, false
	}
	switch typeName {
	case "skill":
		fields, ok := parseLeadingFrontmatter(contents)
		if !ok {
			return parsedAuthority{}, false
		}
		if fields["name"] == "" || fields["description"] == "" {
			return parsedAuthority{}, false
		}
		return authorityFromFields(fields, ""), true
	case "plugin":
		fields, ok := parseAuthorityMapping(path, contents)
		if !ok {
			return parsedAuthority{}, false
		}
		if fields["name"] == "" {
			return parsedAuthority{}, false
		}
		return authorityFromFields(fields, ""), true
	case "agent":
		fields, ok := parseAuthorityMapping(path, contents)
		if !ok {
			return parsedAuthority{}, false
		}
		if fields["agent.name"] == "" {
			return parsedAuthority{}, false
		}
		return authorityFromFields(fields, "agent."), true
	default:
		return parsedAuthority{}, false
	}
}

// parseAuthorityMapping decodes one mapping either as JSON (the native plugin
// manifests) or through the narrow YAML subset, based on the file name.
func parseAuthorityMapping(path, contents string) (map[string]string, bool) {
	if strings.HasSuffix(path, ".json") {
		var decoded map[string]any
		if err := json.Unmarshal([]byte(contents), &decoded); err != nil {
			return nil, false
		}
		fields := make(map[string]string, len(decoded))
		for key, value := range decoded {
			if text, ok := value.(string); ok {
				fields[key] = text
			}
		}
		return fields, true
	}
	return parseYAMLSubset(contents), true
}

// authorityFromFields projects the display fields, normalizing a bare
// MAJOR.MINOR.PATCH version to the canonical v-prefixed form. A version that is
// not canonical is treated as undeclared rather than shown as-is, because the
// frontend version slot and the DTO both expect a canonical value.
//
// The authority file's own `name` becomes the English display name when the
// resource declares no `name_en`. A V1 resource carries only that one name, and
// it is the name its author chose: the card must show it rather than the
// directory the resource happens to sit in, which is only the APM call name this
// scanner uses for identity. A resource that does declare `name_en` keeps it, and
// `name_zh` still wins on a Chinese host. Every type's minimum-format gate above
// has already rejected a blank `name`, so the fallback is never empty.
func authorityFromFields(fields map[string]string, prefix string) parsedAuthority {
	nameEN := strings.TrimSpace(fields[prefix+"name_en"])
	if nameEN == "" {
		nameEN = strings.TrimSpace(fields[prefix+"name"])
	}
	return parsedAuthority{
		version:       normalizeAuthorityVersion(fields[prefix+"version"]),
		description:   strings.TrimSpace(fields[prefix+"description"]),
		nameZH:        strings.TrimSpace(fields[prefix+"name_zh"]),
		nameEN:        nameEN,
		descriptionZH: strings.TrimSpace(fields[prefix+"description_zh"]),
	}
}

func normalizeAuthorityVersion(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	candidate := trimmed
	if !strings.HasPrefix(candidate, "v") {
		candidate = "v" + candidate
	}
	if !canonicalVersionRE.MatchString(candidate) {
		return ""
	}
	return candidate
}

// readBoundedTextFile reads at most maxCustomFileBytes and requires strict
// UTF-8, so a binary blob (an image, a compiled artifact) is never mistaken for
// a resource definition.
func readBoundedTextFile(path string) (string, bool) {
	file, err := os.Open(path)
	if err != nil {
		return "", false
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > maxCustomFileBytes {
		return "", false
	}
	data, err := readBoundedBytes(file, maxCustomFileBytes)
	if err != nil {
		return "", false
	}
	return string(data), true
}

// parseLeadingFrontmatter extracts a leading `---` delimited YAML block and
// reads it with the narrow subset parser. A file without frontmatter is not a
// machine-readable Skill definition.
func parseLeadingFrontmatter(contents string) (map[string]string, bool) {
	lines := splitLines(contents)
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		return nil, false
	}
	end := -1
	for i := 1; i < len(lines); i++ {
		if strings.TrimSpace(lines[i]) == "---" {
			end = i
			break
		}
	}
	if end < 0 {
		return nil, false
	}
	return parseYAMLSubset(strings.Join(lines[1:end], "\n")), true
}

func splitLines(contents string) []string {
	trimmed := strings.TrimPrefix(contents, "\ufeff")
	trimmed = strings.ReplaceAll(trimmed, "\r\n", "\n")
	return strings.Split(trimmed, "\n")
}

// parseYAMLSubset reads the small, unambiguous subset of YAML that resource
// definitions use for their scalars: `key: value` pairs nested by indentation,
// quoted or bare, plus the two block scalar forms (`|` and `>`) that authors use
// for multi-line prose such as a long `description`. It never fails — anything
// it does not recognize (lists, flow collections, anchors, non-scalar values,
// tab indentation) is skipped — because the callers only require the presence of
// a few known keys and must tolerate the free-form content the formats allow
// elsewhere.
func parseYAMLSubset(contents string) map[string]string {
	fields := map[string]string{}
	type frame struct {
		indent int
		key    string
	}
	var stack []frame
	ignoreIndent := -1
	lines := splitLines(contents)

	for index := 0; index < len(lines); index++ {
		line := strings.TrimRight(lines[index], " \t")
		if strings.TrimSpace(line) == "" {
			continue
		}
		if strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		indent := countLeadingSpaces(line)
		if indent < len(line) && line[indent] == '\t' {
			continue
		}
		trimmed := line[indent:]
		if ignoreIndent >= 0 {
			if indent > ignoreIndent {
				continue
			}
			ignoreIndent = -1
		}
		if indent == 0 && (trimmed == "---" || trimmed == "...") {
			stack = stack[:0]
			continue
		}
		if strings.HasPrefix(trimmed, "- ") || trimmed == "-" || strings.HasPrefix(trimmed, "? ") {
			ignoreIndent = indent
			continue
		}

		separator := mappingSeparator(trimmed)
		if separator < 0 {
			continue
		}
		key := unquoteScalar(strings.TrimSpace(trimmed[:separator]))
		if key == "" || strings.ContainsAny(key, "[]{},&*!|>%@`") {
			continue
		}
		value := strings.TrimSpace(trimmed[separator+1:])

		for len(stack) > 0 && stack[len(stack)-1].indent >= indent {
			stack = stack[:len(stack)-1]
		}
		path := key
		if len(stack) > 0 {
			path = stack[len(stack)-1].key + "." + key
		}

		// A block scalar keeps the value on the lines that follow, so the header
		// line alone carries no scalar and the block must be consumed here.
		if literal, folded, ok := blockScalarIndicator(value); ok {
			block, consumed := readBlockScalar(lines, index+1, indent)
			if len(block) > 0 {
				fields[path] = blockScalarValue(block, literal, folded)
			}
			index = consumed
			continue
		}

		if value == "" {
			stack = append(stack, frame{indent: indent, key: path})
			continue
		}
		if value[0] == '{' || value[0] == '[' {
			// A flow collection is not a scalar; projecting it would make a
			// structural value look like a usable name or description.
			continue
		}
		value = unquoteScalar(stripInlineComment(value))
		if value == "" {
			continue
		}
		fields[path] = value
	}
	return fields
}

// countLeadingSpaces is the indentation width of one line.
func countLeadingSpaces(line string) int {
	indent := 0
	for indent < len(line) && line[indent] == ' ' {
		indent++
	}
	return indent
}

// blockScalarIndicator reports whether a scalar position holds a block scalar
// header (`|`, `>`, `|-`, `>-`, `|2`, …) and, when it does, whether the block is
// literal or folded.
func blockScalarIndicator(value string) (literal bool, folded bool, ok bool) {
	if value == "" || (value[0] != '|' && value[0] != '>') {
		return false, false, false
	}
	for i := 1; i < len(value); i++ {
		if value[i] != '+' && value[i] != '-' && (value[i] < '0' || value[i] > '9') {
			return false, false, false
		}
	}
	return value[0] == '|', value[0] == '>', true
}

// readBlockScalar consumes the indented lines that belong to a block scalar
// starting at `start`. It returns the block's content lines and the last line
// index it consumed. The block's own indentation is whatever the first
// non-blank content line uses, matching YAML's indentation detection; a line
// that is blank or indented at least that far belongs to the block, and the
// first line indented less than the header ends it. Blank lines are preserved so
// a paragraph break inside a folded scalar survives.
func readBlockScalar(lines []string, start, headerIndent int) ([]string, int) {
	var block []string
	contentIndent := -1
	last := start - 1
	for index := start; index < len(lines); index++ {
		line := strings.TrimRight(lines[index], " \t")
		if strings.TrimSpace(line) == "" {
			// A trailing blank run before a sibling key belongs to the block,
			// but it is recorded as a separator once content has started.
			block = append(block, "")
			continue
		}
		indent := countLeadingSpaces(line)
		if indent <= headerIndent || (line[indent] == '\t') {
			break
		}
		if contentIndent < 0 {
			contentIndent = indent
		}
		block = append(block, line[min(contentIndent, indent):])
		last = index
	}
	for len(block) > 0 && block[len(block)-1] == "" {
		block = block[:len(block)-1]
	}
	return block, last
}

// blockScalarValue joins the lines of a block scalar the way its header asks:
// `|` keeps the line breaks, `>` folds them into spaces, and a blank line ends a
// folded paragraph. Leading and trailing whitespace is stripped so the result
// compares like any other parsed scalar.
func blockScalarValue(lines []string, literal, folded bool) string {
	if literal {
		return strings.TrimSpace(strings.Join(lines, "\n"))
	}
	if !folded {
		return ""
	}
	var paragraphs []string
	var current []string
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			if len(current) > 0 {
				paragraphs = append(paragraphs, strings.Join(current, " "))
				current = nil
			}
			continue
		}
		current = append(current, strings.TrimSpace(line))
	}
	if len(current) > 0 {
		paragraphs = append(paragraphs, strings.Join(current, " "))
	}
	return strings.TrimSpace(strings.Join(paragraphs, "\n"))
}

// mappingSeparator finds the ':' that separates a mapping key from its value: it
// must sit outside quotes and be followed by whitespace or end of line, so
// `https://example.test` in a value is never mistaken for a key.
func mappingSeparator(line string) int {
	var quote byte
	for i := 0; i < len(line); i++ {
		switch character := line[i]; {
		case quote != 0:
			if character == quote {
				quote = 0
			} else if character == '\\' && quote == '"' {
				i++
			}
		case character == '"' || character == '\'':
			quote = character
		case character == ':':
			if i+1 == len(line) || line[i+1] == ' ' {
				return i
			}
		case character == '#':
			if i > 0 && line[i-1] == ' ' {
				return -1
			}
		}
	}
	return -1
}

// stripInlineComment removes a trailing ` # comment` from a scalar. A `#` only
// starts a comment when it follows whitespace and sits outside quotes, so a
// value such as `https://example.test/#frag` survives intact.
func stripInlineComment(value string) string {
	var quote byte
	for i := 0; i < len(value); i++ {
		switch character := value[i]; {
		case quote != 0:
			if character == quote {
				quote = 0
			} else if character == '\\' && quote == '"' {
				i++
			}
		case character == '"' || character == '\'':
			quote = character
		case character == '#' && i > 0 && (value[i-1] == ' ' || value[i-1] == '\t'):
			return strings.TrimSpace(value[:i])
		}
	}
	return strings.TrimSpace(value)
}

func unquoteScalar(value string) string {
	if len(value) >= 2 && strings.HasPrefix(value, "\"") && strings.HasSuffix(value, "\"") {
		inner := value[1 : len(value)-1]
		replacer := strings.NewReplacer(`\"`, `"`, `\\`, `\`, `\n`, "\n", `\t`, "\t")
		return replacer.Replace(inner)
	}
	if len(value) >= 2 && strings.HasPrefix(value, "'") && strings.HasSuffix(value, "'") {
		return strings.ReplaceAll(value[1:len(value)-1], "''", "'")
	}
	return value
}

// ResolveCustomTarget maps one (agent,type,name) request onto the absolute
// directory the provider is allowed to read or delete. It is the single place
// where a user-supplied name becomes a path, so every safety rule lives here:
// the type must be scannable for that Agent, the name must be a canonical kebab
// name (no separators, no dots, no empty segments), the type directory must
// exist as a directory (a symlinked type directory such as a linked
// `~/.codex/skills` is followed, exactly as the scanner follows it), and the
// joined path must still be a direct child of that directory.
func ResolveCustomTarget(cfg Config, target PowerTarget) (string, error) {
	if !customTypeSupported(target.Agent, target.Type) {
		return "", newProviderError("incompatible")
	}
	if !isCanonicalPowerName(target.Name) {
		return "", newProviderError("incompatible")
	}
	dir, err := customTypeDir(cfg, target.Agent, target.Type)
	if err != nil {
		return "", err
	}
	if !isDirectoryOrDirLink(dir) {
		return "", newProviderError("incompatible")
	}
	path := filepath.Join(dir, target.Name)
	if filepath.Dir(path) != dir {
		return "", newProviderError("incompatible")
	}
	return path, nil
}

func customTypeSupported(agent, typeName string) bool {
	for _, candidate := range customAgentTypes[agent] {
		if candidate == typeName {
			return true
		}
	}
	return false
}

// DeleteCustomResource removes the local directory of one custom resource. The
// resource must already exist as a directory in the tree the scanner
// enumerates; a symbolic link is removed as the link itself, so deleting never
// reaches through to content the user keeps elsewhere.
func DeleteCustomResource(cfg Config, target PowerTarget) (DeleteResult, error) {
	path, err := ResolveCustomTarget(cfg, target)
	if err != nil {
		return DeleteResult{}, err
	}
	if !isDirectoryOrDirLink(path) {
		return DeleteResult{}, newProviderError("incompatible")
	}
	if err := os.RemoveAll(path); err != nil {
		return DeleteResult{}, newProviderError("unavailable")
	}
	return DeleteResult{Status: "deleted"}, nil
}

// customResourcePathForUpload resolves a custom target and requires it to be a
// listable directory, so `apm validate` is never pointed at an empty path.
func customResourcePathForUpload(cfg Config, target PowerTarget) (string, error) {
	path, err := ResolveCustomTarget(cfg, target)
	if err != nil {
		return "", err
	}
	if !isDirectoryOrDirLink(path) {
		return "", newProviderError("incompatible")
	}
	return path, nil
}
