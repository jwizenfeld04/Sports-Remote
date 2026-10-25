// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ResultPanel } from "../web/components/ResultPanel";

const noop = () => undefined;
afterEach(cleanup);

describe("ResultPanel while a launch is running", () => {
  it("shows the current step of a slow launch", () => {
    render(<ResultPanel pending progress="Finding the channel..." result={null} onKey={noop} onRetry={noop} onDismiss={noop} />);
    expect(screen.getByTestId("launch-toast").textContent).toContain("Finding the channel...");
  });

  it("falls back to the plain message before the first step arrives", () => {
    render(<ResultPanel pending progress={null} result={null} onKey={noop} onRetry={noop} onDismiss={noop} />);
    expect(screen.getByTestId("launch-toast").textContent).toContain("Sending to TV...");
  });
});
