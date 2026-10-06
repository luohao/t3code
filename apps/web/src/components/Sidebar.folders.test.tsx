// @vitest-environment jsdom
import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ThreadId,
  type ClientSettings,
  type EnvironmentMachineKind,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { chatFoldersStore, createChatFoldersStore } from "../chatFoldersStore";
import { dismissContextMenu } from "../contextMenuFallback";
import { makeThreadFixture } from "../test-fixtures";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { AppAtomRegistryProvider } from "../rpc/atomRegistry";
import type { Project } from "../types";

vi.mock("../state/entities", async (original) => ({
  ...(await original<typeof import("../state/entities")>()),
  useProjects: () => projects,
  useThreadShells: () => threads,
  useAllEnvironmentProjectSnapshotsReady: () => true,
  readThreadShell: () => threads[0],
}));
vi.mock("../state/environments", async (original) => ({
  ...(await original<typeof import("../state/environments")>()),
  useEnvironmentIdentities: () => environments,
  useEnvironmentMachines: () => machines,
  useConnectedEnvironmentIds: () => environmentIds,
  usePrimaryEnvironmentId: () => environmentId,
}));
// Settlement and snooze classify only on servers that report the capability.
vi.mock("../state/server", async (original) => {
  const { Atom } = await import("effect/reactivity");
  const capabilities = { threadSettlement: true, threadSnooze: true };
  return {
    ...(await original<typeof import("../state/server")>()),
    environmentServerConfigsAtom: Atom.make(
      new Map([["local", { environment: { capabilities }, providers: [] }]]),
    ),
  };
});
vi.mock("../state/query", () => ({ useEnvironmentQuery: () => ({ data: null }) }));
vi.mock("../state/queries", () => ({ useThreadSearch: () => ({ matches: [], isPending: false }) }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../hooks/useSettings", () => ({
  useClientSettings: (select: (settings: ClientSettings) => unknown) =>
    select(DEFAULT_CLIENT_SETTINGS),
}));
vi.mock("../hooks/useHandleNewThread", () => ({
  useHandleNewThread: () => ({ handleNewThread: vi.fn() }),
}));
vi.mock("../hooks/useThreadActions", () => ({
  useThreadActions: () => ({}),
  useAcknowledgeThreadWoke: () => vi.fn(),
}));
vi.mock("../hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({ copyToClipboard: vi.fn() }),
}));
vi.mock("./sidebar/SidebarChrome", () => ({
  SidebarChromeHeader: () => null,
  SidebarChromeFooter: () => null,
}));

import Sidebar from "./Sidebar";
import { SidebarProvider } from "./ui/sidebar";

const environmentId = EnvironmentId.make("local");
const threadId = ThreadId.make("folder-move-session");
const threads = [
  makeThreadFixture({
    environmentId,
    id: threadId,
    title: "Move this session",
    settledOverride: "active",
  }),
  makeThreadFixture({
    environmentId,
    id: ThreadId.make("folder-move-second"),
    title: "Second session",
    settledOverride: "active",
  }),
  makeThreadFixture({
    environmentId,
    id: ThreadId.make("folder-settled"),
    title: "Settled session",
    settledOverride: "settled",
  }),
  makeThreadFixture({
    environmentId,
    id: ThreadId.make("folder-snoozed"),
    title: "Snoozed session",
    settledOverride: "active",
    snoozedUntil: "2999-01-01T00:00:00.000Z",
  }),
];
const projects: readonly Project[] = [
  {
    environmentId,
    id: threads[0]!.projectId,
    title: "Test project",
    workspaceRoot: "/tmp/t3code-folder-fixture",
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
  },
];
const environments = [{ environmentId, label: "Local" }];
const environmentIds = [environmentId];
const machines = new Map<EnvironmentId, EnvironmentMachineKind>();

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: () => ({
      playState: "finished",
      effect: { getComputedTiming: () => ({ progress: 1 }) },
      cancel() {},
      addEventListener() {},
    }),
  });
  Reflect.deleteProperty(window, "desktopBridge");
  window.localStorage.clear();
  chatFoldersStore.setState({ folders: [], threadFolders: {}, loadError: null });
  useThreadSelectionStore.getState().clearSelection();
  chatFoldersStore.getState().createFolder("eli5");
  chatFoldersStore.getState().createFolder("Other");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const rootRoute = createRootRoute({
    component: () => (
      <SidebarProvider>
        <Sidebar />
      </SidebarProvider>
    ),
  });
  const threadRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/$environmentId/$threadId",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([threadRoute]),
    history: createMemoryHistory({ initialEntries: [`/${environmentId}/${threadId}`] }),
  });
  await router.load();
  await act(async () =>
    root.render(
      <AppAtomRegistryProvider>
        <RouterProvider router={router} />
      </AppAtomRegistryProvider>,
    ),
  );
});

afterEach(async () => {
  dismissContextMenu();
  await act(async () => root.unmount());
  document.body.replaceChildren();
  Reflect.deleteProperty(HTMLElement.prototype, "getAnimations");
  Reflect.deleteProperty(HTMLElement.prototype, "animate");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function row(title = "Move this session") {
  const result = container.querySelector<HTMLElement>(
    `[data-thread-item] [aria-label="${title}, Test project"]`,
  );
  expect(result).not.toBeNull();
  return result!;
}

function measureDragLayout() {
  // jsdom has no layout. Give the real draggable rows and drop zones distinct
  // bounds; dnd-kit still owns activation, hit testing, and release.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const header =
      this.tagName === "LI"
        ? this.querySelector<HTMLButtonElement>(":scope > div > button[aria-label]")
        : null;
    const label = header?.getAttribute("aria-label") ?? "";
    const y =
      this.dataset.testid === "chat-folder-unfile-target"
        ? 600
        : label.startsWith("eli5,")
          ? 200
          : label.startsWith("Other,")
            ? 400
            : this.matches('[data-thread-item], [role="button"]')
              ? 100
              : 0;
    const height =
      this.dataset.testid === "chat-folder-unfile-target"
        ? 36
        : header
          ? 100
          : this.matches('[data-thread-item], [role="button"]')
            ? 78
            : 800;
    return {
      x: 0,
      y,
      top: y,
      bottom: y + height,
      left: 0,
      right: 256,
      width: 256,
      height,
      toJSON: () => ({}),
    };
  });
}

function pointer(type: string, y: number, buttons = 1) {
  return Object.assign(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons,
      clientX: 80,
      clientY: y,
    }),
    { pointerId: 1, isPrimary: true, pointerType: "mouse" },
  );
}

async function dragTo(y: number, title = "Move this session", cancel = false) {
  await act(async () => row(title).dispatchEvent(pointer("pointerdown", 120)));
  await act(async () => document.dispatchEvent(pointer("pointermove", 130)));
  await act(async () => document.dispatchEvent(pointer("pointermove", y)));
  await act(async () =>
    document.dispatchEvent(pointer(cancel ? "pointercancel" : "pointerup", y, 0)),
  );
  // Real pointer release emits a click; the sensor consumes it so a drop
  // cannot navigate the session or fold the target.
  await act(async () => document.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

async function moveTo(name: string) {
  await act(async () =>
    row().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
  );
  await new Promise(requestAnimationFrame);
  const menuButton = (label: string) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (entry) => entry.textContent === label,
    );
    expect(button, `Missing menu item: ${label}`).toBeDefined();
    return button!;
  };
  await act(async () => menuButton("Move to folder").click());
  await act(async () => menuButton(name).click());
}

describe("sidebar folder moves", () => {
  it("drags into a folder, into a collapsed folder, and back to the normal list", async () => {
    measureDragLayout();
    await dragTo(220);
    expect(
      container.querySelector('[aria-label="eli5, 1 chats"]')?.closest("li")?.contains(row()),
    ).toBe(true);
    await act(async () =>
      chatFoldersStore.getState().setCollapsed(chatFoldersStore.getState().folders[1]!.id, true),
    );
    await dragTo(420);
    expect(container.querySelector('[aria-label="Other, 1 chats"]')).not.toBeNull();
    const saved = createChatFoldersStore(window.localStorage).getState();
    expect(Object.values(saved.threadFolders)).toEqual([saved.folders[1]!.id]);
    expect(saved.folders[1]!.collapsed).toBe(true);
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Other, 1 chats"]')!.click(),
    );
    await dragTo(620);
    expect(createChatFoldersStore(window.localStorage).getState().threadFolders).toEqual({});
    expect(row().closest("[data-thread-selection-safe]")).toBeNull();
    expect(threads[0]!.settledOverride).toBe("active");
  });

  it("moves a dragged multi-selection together and ignores a cancelled drag", async () => {
    measureDragLayout();
    await dragTo(220, "Move this session", true);
    expect(createChatFoldersStore(window.localStorage).getState().threadFolders).toEqual({});
    await act(async () => {
      row().dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true, ctrlKey: true }));
      row("Second session").dispatchEvent(
        new MouseEvent("click", { bubbles: true, metaKey: true, ctrlKey: true }),
      );
    });
    expect(useThreadSelectionStore.getState().selectedThreadKeys.size).toBe(2);
    await dragTo(220);
    expect(
      container
        .querySelector('[aria-label="eli5, 2 chats"]')
        ?.closest("li")
        ?.contains(row("Second session")),
    ).toBe(true);
    expect(
      Object.keys(createChatFoldersStore(window.localStorage).getState().threadFolders),
    ).toHaveLength(2);
    expect(useThreadSelectionStore.getState().selectedThreadKeys.size).toBe(0);
  });

  it("moves the actual sidebar session into a folder, between folders, and back out", async () => {
    await moveTo("eli5");
    expect(
      container.querySelector('[aria-label="eli5, 1 chats"]')?.closest("li")?.contains(row()),
    ).toBe(true);
    expect(
      Object.keys(createChatFoldersStore(window.localStorage).getState().threadFolders),
    ).toHaveLength(1);
    await moveTo("Other");
    expect(
      container.querySelector('[aria-label="Other, 1 chats"]')?.closest("li")?.contains(row()),
    ).toBe(true);
    await moveTo("No folder");
    expect(
      container.querySelector('[aria-label="Other, 0 chats"]')?.closest("li")?.contains(row()),
    ).toBe(false);
  });
});

describe("sidebar folder counts", () => {
  it("counts live chats and keeps snoozed and settled chats listed but uncounted", async () => {
    const folder = chatFoldersStore.getState().folders[0]!;
    await act(async () =>
      chatFoldersStore.getState().moveThreads(
        threads.map((thread) => scopeThreadRef(thread.environmentId, thread.id)),
        folder.id,
      ),
    );
    const header = container.querySelector('[aria-label="eli5, 2 active of 4 chats"]');
    expect(header?.lastElementChild?.textContent).toBe("2");
    for (const title of ["Second session", "Settled session", "Snoozed session"]) {
      expect(header?.closest("li")?.contains(row(title))).toBe(true);
    }
    await act(async () =>
      chatFoldersStore.getState().moveThreads([scopeThreadRef(environmentId, threadId)], null),
    );
    expect(container.querySelector('[aria-label="eli5, 1 active of 3 chats"]')).not.toBeNull();
  });
});
