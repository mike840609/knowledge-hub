# Mermaid in the reader: verification

Spec: `../specs/2026-10-13-reader-mermaid-design.md`.

## What was assumed of Mermaid

Installed: `mermaid@12.2.0`.
`node scripts/test/mermaid-assumptions.mjs`, 2026-10-13:

```json
{
  "types": {
    "flowchart": {
      "svgIsString": true,
      "diagramType": "flowchart-v2",
      "viewBox": true,
      "foreignObject": false,
      "loadsAsImage": true
    },
    "sequence": {
      "svgIsString": true,
      "diagramType": "sequence",
      "viewBox": true,
      "foreignObject": false,
      "loadsAsImage": true
    },
    "class": {
      "svgIsString": true,
      "diagramType": "classDiagram",
      "viewBox": true,
      "foreignObject": false,
      "loadsAsImage": true
    },
    "state": {
      "svgIsString": true,
      "diagramType": "stateDiagram",
      "viewBox": true,
      "foreignObject": false,
      "loadsAsImage": true
    },
    "er": {
      "svgIsString": true,
      "diagramType": "er",
      "viewBox": true,
      "foreignObject": false,
      "loadsAsImage": true
    },
    "gantt": {
      "svgIsString": true,
      "diagramType": "gantt",
      "viewBox": true,
      "foreignObject": false,
      "loadsAsImage": true
    },
    "pie": {
      "svgIsString": true,
      "diagramType": "pie",
      "viewBox": true,
      "foreignObject": false,
      "loadsAsImage": true
    },
    "mindmap": {
      "svgIsString": true,
      "diagramType": "mindmap",
      "viewBox": true,
      "foreignObject": false,
      "loadsAsImage": true
    }
  },
  "directiveGaveHtml": false,
  "lateDirectiveGaveHtml": false,
  "frontmatterGaveHtml": false,
  "carried": {
    "directive": {
      "gaveHtml": false
    },
    "lateDirective": {
      "gaveHtml": false
    },
    "frontmatter": {
      "gaveHtml": false
    }
  },
  "rejected": true,
  "leftInPage": 0,
  "refused": []
}
```

The script printed `OK` and exited 0. Mermaid is initialised with
`secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges", "htmlLabels"]`:
the installed 12.2.0 default list plus `htmlLabels`. Without `htmlLabels` in that list, an
`%%{init}%%` directive turned HTML labels on (first run of this script, which exited 1). With it, a
directive before the first line, a directive after it, and YAML frontmatter `config:` each came out
without `<foreignObject>` (`directiveGaveHtml`, `lateDirectiveGaveHtml`, `frontmatterGaveHtml` all
false; none of the three threw).

Diagram types turned away by the `<foreignObject>` rule: none of the eight tried.
