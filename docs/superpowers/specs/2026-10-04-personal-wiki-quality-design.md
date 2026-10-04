# Personal Wiki quality — MVP batch 3

Scope: personal use only, without image/attachment storage or Team features.

- Sources offers a document-link health report. Resolve the current valid link index against the authorized workspace catalog, return distinct unresolved targets with originating document/path, first line and occurrence count. Cap display at 500 targets, report total and stale-index count explicitly. Wiki and relative Markdown document targets only; anchors and images are outside this check.
- Source update offers exact root-relative file/directory exclusions (no globs), saved per workspace/source in this browser. `.git` and `.obsidian` directories are always excluded. Apply exclusions before manifest creation in the shared launcher so re-selection and remembered-folder sync behave identically. An entirely excluded selection is rejected before creating a snapshot. New exclusions may archive already imported documents through the existing Preview/Apply contract; warn before syncing. Browser-local settings are not an access-control boundary and do not sync across devices.
- Personal Sources and link health offer a manual feedback report download. Include category, user-written description and pathname; never attach document content or automatically send to an external service.

Validation: unit tests for path boundaries, malformed rules, saved-rule upload filtering and empty-selection protection; DB integration for unresolved-link healing and outsider denial; browser verification of persisted settings, link navigation and feedback download. Before/after screenshots compare the same baseline source fixture.
