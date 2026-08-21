import { describe, expect, it } from "vitest";

import {
  MAX_NOTE_LENGTH,
  destinationSchema,
  parseDestination,
  parseNote,
  receiptForDestination,
  supportsReveal,
  supportsStage,
} from "./domain";

import type { DestinationInput } from "./domain";

const validDestination: DestinationInput = {
  id: "instrumented-terminal:42",
  adapter: "instrumented-terminal",
  endpoint: { scope: "local", instanceId: "test-process-1" },
  surface: { kind: "terminal", locator: "42" },
  context: {
    cwd: "/Users/example/Code/screenfling",
    repoRoot: "/Users/example/Code/screenfling",
    worktree: "/Users/example/Code/screenfling",
    revision: "abc1234",
    observedAt: "2026-08-19T20:00:00.000Z",
  },
  capabilities: {
    address: "exact",
    imageInput: "clipboard-key",
    textInput: "paste",
    readBack: "none",
    verification: ["target-live"],
    actions: ["copy", "stage"],
  },
};

describe("note contract", () => {
  it("preserves printable literal data", () => {
    const note = `quotes ' " \\ Unicode 🖼️ key-like Enter`;
    expect(parseNote(note)).toBe(note);
  });

  it.each([
    "two\nlines",
    "carriage\rreturn",
    "tab\tcharacter",
    "nul\u0000byte",
    "line\u2028separator",
    "paragraph\u2029separator",
  ])("rejects non-single-line data in %j", (note) => {
    expect(() => parseNote(note)).toThrow();
  });

  it("enforces a bounded note size", () => {
    expect(parseNote("a".repeat(MAX_NOTE_LENGTH))).toHaveLength(MAX_NOTE_LENGTH);
    expect(() => parseNote("a".repeat(MAX_NOTE_LENGTH + 1))).toThrow();
  });

  it("counts astral Unicode by code point", () => {
    expect(parseNote("😀".repeat(MAX_NOTE_LENGTH))).toBe("😀".repeat(MAX_NOTE_LENGTH));
    expect(() => parseNote("😀".repeat(MAX_NOTE_LENGTH + 1))).toThrow();
  });
});

describe("destination contract", () => {
  it("accepts an exact stage destination and freezes the decoded value", () => {
    const destination = parseDestination(validDestination);
    expect(destination.capabilities.actions).toEqual(["copy", "stage"]);
    expect(Object.isFrozen(destination)).toBe(true);
  });

  it("reports whether the destination supports the requested Stage capability", () => {
    const destination = parseDestination(validDestination);
    const copyOnly = parseDestination({
      ...validDestination,
      capabilities: {
        ...validDestination.capabilities,
        actions: ["copy"],
        verification: [],
      },
    });
    const imageOnly = parseDestination({
      ...validDestination,
      capabilities: { ...validDestination.capabilities, textInput: "none" },
    });

    expect(supportsStage(destination, false)).toBe(true);
    expect(supportsStage(destination, true)).toBe(true);
    expect(supportsStage(copyOnly, false)).toBe(false);
    expect(supportsStage(imageOnly, false)).toBe(true);
    expect(supportsStage(imageOnly, true)).toBe(false);
  });

  it("requires an exact live target before advertising Reveal", () => {
    const revealable = parseDestination({
      ...validDestination,
      capabilities: {
        ...validDestination.capabilities,
        actions: ["copy", "stage", "reveal"],
      },
    });
    const copyOnly = parseDestination({
      ...validDestination,
      capabilities: {
        ...validDestination.capabilities,
        actions: ["copy"],
        verification: [],
      },
    });

    expect(supportsReveal(revealable)).toBe(true);
    expect(supportsReveal(copyOnly)).toBe(false);
    expect(() =>
      parseDestination({
        ...validDestination,
        capabilities: {
          ...validDestination.capabilities,
          actions: ["copy", "reveal"],
          verification: [],
        },
      }),
    ).toThrow();
  });

  it("reduces a result destination to its exact display identity", () => {
    expect(receiptForDestination(parseDestination(validDestination))).toEqual({
      id: validDestination.id,
      adapter: validDestination.adapter,
      surface: validDestination.surface,
    });
  });

  it("rejects best-effort automation", () => {
    expect(() =>
      parseDestination({
        ...validDestination,
        capabilities: {
          ...validDestination.capabilities,
          address: "best-effort",
        },
      }),
    ).toThrow();
  });

  it("requires completion evidence before exposing Send", () => {
    expect(() =>
      parseDestination({
        ...validDestination,
        capabilities: {
          ...validDestination.capabilities,
          readBack: "structured",
          actions: ["copy", "stage", "send"],
        },
      }),
    ).toThrow();
  });

  it("does not treat target and completion evidence as proof of staged input", () => {
    expect(() =>
      parseDestination({
        ...validDestination,
        capabilities: {
          ...validDestination.capabilities,
          readBack: "structured",
          verification: ["target-live", "turn-completed"],
          actions: ["copy", "stage", "send"],
        },
      }),
    ).toThrow();
  });

  it("requires live-target evidence before exposing Stage", () => {
    expect(() =>
      parseDestination({
        ...validDestination,
        capabilities: {
          ...validDestination.capabilities,
          verification: [],
        },
      }),
    ).toThrow();
  });

  it("accepts verified Send only with read-back and completion evidence", () => {
    const destination = parseDestination({
      ...validDestination,
      capabilities: {
        ...validDestination.capabilities,
        readBack: "structured",
        verification: ["target-live", "composer-ready", "image-attached", "turn-completed"],
        actions: ["copy", "stage", "send"],
      },
    });
    expect(destination.capabilities.actions).toContain("send");
  });

  it("rejects duplicate capability claims and unknown fields", () => {
    expect(() =>
      parseDestination({
        ...validDestination,
        capabilities: {
          ...validDestination.capabilities,
          actions: ["copy", "copy"],
        },
      }),
    ).toThrow();

    expect(
      destinationSchema.safeParse({
        ...validDestination,
        undocumentedRoutingHint: "active-window",
      }).success,
    ).toBe(false);
  });
});
