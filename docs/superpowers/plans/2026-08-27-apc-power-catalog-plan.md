# APC Power Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build the Agent Hub Power catalog prototype with one Store DTO for installed and market data, and revise APC public discovery contracts to return series-level pages with tag filtering.

**Architecture:** The React Feature calls only external-service:store operation powers.list.v1. The Dev Host supplies a contract-equivalent in-memory mock; a future Store bridge maps installed queries to the APM JSON CLI and market queries to the revised APC series/tags APIs. APC remains documentation-only in this implementation because its server does not yet exist.

**Tech Stack:** React 19, TypeScript 5.9, Vite 6, Bibit Feature SDK v1, Vitest 3.2.4, jsdom 26.1.0, Testing Library.

**Spec:** docs/superpowers/specs/2026-08-27-apc-power-catalog-design.md

## Global Constraints

- Do not modify src/agentHub.css or add inline styles.
- Do not import Bibit private source, Tauri APIs, network libraries, or direct fetch calls into production Feature code.
- All business data must use external-service:store with serviceId store and operationId powers.list.v1.
- Keep pageSize fixed at 20 in Store DTO v1.
- Power types are exactly skill, plugin, mcp, and agent; the UI has no all-types option.
- Tag selections use OR semantics and contain at most 20 sorted, unique canonical tags.
- Local Preview must not invoke the real APM CLI.
- Do not modify ../apm, ../bibit, SDK vendor tarballs, React versions, or Vite versions.
- APC work in this plan changes contracts and design documentation only, not server code.
- Preserve unrelated user changes in every repository.
- Add one plugin docs/Changelog.md entry only after behavior is implemented and all verification passes.

---

## File Map

### bibit-agenthub-plugin

- package.json / package-lock.json: test command and exact test dependencies.
- vitest.config.ts: jsdom test discovery for src and dev tests.
- tsconfig.json: Vitest global types while preserving strict no-emit compilation.
- src/api/contracts.ts: Store DTO types, request projection, and closed runtime response validation.
- src/api/powerCatalogClient.ts: the only powers.list.v1 invocation boundary.
- src/api/contracts.test.ts / src/api/powerCatalogClient.test.ts: API contract and request behavior.
- dev/powerCatalogMock.ts / dev/powerCatalogMock.test.ts: contract-equivalent installed and market mock.
- dev/main.tsx: replace agents.list.v1 mock wiring with powers.list.v1.
- src/components/PowerCard.tsx / PowerCard.test.tsx: shared installed/market card and version selection.
- src/components/PowerFilters.tsx / PowerFilters.test.tsx: scope, Agent, type, and tag controls.
- src/AgentHubPage.tsx / AgentHubPage.test.tsx: loading, request lifecycle, pagination, warnings, errors, and composition.
- docs/development-and-deployment-guide.md: new operation, DTO, local/remote mapping, and acceptance steps.
- docs/Changelog.md: one completed-feature entry using the required template.

### ../apc

- ivory-tower/adr/ADR-007-filter-and-group-public-resources.md: decision for series pagination, tag filtering, tags discovery, and snapshot binding.
- ivory-tower/features/004-resource-series-discovery/spec.md: implementable APC feature contract and acceptance criteria.
- ivory-tower/adr/ADR-005-paginate-resource-list.md: supersession note and revised pagination unit.
- docs/APC-API.md: authoritative HTTP model, parameters, responses, errors, examples, and change record.
- ivory-tower/project-overview.md: public API inventory, pagination rules, invariants, and risk summary.

---

### Task 1: Revise the APC Public Discovery Contract

**Files:**

- Create: ../apc/ivory-tower/adr/ADR-007-filter-and-group-public-resources.md
- Create: ../apc/ivory-tower/features/004-resource-series-discovery/spec.md
- Modify: ../apc/ivory-tower/adr/ADR-005-paginate-resource-list.md
- Modify: ../apc/docs/APC-API.md
- Modify: ../apc/ivory-tower/project-overview.md

**Interfaces:**

- Produces: GET /api/v1/resources/list series-level contract.
- Produces: GET /api/v1/resources/tags type-scoped, unpaginated contract.
- Produces: ResourceSeries and ResourceVersionMetadata schemas consumed by the future Store bridge.

- [ ] **Step 1: Confirm the APC baseline is clean**

Run:

    git -C ../apc status --short

Expected: no output. If there is output, inspect it and preserve all unrelated changes.

- [ ] **Step 2: Write ADR-007**

Create an Accepted ADR dated 2026-08-27 with these decisions:

1. Public list pagination counts type/name series, not exact version entries.
2. Response items contain type, name, and non-empty versions arrays.
3. Repeated tag query parameters use OR, allow at most 20 values, and filter exact versions before grouping.
4. view=latest keeps the greatest matching SemVer; view=all keeps all matching versions.
5. Page 2 and later require the first response catalog_sha256.
6. GET /api/v1/resources/tags requires type and returns all unique tags without pagination.
7. APC is not deployed, so the old flat ResourceMetadata list has no compatibility period.

Include alternatives rejected: two-phase name queries, restoring a series-detail endpoint, client-side tag scanning, and adding a second series endpoint.

- [ ] **Step 3: Write Feature 004 spec**

Copy the normative APC portions from the approved design into Feature 004. Define:

    ResourceSeriesList {
      catalog_sha256
      catalog_size
      items: ResourceSeries[]
      page
      page_size
      total
      next_page?
    }

    ResourceSeries {
      type
      name
      versions: ResourceVersionMetadata[]
    }

State the exact processing order: current Published Catalog, visibility filter, type filter, tag OR filter, remove empty series, apply view, stable sort, series pagination, pagination metadata.

- [ ] **Step 4: Supersede the relevant ADR-005 clauses**

Add a note near the top of ADR-005 linking ADR-007. Replace flat-entry wording with series pagination while preserving page defaults and the unrelated review-ticket and Submission boundaries.

- [ ] **Step 5: Update APC-API.md**

Make these exact changes:

- Add ResourceSeries and ResourceVersionMetadata to the data model.
- Keep ResourceMetadata as exact-version metadata used by catalog/content/management contexts.
- Document repeated tag and catalog_sha256 list parameters.
- Change list items to ResourceSeries[] and total to series count.
- Add GET /api/v1/resources/tags?type=skill with response catalog_sha256, catalog_size, items.
- Add INVALID_REQUEST cases for invalid/duplicate tags and unknown tags endpoint query parameters.
- Add INVALID_PAGINATION for missing or stale catalog_sha256 on page > 1.
- Update the discovery example and change history dated 2026-08-27.

- [ ] **Step 6: Update project-overview.md**

Link ADR-007 and Feature 004 from the document introduction. Update the public API table, pagination section, list example, invariants, and known risks. State that the tags response and list page must use the same atomic Published Catalog.

- [ ] **Step 7: Check for stale flat-list claims**

Run:

    rg -n "items\\[\\].*ResourceMetadata|版本条目.*分页|ResourceMetadata.*分页列表" ../apc/docs ../apc/ivory-tower

Expected: any remaining match is explicitly historical or superseded. Fix active-contract matches.

- [ ] **Step 8: Validate APC documentation**

Run:

    git -C ../apc diff --check
    git -C ../apc status --short

Expected: diff check exits 0; only the five intended APC documentation paths are changed.

- [ ] **Step 9: Commit the APC contract**

    git -C ../apc add \
      ivory-tower/adr/ADR-007-filter-and-group-public-resources.md \
      ivory-tower/features/004-resource-series-discovery/spec.md \
      ivory-tower/adr/ADR-005-paginate-resource-list.md \
      docs/APC-API.md \
      ivory-tower/project-overview.md
    git -C ../apc commit -m "docs(api): define series resource discovery"

Record the resulting commit hash for the plugin Changelog.

---

### Task 2: Add the Plugin Test Harness

**Files:**

- Modify: package.json
- Modify: package-lock.json
- Modify: tsconfig.json
- Create: vitest.config.ts
- Create: src/feature.test.ts

**Interfaces:**

- Produces: npm test running all src and dev unit/component tests in jsdom.

- [ ] **Step 1: Install exact development dependencies**

Run:

    npm install --save-dev --save-exact \
      @testing-library/dom@10.4.1 \
      @testing-library/react@16.3.0 \
      @testing-library/user-event@14.6.1 \
      jsdom@26.1.0 \
      vitest@3.2.4

Expected: package.json and package-lock.json change; React, SDK and Vite versions do not change.

- [ ] **Step 2: Add the test script and Vitest types**

Set package.json scripts.test to:

    vitest run

Add vitest/globals to compilerOptions.types in tsconfig.json without changing strict, noEmit, module, JSX, or include.

- [ ] **Step 3: Create vitest.config.ts**

    import { defineConfig } from 'vitest/config'

    export default defineConfig({
      test: {
        environment: 'jsdom',
        include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'dev/**/*.test.ts'],
      },
    })

- [ ] **Step 4: Add a harness smoke test**

Create src/feature.test.ts:

    import { describe, expect, it } from 'vitest'
    import { featureModule } from './feature'

    describe('featureModule', () => {
      it('exports the declared home and settings renderers', () => {
        expect(featureModule.sdkApiVersion).toBe(1)
        expect(featureModule.pages?.home).toBeTypeOf('function')
        expect(featureModule.settings?.settings).toBeTypeOf('function')
      })
    })

- [ ] **Step 5: Run the harness**

Run:

    npm test

Expected: one test passes with no console errors or warnings.

- [ ] **Step 6: Commit the harness**

    git add package.json package-lock.json tsconfig.json vitest.config.ts src/feature.test.ts
    git commit -m "test: add Agent Hub feature harness"

---

### Task 3: Define and Validate the Store DTO

**Files:**

- Create: src/api/contracts.test.ts
- Create: src/api/contracts.ts

**Interfaces:**

- Produces: PowerScope, PowerType, ListPowersInput, PowerVersion, PowerSeries, PowerWarning, ListPowersResult, ReadyListPowersResult.
- Produces: POWER_TYPES, POWER_PAGE_SIZE, POWERS_LIST_OPERATION_ID.
- Produces: parseListPowersInput(value), toListPowersParams(input), and parseListPowersResult(value).

- [ ] **Step 1: Write failing happy-path contract tests**

Create src/api/contracts.test.ts. Import the missing symbols from ./contracts and test:

    const readyResult = {
      status: 'ready',
      snapshot: 'catalog-1',
      items: [{
        type: 'skill',
        name: 'demo',
        versions: [
          { version: 'v2.0.0', description: 'new', tags: ['quality'] },
          { version: 'v1.0.0', description: 'old', tags: [] },
        ],
      }],
      page: 1,
      pageSize: 20,
      total: 1,
      facets: { agents: [], tags: ['quality'] },
      warnings: [],
    }

Assert parseListPowersResult returns an equal, deeply independent value. Mutating the source tags after parsing must not mutate the parsed result.

- [ ] **Step 2: Run the contract test and verify RED**

Run:

    npx vitest run src/api/contracts.test.ts

Expected: FAIL because src/api/contracts.ts does not exist.

- [ ] **Step 3: Add failing negative cases**

Add separate tests rejecting:

- unknown top-level result field;
- unknown nested version field;
- empty versions;
- versions in ascending order;
- invalid Power type;
- pageSize other than 20;
- duplicated or unsorted tags;
- market ready result with non-empty agents;
- reset_required with any extra field.

Also assert toListPowersParams:

    toListPowersParams({
      scope: 'market',
      type: 'skill',
      tags: ['quality'],
      page: 1,
      pageSize: 20,
    })

returns exactly the same JSON-safe fields and omits agent/snapshot.

Add request-parser tests rejecting an unknown field, installed without agent, market with agent,
page 1 with snapshot, page 2 without snapshot, pageSize other than 20, unsorted tags and duplicate tags.

- [ ] **Step 4: Implement contracts.ts minimally**

Define the exact constants:

    export const POWER_TYPES = ['skill', 'plugin', 'mcp', 'agent'] as const
    export const POWER_PAGE_SIZE = 20 as const
    export const POWERS_LIST_OPERATION_ID = 'powers.list.v1' as const

Implement closed-object guards that:

- require plain non-null objects;
- compare Object.keys against an allowed Set;
- require finite integers for page, total and nextPage;
- validate strict versions with /^v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$/;
- compare versions numerically by major, minor and patch;
- require sorted unique string arrays;
- clone every returned array and object.

Throw Error with a safe message prefixed by:

    Invalid powers.list.v1 result:

Do not include arbitrary server payloads in the error.

Export the ready-result alias used by page state:

    export type ReadyListPowersResult = Extract<
      ListPowersResult,
      { status: 'ready' }
    >

parseListPowersInput validates unknown service params for the Dev Host mock. toListPowersParams first
parses and clones its typed input, then returns the JSON-safe Record value.

- [ ] **Step 5: Run contract tests and verify GREEN**

Run:

    npx vitest run src/api/contracts.test.ts

Expected: all contract tests pass.

- [ ] **Step 6: Run typecheck**

Run:

    npm run typecheck

Expected: exit 0.

- [ ] **Step 7: Commit the DTO**

    git add src/api/contracts.ts src/api/contracts.test.ts
    git commit -m "feat: define Power catalog Store contract"

---

### Task 4: Implement the Local Preview Catalog

**Files:**

- Create: dev/powerCatalogMock.test.ts
- Create: dev/powerCatalogMock.ts
- Modify: dev/main.tsx

**Interfaces:**

- Consumes: ListPowersInput, ListPowersResult, POWER_PAGE_SIZE.
- Produces: handlePowerCatalogMock({ operationId, params }).
- Produces: installed and market fixture arrays with normalized exact-version records.

- [ ] **Step 1: Write the failing installed-query test**

Test handlePowerCatalogMock with:

    {
      operationId: 'powers.list.v1',
      params: {
        scope: 'installed',
        agent: 'bibit',
        type: 'skill',
        tags: [],
        page: 1,
        pageSize: 20
      }
    }

Assert status ready, agents only include installed fixtures, results are grouped by type/name, versions are descending, and facets.tags contains all tags for Bibit skills.

- [ ] **Step 2: Verify RED**

Run:

    npx vitest run dev/powerCatalogMock.test.ts

Expected: FAIL because dev/powerCatalogMock.ts does not exist.

- [ ] **Step 3: Add failing market, tag, pagination, and reset tests**

Add independent tests:

- market facets.agents is [];
- selecting two tags includes a version matching either tag;
- filtering removes non-matching versions and then empty series;
- 21 distinct series produce 20 items, total 21 and nextPage 2;
- page 2 with the returned snapshot produces the remaining item;
- page 2 with a different snapshot returns reset_required;
- unknown operation rejects with Error("Unknown operation: ...").

- [ ] **Step 4: Implement powerCatalogMock.ts**

Use exact-version fixture records shaped as:

    type MockPowerRecord = {
      scope: 'installed' | 'market'
      agent?: string
      type: PowerType
      name: string
      version: string
      description: string
      tags: string[]
    }

Implement this order:

1. validate operationId and params using parseListPowersInput;
2. select scope and agent;
3. derive agents and unfiltered tags facets for the selected agent/type;
4. apply type and tag OR filters to exact versions;
5. group by type/name;
6. sort versions numerically descending and series by type/name;
7. slice series using pageSize 20;
8. return snapshot local-preview-v1;
9. return reset_required for page>1 snapshot mismatch.

- [ ] **Step 5: Wire dev/main.tsx**

Remove mockAgents and the agents.list.v1 branch. Keep settings operations unchanged. Route powers.list.v1 to handlePowerCatalogMock. Preserve storeEndpoint behavior so a real invoke service still replaces all mocks.

- [ ] **Step 6: Verify GREEN**

Run:

    npx vitest run dev/powerCatalogMock.test.ts
    npm run typecheck

Expected: all mock tests pass and typecheck exits 0.

- [ ] **Step 7: Commit the Local Preview**

    git add dev/main.tsx dev/powerCatalogMock.ts dev/powerCatalogMock.test.ts
    git commit -m "feat: add local Power catalog preview"

---

### Task 5: Add the Store Client Boundary

**Files:**

- Create: src/api/powerCatalogClient.test.ts
- Create: src/api/powerCatalogClient.ts

**Interfaces:**

- Consumes: FeatureExternalServiceApiV1<'store'>.
- Produces: listPowers(service, input, signal): Promise<ListPowersResult>.

- [ ] **Step 1: Write the failing request-projection test**

Create a fake service whose request captures its argument and resolves readyResult. Call:

    await listPowers(service, input, signal)

Assert the exact request:

    {
      serviceId: 'store',
      operationId: 'powers.list.v1',
      params: toListPowersParams(input),
      timeoutMs: 30000,
      signal
    }

Assert the returned value passed through parseListPowersResult.

- [ ] **Step 2: Verify RED**

Run:

    npx vitest run src/api/powerCatalogClient.test.ts

Expected: FAIL because powerCatalogClient.ts does not exist.

- [ ] **Step 3: Add failing incompatible-response and rejection tests**

Add one test where request resolves an object with an unknown field and assert listPowers rejects with the safe validation prefix. Add one test asserting the same FeatureServiceError object rejected by request is preserved.

- [ ] **Step 4: Implement powerCatalogClient.ts**

    export async function listPowers(
      service: FeatureExternalServiceApiV1<'store'>,
      input: ListPowersInput,
      signal: AbortSignal
    ): Promise<ListPowersResult> {
      const value = await service.request({
        serviceId: 'store',
        operationId: POWERS_LIST_OPERATION_ID,
        params: toListPowersParams(input),
        timeoutMs: 30_000,
        signal,
      })
      return parseListPowersResult(value)
    }

- [ ] **Step 5: Verify GREEN**

Run:

    npx vitest run src/api/powerCatalogClient.test.ts
    npm run typecheck

Expected: all client tests pass and typecheck exits 0.

- [ ] **Step 6: Commit the client**

    git add src/api/powerCatalogClient.ts src/api/powerCatalogClient.test.ts
    git commit -m "feat: add Power catalog Store client"

---

### Task 6: Build Shared Filters and Power Cards

**Files:**

- Create: src/components/PowerCard.test.tsx
- Create: src/components/PowerCard.tsx
- Create: src/components/PowerFilters.test.tsx
- Create: src/components/PowerFilters.tsx

**Interfaces:**

- Consumes: PowerSeries, PowerScope, PowerType.
- Produces: PowerCard(props: { series: PowerSeries }).
- Produces: PowerFilters(props: PowerFiltersProps).

PowerFiltersProps is fixed as:

    interface PowerFiltersProps {
      scope: PowerScope
      agents: readonly string[]
      agent: string
      type: PowerType
      availableTags: readonly string[]
      selectedTags: readonly string[]
      onScopeChange(scope: PowerScope): void
      onAgentChange(agent: string): void
      onTypeChange(type: PowerType): void
      onTagsChange(tags: string[]): void
    }

- [ ] **Step 1: Write the failing PowerCard test**

Render a series with v2.0.0 and v1.0.0. Assert:

- name and type render;
- the version select initially has v2.0.0;
- textarea values show v2 description and tags;
- selecting v1.0.0 updates both textarea values.

- [ ] **Step 2: Verify PowerCard RED**

Run:

    npx vitest run src/components/PowerCard.test.tsx

Expected: FAIL because PowerCard.tsx does not exist.

- [ ] **Step 3: Implement PowerCard minimally**

Use only:

    <article>
    <span>
    <h2>
    <label>
    <select>
    <textarea readOnly>
    <textarea readOnly rows={1} wrap="off">

Keep selectedVersion in component state. Reset it to versions[0].version when series identity or versions change. Do not add class names requiring new CSS.

- [ ] **Step 4: Verify PowerCard GREEN**

Run:

    npx vitest run src/components/PowerCard.test.tsx

Expected: PASS.

- [ ] **Step 5: Write failing PowerFilters tests**

Render controlled filters and assert:

- 我的 Power and Power 市场 buttons invoke scope changes;
- installed renders only supplied Agent buttons;
- market renders no Agent controls;
- only skill, plugin, mcp and agent type controls exist;
- the native multiple select reports sorted selected tags.

- [ ] **Step 6: Verify PowerFilters RED**

Run:

    npx vitest run src/components/PowerFilters.test.tsx

Expected: FAIL because PowerFilters.tsx does not exist.

- [ ] **Step 7: Implement PowerFilters minimally**

Use existing .agent-hub button styling through descendant selectors and native select controls. Mark current button with aria-pressed=true and disabled. Do not import CSS or add inline styles.

- [ ] **Step 8: Verify component GREEN**

Run:

    npx vitest run src/components/PowerCard.test.tsx src/components/PowerFilters.test.tsx
    npm run typecheck

Expected: all component tests pass and typecheck exits 0.

- [ ] **Step 9: Commit shared components**

    git add src/components/PowerCard.tsx src/components/PowerCard.test.tsx \
      src/components/PowerFilters.tsx src/components/PowerFilters.test.tsx
    git commit -m "feat: add shared Power catalog controls"

---

### Task 7: Replace the Agent Demo with the Power Catalog Page

**Files:**

- Create: src/AgentHubPage.test.tsx
- Modify: src/AgentHubPage.tsx

**Interfaces:**

- Consumes: useFeatureCapability, listPowers, PowerFilters, PowerCard.
- Produces: complete AgentHubPage request state and pagination behavior.

- [ ] **Step 1: Write a fake Host API test harness**

Create a helper that wraps AgentHubPage with FeatureHostApiProvider:

    const hostApi: FeatureHostApiV1 = {
      sdkApiVersion: 1,
      featureId: 'agent-hub',
      grantedCapabilities: ['external-service:store'],
      getCapability: () => ({ request }) as never,
    }

Pass FeaturePageProps with empty subpath/search and inert navigation methods.

- [ ] **Step 2: Write the failing default-query test**

Resolve a ready page for installed/Bibit/skill. Assert the first request params are exactly:

    {
      scope: 'installed',
      agent: 'bibit',
      type: 'skill',
      tags: [],
      page: 1,
      pageSize: 20
    }

Assert the Power card and pagination text render.

- [ ] **Step 3: Verify page RED**

Run:

    npx vitest run src/AgentHubPage.test.tsx

Expected: FAIL because the existing page still requests agents.list.v1.

- [ ] **Step 4: Add failing interaction tests**

Add separate tests for:

- capability unavailable and Retry;
- loading then empty;
- market switch omits agent and hides Agent controls;
- selecting another installed Agent resets page to 1;
- selecting plugin resets tags and page;
- multi-tag selection sends sorted OR tags;
- Next sends page 2 and the current snapshot;
- reset_required triggers a fresh page 1 request without snapshot;
- warnings and valid cards render together;
- timeout/incompatible safe messages;
- unmount aborts the active request;
- a late older response cannot replace a newer filter response.

- [ ] **Step 5: Implement AgentHubPage state**

Use controlled state:

    scope: 'installed' | 'market'
    agent: string
    type: PowerType
    tags: string[]
    page: number
    snapshot?: string
    retry: number

Use a discriminated view state:

    { status: 'loading' }
    { status: 'ready'; data: ReadyListPowersResult }
    { status: 'error'; message: string; retryable: boolean }

In useEffect:

1. create an AbortController and request-generation counter;
2. fail locally if Store capability is absent;
3. call listPowers;
4. on ready, select Bibit if available, otherwise the first installed Agent;
5. on reset_required, clear snapshot and set page 1 exactly once;
6. ignore aborted and stale generations;
7. map FeatureServiceError codes to safe UI text;
8. abort in cleanup.

Use these exact safe messages:

- missing capability: Store capability is not available.
- offline: Power catalog is offline.
- timeout: Power catalog request timed out.
- unauthorized: Power catalog authorization is required.
- incompatible or DTO validation failure: Power catalog service is incompatible with this plugin.
- unavailable: Power catalog is unavailable.
- unknown: Could not load Power catalog.

Append Diagnostic ID: <id> only when the mapped FeatureServiceError includes diagnosticId. Loading copy is
Loading Powers… and empty copy is No Powers are available.

Render:

- existing Agent Hub header;
- PowerFilters;
- loading/status/error/warnings;
- existing .agent-hub__grid containing PowerCard items;
- existing buttons for Previous and Next;
- 第 X / Y 页 using Math.max(1, Math.ceil(total / 20)).

- [ ] **Step 6: Verify page GREEN**

Run:

    npx vitest run src/AgentHubPage.test.tsx
    npm test
    npm run typecheck

Expected: all page and full plugin tests pass; typecheck exits 0.

- [ ] **Step 7: Prove CSS stayed unchanged**

Run:

    git diff -- src/agentHub.css

Expected: no output.

- [ ] **Step 8: Commit the page**

    git add src/AgentHubPage.tsx src/AgentHubPage.test.tsx
    git commit -m "feat: add APC Power catalog page"

---

### Task 8: Document, Record, and Verify the Completed Feature

**Files:**

- Modify: docs/development-and-deployment-guide.md
- Create: docs/Changelog.md
- Verify only: docs/superpowers/specs/2026-08-27-apc-power-catalog-design.md
- Verify only: docs/superpowers/plans/2026-08-27-apc-power-catalog-plan.md

**Interfaces:**

- Documents: powers.list.v1, Local Preview, APM CLI mapping, APC mapping, and release blockers.

- [ ] **Step 1: Update the development guide**

Replace the agents.list.v1 demo contract with powers.list.v1. Document:

- exact request and result unions from the spec;
- Local Preview behavior;
- future installed command apm list --installed --agent=all --all --json;
- future APC endpoints resources/list and resources/tags;
- Host response limit and runtime validation;
- published integration blockers in ../bibit and the external Store service;
- smoke checks for filters, version selection, pagination, warnings and Retry.

Keep settings.get.v1 and settings.update.v1 unchanged.

- [ ] **Step 2: Run all fresh verification commands**

Run:

    npm test
    npm run typecheck
    npm run build:dev
    git diff --check
    git diff -- src/agentHub.css

Expected:

- npm test reports zero failures;
- typecheck exits 0;
- Vite build exits 0;
- diff check exits 0;
- CSS diff has no output.

- [ ] **Step 3: Audit the approved spec**

Run:

    rg -n "TBD|TODO|agents\\.list\\.v1" \
      docs/superpowers/specs/2026-08-27-apc-power-catalog-design.md \
      docs/superpowers/plans/2026-08-27-apc-power-catalog-plan.md \
      docs/development-and-deployment-guide.md

Expected: no unfinished markers. Any remaining agents.list.v1 reference is explicitly historical; otherwise replace it.

- [ ] **Step 4: Create docs/Changelog.md**

Use the required template with date 2026-08-27 and category 新增功能. Record the original user request once, list the APC documentation commit and all plugin behavior commits, summarize the unified Store DTO and series-level APC contract, and record:

- exact verification commands and results;
- Remote Store, APC server and Bibit Host adapter remain release prerequisites;
- no CSS was added or modified.

- [ ] **Step 5: Commit documentation and Changelog**

    git add docs/development-and-deployment-guide.md docs/Changelog.md \
      docs/superpowers/specs/2026-08-27-apc-power-catalog-design.md \
      docs/superpowers/plans/2026-08-27-apc-power-catalog-plan.md
    git commit -m "docs: record APC Power catalog delivery"

- [ ] **Step 6: Run final post-commit verification**

Run:

    npm test
    npm run typecheck
    npm run build:dev
    git diff --check
    git status --short
    git -C ../apc status --short

Expected:

- all verification commands exit 0;
- plugin and APC working trees are clean;
- no generated dist, artifacts, private keys or node cache files are tracked.

---

## Completion Checklist

- [ ] APC ADR-007 and Feature 004 agree with the authoritative API reference.
- [ ] powers.list.v1 is the only page data operation.
- [ ] Local Preview and future Remote mappings share one closed DTO.
- [ ] Installed and market cards use the same PowerCard.
- [ ] Type has no all option; skill is the default.
- [ ] Installed defaults to Bibit and hides uninstalled Agents.
- [ ] Tags use OR and are refreshed when upper filters change.
- [ ] Series and versions are never split across UI pages.
- [ ] Snapshot changes reset pagination without mixing results.
- [ ] Every new behavior followed a witnessed RED-GREEN TDD cycle.
- [ ] src/agentHub.css has no diff.
- [ ] Tests, typecheck, build and diff checks pass with fresh evidence.
- [ ] Changelog contains one entry for the completed user request.
