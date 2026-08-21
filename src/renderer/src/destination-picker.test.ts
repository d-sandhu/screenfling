import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { parseDestination } from "../../shared/domain";
import { DestinationPicker } from "./destination-picker";

const COPY_ONLY_DESTINATION = parseDestination({
  id: "instrumented:copy-only:7",
  adapter: "instrumented",
  endpoint: { scope: "local", instanceId: "generation-a" },
  surface: { kind: "pane", locator: "7" },
  capabilities: {
    address: "exact",
    imageInput: "clipboard-key",
    textInput: "none",
    readBack: "none",
    verification: [],
    actions: ["copy"],
  },
});

describe("destination picker recovery", () => {
  it("makes Copy only explicit when no supported exact destination is available", () => {
    const markup = renderToStaticMarkup(
      createElement(DestinationPicker, {
        destinations: [],
        loading: false,
        onRefresh: () => undefined,
        onSelect: () => undefined,
        selectedId: null,
      }),
    );

    expect(markup).toContain("No supported exact destination is available. Copy only still works.");
  });

  it("labels a destination that cannot Stage as Copy only", () => {
    const markup = renderToStaticMarkup(
      createElement(DestinationPicker, {
        destinations: [COPY_ONLY_DESTINATION],
        loading: false,
        onRefresh: () => undefined,
        onSelect: () => undefined,
        selectedId: COPY_ONLY_DESTINATION.id,
      }),
    );

    expect(markup).toContain("Copy only");
    expect(markup).not.toContain("Unverified");
  });
});
