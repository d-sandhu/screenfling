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
  it("makes Copy only explicit when no connection is configured", () => {
    const markup = renderToStaticMarkup(
      createElement(DestinationPicker, {
        destinations: [],
        loading: false,
        onRefresh: () => undefined,
        onSelect: () => undefined,
        selectedId: null,
        status: "not-configured",
      }),
    );

    expect(markup).toContain("No connection is active.");
    expect(markup).toContain("Connect WezTerm on the start screen.");
    expect(markup).toContain("Copy only still works.");
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
  it("shows terminal titles as text beside the exact pane identity", () => {
    const destination = parseDestination({
      ...COPY_ONLY_DESTINATION,
      context: {
        title: '<img src=x onerror="alert(1)"> & review',
        observedAt: "2026-09-16T12:00:00.000Z",
      },
    });
    const markup = renderToStaticMarkup(
      createElement(DestinationPicker, {
        destinations: [destination],
        loading: false,
        selectedId: null,
        onRefresh: () => undefined,
        onSelect: () => undefined,
      }),
    );
    expect(markup).toContain("instrumented · pane 7");
    expect(markup).toContain("&lt;img");
    expect(markup).toContain("&amp; review");
    expect(markup).not.toContain("<img");
    expect(markup).toContain("Context unavailable");
    expect(markup).toContain("Copy only");
  });

  it("keeps duplicate titles distinct without selecting a pane", () => {
    const destinations = [7, 8].map((id) =>
      parseDestination({
        ...COPY_ONLY_DESTINATION,
        id: `instrumented:copy-only:${id}`,
        surface: { kind: "pane", locator: String(id) },
        context: {
          title: "Same project",
          cwd: "/same-project",
          observedAt: "2026-09-16T12:00:00.000Z",
        },
      }),
    );
    const markup = renderToStaticMarkup(
      createElement(DestinationPicker, {
        destinations,
        loading: false,
        selectedId: null,
        onRefresh: () => undefined,
        onSelect: () => undefined,
      }),
    );
    expect(markup).toContain("instrumented · pane 7");
    expect(markup).toContain("instrumented · pane 8");
    expect(markup.match(/type="radio"/gu)).toHaveLength(2);
    expect(markup).not.toContain("checked=");
  });

});
