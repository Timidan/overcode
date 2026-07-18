import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("theme motion routing", () => {
  it("applies an origin-less keyboard theme change without a view transition", async () => {
    const attributes = new Map<string, string>();
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return resolvedTransition();
    });
    installDom(startViewTransition, attributes);
    const { useTheme } = await import("./useTheme");

    useTheme.getState().setTheme("light");

    expect(startViewTransition).not.toHaveBeenCalled();
    expect(attributes.get("data-theme")).toBe("light");
  });

  it("keeps the pointer-origin view transition for direct activation", async () => {
    const attributes = new Map<string, string>();
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return resolvedTransition();
    });
    installDom(startViewTransition, attributes);
    const { useTheme } = await import("./useTheme");

    useTheme.getState().setTheme("light", { x: 24, y: 48 });

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(attributes.get("data-theme")).toBe("light");
  });
});

function installDom(
  startViewTransition: (update: () => void) => ReturnType<typeof resolvedTransition>,
  attributes: Map<string, string>,
) {
  const style = new Map<string, string>();
  const documentElement = {
    classList: { add: vi.fn(), remove: vi.fn() },
    offsetHeight: 0,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    style: { setProperty: (name: string, value: string) => style.set(name, value) },
  };
  vi.stubGlobal("window", {
    localStorage: {
      getItem: vi.fn(() => "dark"),
      setItem: vi.fn(),
    },
    matchMedia: vi.fn(() => ({ matches: false })),
    setTimeout,
  });
  vi.stubGlobal("document", { documentElement, startViewTransition });
}

function resolvedTransition() {
  return {
    ready: Promise.resolve(),
    finished: Promise.resolve(),
    updateCallbackDone: Promise.resolve(),
  };
}
