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
  "directiveGaveHtml": true,
  "rejected": true,
  "leftInPage": 0,
  "refused": []
}
```

The script exited 1 with one line under `FAILED`: `an init directive turned html labels back on`.
Every other check passed. By the spec's table that line is not a stop: a leading
`%%{…}%%` directive is stripped before drawing (Task 3), and the spec's table says so.

Diagram types turned away by the `<foreignObject>` rule: none of the eight tried.
