import { describe, expect, it } from "vitest";
import { applySegmentEdits, stripGmCommandTags } from "./segment-edits";

describe("game segment edit command stripping", () => {
  it("removes unknown balanced tags with nested JSON payloads", () => {
    expect(stripGmCommandTags('The room shifts. [debug: {"items":["torch"]}] Continue forward.')).toBe(
      "The room shifts.  Continue forward.",
    );
  });

  it("keeps readable tags and ignores brackets inside quoted unknown tag values", () => {
    expect(
      stripGmCommandTags('Read this. [Note: nested [clue] text] [debug: {"text":"not ] done","items":["torch"]}]'),
    ).toBe("Read this. [Note: nested [clue] text]");
  });

  it("keeps unknown-looking text inside readable tag payloads", () => {
    expect(stripGmCommandTags('[Note: Keep literal [debug: {"x":1}] text] [debug: {"drop":true}]')).toBe(
      '[Note: Keep literal [debug: {"x":1}] text]',
    );
  });

  it("does not leak unknown nested tag fragments when applying segment edits", () => {
    const content = ['The room shifts. [debug: {"items":["torch"]}]', "", '[Guide]: "Keep moving."'].join("\n");

    expect(applySegmentEdits(content, { 0: { content: "The room steadies." } })).toBe(
      ["The room steadies.", '[Guide]: "Keep moving."'].join("\n\n"),
    );
  });
});
