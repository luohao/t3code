// @vitest-environment jsdom
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  chatFoldersStore,
  createChatFoldersStore,
  groupChatFolderThreads,
  useChatFolders,
} from "../../chatFoldersStore";
import { dismissContextMenu } from "../../contextMenuFallback";
import { createLocalApi } from "../../localApi";
import {
  ChatFolderDialogHost,
  ChatFolderSection,
  chatFolderMoveMenu,
  handleChatFolderMenuAction,
  requestNewChatFolder,
} from "./ChatFolders";

const chats = [
  {
    environmentId: EnvironmentId.make("local"),
    id: ThreadId.make("one"),
    title: "First conversation",
  },
  {
    environmentId: EnvironmentId.make("remote"),
    id: ThreadId.make("two"),
    title: "Second conversation",
  },
];
const refs = chats.map((chat) => ({ environmentId: chat.environmentId, threadId: chat.id }));

function FolderList() {
  const folders = useChatFolders((state) => state.folders);
  const threadFolders = useChatFolders((state) => state.threadFolders);
  const grouped = groupChatFolderThreads(chats, { folders, threadFolders });
  return (
    <ul>
      {grouped.folders.map((group) => (
        <ChatFolderSection
          key={group.folder.id}
          folder={group.folder}
          threads={group.threads.map((chat) => ({
            environmentId: chat.environmentId,
            threadId: chat.id,
          }))}
        >
          {group.threads.map((chat) => (
            <li key={chat.id}>{chat.title}</li>
          ))}
        </ChatFolderSection>
      ))}
      {grouped.unfiled.map((chat) => (
        <li key={chat.id}>{chat.title}</li>
      ))}
    </ul>
  );
}

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  window.localStorage.clear();
  chatFoldersStore.setState({ folders: [], threadFolders: {}, loadError: null });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <>
        <FolderList />
        <ChatFolderDialogHost />
      </>,
    ),
  );
});

afterEach(async () => {
  dismissContextMenu();
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function nameFolder(name: string) {
  const input = document.querySelector<HTMLInputElement>('input[placeholder="e.g. Research"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}

async function folderAction(name: string, action: string) {
  await act(async () =>
    document.querySelector<HTMLButtonElement>(`button[aria-label="Actions for ${name}"]`)!.click(),
  );
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (entry) => entry.textContent === action,
  )!;
  await act(async () => item.click());
}

async function moveThroughMenu(destination: string) {
  const selection = createLocalApi().contextMenu.show([chatFolderMoveMenu(refs)]);
  const button = (label: string) => {
    const match = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent === label,
    );
    expect(match, `Missing menu item: ${label}`).toBeDefined();
    return match!;
  };
  await act(async () => button("Move to folder").click());
  await act(async () => button(destination).click());
  await act(async () => {
    expect(handleChatFolderMenuAction(await selection, refs)).toBe(true);
  });
}

describe("chat folder controls", () => {
  it("creates a folder from a selection, folds and reopens it, then renames and removes it", async () => {
    await act(async () => requestNewChatFolder(refs));
    await nameFolder("Research");
    expect(chatFoldersStore.getState().folders).toHaveLength(1);
    expect(container.textContent).toContain("First conversation");
    expect(container.textContent).toContain("Second conversation");

    const toggle = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Research, 2 chats"]',
    )!;
    await act(async () => toggle.click());
    expect(container.textContent).not.toContain("First conversation");
    expect(createChatFoldersStore(window.localStorage).getState().folders[0]?.collapsed).toBe(true);
    await act(async () => toggle.click());
    expect(container.textContent).toContain("First conversation");

    await folderAction("Research", "Rename folder");
    await nameFolder("Projects");
    expect(chatFoldersStore.getState().folders[0]?.name).toBe("Projects");
    await folderAction("Projects", "Remove folder");
    expect(chatFoldersStore.getState().folders).toHaveLength(0);
    expect(container.textContent).toContain("First conversation");
    expect(container.textContent).toContain("Second conversation");
  });

  it("moves selected chats between named folders and back through the shared action menu", async () => {
    await act(async () => requestNewChatFolder(refs));
    await nameFolder("First");
    await act(async () => requestNewChatFolder());
    await nameFolder("Second");
    await moveThroughMenu("Second");
    const reloaded = createChatFoldersStore(window.localStorage).getState();
    const grouped = groupChatFolderThreads(chats, reloaded);
    expect(grouped.folders.find((group) => group.folder.name === "First")?.threads).toHaveLength(0);
    expect(grouped.folders.find((group) => group.folder.name === "Second")?.threads).toHaveLength(
      2,
    );
    await moveThroughMenu("No folder");
    expect(groupChatFolderThreads(chats, chatFoldersStore.getState()).unfiled).toEqual(chats);
  });
});
