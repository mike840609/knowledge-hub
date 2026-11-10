# User guide: Tasks and Inbox chapters

**Status:** Draft, 2026-11-10. Scope agreed with the owner: the two largest missing
My Space surfaces first, with real screenshots. Graph / Copy for Agent, Shares,
Team Settings and the smaller gaps are a later batch.

## 1. Why

The guide at `/help` explains import, sync, troubleshooting, reading, Insights
and sharing. Two daily destinations are absent:

- **Tasks** is in My Space's primary navigation and is the place a reader sees
  what a coding agent finished, with verification, findings, references and
  revisions. It also owns the one-time `/hub-export` setup and its credentials.
- **Inbox** is the discussion index: comments on the reader's documents,
  discussions they follow, mentions, named-share proposals, and documents shared
  with them by name. It has no guide entry at all, although the sharing chapter
  references Shares and discussions.

A reader who has just run `/hub-export`, or who receives a comment, has nowhere
in the guide to look.

## 2. Goals

- Add two bilingual chapters to `/help`, each with a diagram and real screens:
  **Inbox** and **Tasks**.
- Document Tasks list, detail, export setup and credential management accurately,
  including the fact that Verification is agent-reported, not Hub-certified.
- Document the Inbox index, relationship/status/unread filters, the split
  reading pane, mark-read behaviour, Proposals and Shared with you.
- Show the Tasks search/filter UI only where the deployment has
  `TASK_SEARCH_READ_ENABLED=true`, so the guide never points at absent controls.
- Generate every new screen with the existing capture harness, in light and dark,
  with numbered marks, and commit the PNGs with the change.

## 3. Non-goals

- Graph, Copy for Agent, Shares tabs, Team Settings, saved searches, keyboard
  shortcuts, feedback, link check, source health, Updates/freshness. These stay
  for the next batch.
- Changing product behaviour, routes, permissions or copy inside the product.
- Hand-drawn imitations of the Inbox or Tasks screens. Diagrams explain only what
  a screen cannot (order, relationships, persistence).
- Re-capturing the existing seven screens unless a pictured screen changed.

## 4. Anti-goals

- Implying that Verification is certified by Knowledge Hub, that a binding grants
  access beyond `task-result:create` into the owner's My Space, or that Inbox
  grants access to a document the reader could not already open.
- Showing the search field in a deployment where the flag is off.
- Shipping a chapter whose screenshots do not match its copy, or whose marks
  appear in a different order than the caption.
- Turning the guide into a developer runbook for the CLI; the setup line is shown,
  the CLI internals are not.

## 5. Constraints

- `/help` is one shared address for every reader (`/help`, `?lang=en|zh-TW`); only
  its links lead into the reader's own My Space. New links must use
  `helpWorkspaceId()` and the `/w/<id>/...` base, never a literal id.
- Every chapter follows the established shape: heading, flat diagram
  (`bg-subtle`, no frame/shadow), framed real screen(s), short bullet list,
  contextual links, then native `details` for advanced material.
- Screens are cropped regions at 2x, framed as a window with a neutral title bar
  whose path reads `My Space › Inbox` / `My Space › Tasks`, outlined controls and
  numbered marks, one light and one dark image per shot.
- Screens are produced by `tests/e2e/user-guide-screenshots.spec.ts` through
  `make guide-screenshots` (needs MariaDB and Playwright browsers). A pictured
  screen that changes is re-captured, not hand-edited.
- Bilingual: section titles and prose in English and Traditional Chinese, actual
  interface labels kept in English in both.
- Existing tests that count figures (`tests/e2e/user-guide.spec.ts`) and the
  content unit test (`tests/unit/saved-shares-view.test.tsx`) must keep passing.

## 6. Approaches considered

### Chapter order

- **A1 (chosen):** Inbox after *Read, search and organize*, Tasks after
  *Insights* and before *Share, export and workspace scope*.
  Inbox continues the reading story (a discussion is attached to a passage);
  Tasks is a second kind of knowledge, read after the statistics chapter; sharing
  and export remain the closing chapter.
- **A2:** Both chapters after *Share and export*. Rejected: sharing stops being
  the conclusion, and Inbox sits far from the reading it extends.
- **A3:** Tasks after reading, Inbox before sharing. Rejected: the chapter order
  then implies Inbox is part of sharing rather than part of reading.

### Task Search visibility

- **Chosen:** the help page reads `TASK_SEARCH_READ_ENABLED` at request time. When
  true, the Tasks chapter gains a "Search and filters" disclosure and the
  search-enabled list screen. When false, that material and its screen are
  omitted and the legacy list screen is shown. Same data, two truthful versions.
- Rejected: always documenting search (wrong for the default-off deployment), and
  never documenting it (hides a shipped capability).

### Screens

- **Chosen:** extend `user-guide-screenshots.spec.ts`, seeding data through the
  product's own APIs on a fresh account, and spawn one extra flag-on server for
  the search screen (the pattern `task-search-my-space.spec.ts` already uses).
- Rejected: copying `docs/screenshots/task-pages/*.png`, which lack dark
  variants, numbered marks and the guide's framing, and come from different data.

## 7. What changes

### 7.1 Content

`src/components/help/user-guide-content.ts`

- `userGuideContent(locale, options?: {taskSearch?: boolean})` keeps the default
  false so existing callers (the unit test) are unchanged.
- Two new sections inserted at the chosen positions:

| id | en title | zh-TW title | diagram |
| --- | --- | --- | --- |
| `inbox` | Inbox: discussions, mentions and shares | 收件匣：討論、提及與分享 | One index, three relationships |
| `tasks` | Tasks: results from coding agents | Tasks：代理完成的任務 | From a finished task to My Space |

- `UserGuideAction` gains `inbox`, `tasks`, `taskSetup`; the destination map in
  `src/app/help/page.tsx` resolves them against the reader's My Space.
- Inbox bullets (both languages):
  - Inbox collects discussions on your documents, discussions you follow, and
    comments that mention you. Opening a discussion marks it read; resolving it
    is a separate action.
  - Switch relationship with All / My documents / Following / Mentions; narrow
    with Status (Any status / Open / Resolved) and Unread.
  - Select a row to read the whole thread beside the list and Reply or Resolve;
    Open document opens the article. Below the split width, the Inbox is a plain
    list and a row opens the document.
  - Mark read settles one item; Mark all read clears the current unread; Refresh
    reloads the index.
  - Proposals (pending named-share requests the owner can Approve / Decline) and
    Shared with you (documents and folders shared with you by name) appear on the
    same page; the latter also lives in Shares.
  - Details: read vs resolve, unread counts, dead links, write permissions, and
    the difference between Inbox and Shares.
- Tasks bullets:
  - Finish a task in Claude Code or OpenCode, run `/hub-export`, then open Tasks
    from the sidebar. The agent produces the structured result; the CLI uploads
    it into your My Space.
  - First use: Set up export → create a binding → copy the one-time setup line
    and run it on your own machine. One binding per machine; the token is shown
    once.
  - The list has Active / Archived. Each row shows the agent and completion
    time, plus the revision when a task has more than one, and links to the
    detail; the detail names the binding that exported it. Archived results stay
    readable and can be restored.
  - When `taskSearch` is true, the row also shows the verification badge and a
    matched excerpt; the search detail says so.
  - Detail shows Summary, Verification, Findings / Decisions / Changes,
    References and Revisions. Verification is what the agent reported, not a Hub
    certification.
  - Details: what references resolve to (Wiki link, file, commit, PR; not found /
    ambiguous), revisions, token rotation/revocation, the completed-task-only and
    64 KiB limits, My Space-only visibility.
- When `taskSearch` is true, one more detail: keyword search covers title, summary
  and findings; filters are Agent, Verification and Completed date; applied
  filters become removable chips; the URL keeps the criteria. Dates follow the
  browser's UTC offset.

### 7.2 Diagrams

`src/components/help/user-guide-illustration.tsx` gains two cases:

- `inbox`: three relationship columns (My documents / Following / Mentions) into
  one index, then read vs resolve as two distinct outcomes. Note that opening a
  discussion marks it read, resolving is separate, and a dead link opens nothing.
- `tasks`: a four-step flow (finish in agent → `/hub-export` → CLI uploads →
  Tasks detail) with a footer noting My Space-only storage and agent-reported
  verification.

### 7.3 Screens

`src/components/help/user-guide-screenshot.tsx` gains:

| name | screen | marks (in caption order) | when |
| --- | --- | --- | --- |
| `inbox` | Inbox at 1600×1000 with one selected discussion | ① relationship filters ② discussion row ③ selected discussion pane | always |
| `tasks-list` | Tasks list, legacy reader | ① task row ② Set up export | flag off |
| `tasks-search` | Tasks list, search-enabled reader | ① search field ② Agent ③ Completed ④ Apply filters | flag on |
| `tasks-detail` | Task detail | ① Verification ② References ③ Revisions | always |
| `tasks-setup` | Task export setup with one existing binding | ① Label + Create binding ② a binding row's Rotate token / Revoke | always |

The setup screen never contains the one-time setup line. That line carries the
origin, binding id and a live token, and it is shown only once; committing it as
permanent help would publish a secret-shaped string and a harness URL that no
reader can use. The prose says the line appears once after creation and where to
run it. This shot is taken after a binding is created through the API, so the
page shows the real empty/form + binding-list state.

- `UserGuideScreenshots` takes the same `taskSearch` option and filters by a
  `feature: "taskSearch"` field on the shot.
- Two new imports per shot name (light + dark), committed under
  `src/components/help/screens/`.
- Captions double as alt text and state the numbered action in the chapter's
  language.

### 7.4 Capture

`tests/e2e/user-guide-screenshots.spec.ts`

- On the fresh account's My Space, seed through the product APIs:
  - create a binding through the API, then capture the setup page with the
    binding list (never the one-time line, see §7.3); keep the token for ingest;
  - ingest two realistic completed tasks (one with references and two revisions)
    for the list and detail screens;
  - create a note and a share link; post one anchored comment through a trusted
    persona origin (`phase3Origin("viewer")`) so the owner's Inbox has a real
    discussion; capture Inbox at 1600×1000 so the split pane exists.
- For `tasks-search`, spawn one extra `next start` on
  `KM_E2E_PORT + 19` with `TASK_SEARCH_READ_ENABLED=true`, sharing the E2E
  database (copy the lifecycle from `task-search-my-space.spec.ts`), navigate
  there, and capture. Stop it afterwards.
- Keep the existing captures untouched.

### 7.5 Help page and navigation

`src/app/help/page.tsx`

- Read `process.env.TASK_SEARCH_READ_ENABLED === "true"` (a small server helper
  beside `helpWorkspaceId`, so the page does not read env inline) and pass
  `{taskSearch}` to the content and screenshot components.
- Add the three link destinations.

`src/components/help/user-guide-navigation.tsx`

- Short labels: en `inbox: "Inbox"`, `tasks: "Tasks"`; zh-TW
  `inbox: "收件匣"`, `tasks: "Tasks"`.

### 7.6 Tests

- `tests/e2e/user-guide.spec.ts`: update the figure count, assert both new
  chapter headings exist in both languages, that the chapter navigation lists
  Inbox and Tasks in the agreed order, that the Inbox link leads to
  `/w/<id>/inbox` and the Tasks links to `/w/<id>/tasks` and `/tasks/setup`, and
  that the search disclosure is absent on the default (flag-off) E2E server.
- `tests/unit/saved-shares-view.test.tsx`: unchanged if the new option defaults;
  add a small assertion that `taskSearch: false` omits the search disclosure and
  `true` includes it.
- Optional capture check: `make guide-screenshots` is manual, as today.

## 8. Decisions made here (owner already agreed)

- A1 chapter order: Inbox after reading, Tasks after Insights.
- Task Search visibility follows the deployment flag.
- Real screenshots through the existing capture harness, not reused documentation
  images.
- Scope is Tasks + Inbox only.

## 8a. Calls made while checking the design

- **Tasks row copy** names only fields both readers show; the verification badge
  and excerpt are described in the flag-on search detail. This keeps one honest
  bullet for both flag states.
- **The setup screen omits the one-time line**, because committing a token-bearing
  line is unsafe and unusable. Prose covers the line instead.
- **One Inbox split screen at 1440px** (the minimum size where the split exists),
  which is within the existing captures' width range and keeps the "one real
  screen per shot" rule; "Open full size" remains the escape hatch.

## 9. Left to the builder

- Final bilingual prose and exact bullet grouping, within the facts above.
- Exact seed data (titles, comment text) for the captures, kept realistic and in
  English interface language.
- Any layout adjustments needed to keep the guide readable at 390px and 1440px
  with two more chapters.
