import { useRef, type KeyboardEvent } from "react";

export type InspectorPage = "image" | "composition" | "tone" | "effects" | "interface";

export interface InspectorTabDefinition {
  id: InspectorPage;
  label: string;
}

export interface InspectorTabsProps {
  pages: InspectorTabDefinition[];
  activePage: InspectorPage;
  onPageChange(page: InspectorPage): void;
}

export function InspectorTabs({ pages, activePage, onPageChange }: InspectorTabsProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectByOffset = (event: KeyboardEvent<HTMLButtonElement>, offset: number) => {
    const currentIndex = pages.findIndex((page) => page.id === event.currentTarget.dataset.page);
    if (currentIndex < 0) return;
    event.preventDefault();
    const nextIndex = (currentIndex + offset + pages.length) % pages.length;
    const nextPage = pages[nextIndex];
    onPageChange(nextPage.id);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <div className="inspector-tabs" role="tablist" aria-label="主题调整分类">
      {pages.map((page, index) => (
        <button
          key={page.id}
          ref={(node) => { tabRefs.current[index] = node; }}
          type="button"
          role="tab"
          id={`inspector-tab-${page.id}`}
          data-page={page.id}
          aria-selected={activePage === page.id}
          aria-controls={`inspector-panel-${page.id}`}
          tabIndex={activePage === page.id ? 0 : -1}
          onClick={() => onPageChange(page.id)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") selectByOffset(event, 1);
            if (event.key === "ArrowLeft") selectByOffset(event, -1);
          }}
        >
          {page.label}
        </button>
      ))}
    </div>
  );
}
