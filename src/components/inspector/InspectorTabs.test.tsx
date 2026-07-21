import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InspectorTabs, type InspectorPage } from "./InspectorTabs";

afterEach(cleanup);

const pages: Array<{ id: InspectorPage; label: string }> = [
  { id: "image", label: "图片" },
  { id: "composition", label: "构图" },
  { id: "tone", label: "色调" },
  { id: "effects", label: "光效" },
  { id: "interface", label: "界面" },
];

describe("InspectorTabs", () => {
  it("renders five linked tabs with roving focus", () => {
    render(<InspectorTabs pages={pages} activePage="composition" onPageChange={vi.fn()} />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["图片", "构图", "色调", "光效", "界面"]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1, -1, -1]);
    expect(screen.getByRole("tab", { name: "构图" })).toHaveAttribute("aria-controls", "inspector-panel-composition");
  });

  it("wraps ArrowRight and ArrowLeft while moving focus and selection", () => {
    function TabsHarness() {
      const [activePage, setActivePage] = useState<InspectorPage>("interface");
      return <InspectorTabs pages={pages} activePage={activePage} onPageChange={setActivePage} />;
    }
    render(<TabsHarness />);

    const last = screen.getByRole("tab", { name: "界面" });
    last.focus();
    fireEvent.keyDown(last, { key: "ArrowRight" });
    const first = screen.getByRole("tab", { name: "图片" });
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(first).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(last).toHaveFocus();
    expect(last).toHaveAttribute("aria-selected", "true");
    expect(last).toHaveAttribute("tabindex", "0");
  });
});
