import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  CHAT_FOLDERS_STORAGE_KEY,
  chatFolderThreadKey,
  createChatFoldersStore,
  groupChatFolderThreads,
} from "./chatFoldersStore";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
const ref = (environment: string, thread: string) => ({
  environmentId: EnvironmentId.make(environment),
  threadId: ThreadId.make(thread),
});
const thread = (environment: string, id: string) => ({
  environmentId: EnvironmentId.make(environment),
  id: ThreadId.make(id),
});

describe("chat folders", () => {
  it("creates, moves, renames and folds chats durably across store reloads", () => {
    const storage = memoryStorage();
    const store = createChatFoldersStore(storage);
    const first = ref("local", "one");
    const second = ref("remote", "two");
    const research = store.getState().createFolder("  Research  ", [first]);
    const work = store.getState().createFolder("Work");
    store.getState().moveThreads([first, second], work);
    store.getState().renameFolder(work, "  Active work ");
    store.getState().setCollapsed(work, true);

    const reloaded = createChatFoldersStore(storage).getState();
    expect(reloaded.folders.map((folder) => [folder.name, folder.collapsed])).toEqual([
      ["Research", false],
      ["Active work", true],
    ]);
    const groups = groupChatFolderThreads(
      [thread("local", "one"), thread("remote", "two")],
      reloaded,
    );
    expect(groups.folders.find((group) => group.folder.id === research)?.threads).toHaveLength(0);
    expect(groups.folders.find((group) => group.folder.id === work)?.threads).toHaveLength(2);
    expect(groups.unfiled).toHaveLength(0);
  });

  it("unfiles a selection or removes a folder without changing chats in other folders", () => {
    const storage = memoryStorage();
    const store = createChatFoldersStore(storage);
    const refs = [ref("local", "a"), ref("local", "b"), ref("remote", "c")];
    const first = store.getState().createFolder("First", refs.slice(0, 2));
    const other = store.getState().createFolder("Other", [refs[2]!]);
    store.getState().moveThreads([refs[0]!], null);
    store.getState().removeFolder(first);

    const reloaded = createChatFoldersStore(storage).getState();
    const chats = [thread("local", "a"), thread("local", "b"), thread("remote", "c")];
    const grouped = groupChatFolderThreads(chats, reloaded);
    expect(grouped.unfiled).toEqual(chats.slice(0, 2));
    expect(grouped.folders[0]?.folder.id).toBe(other);
    expect(grouped.folders[0]?.threads).toEqual([chats[2]]);
  });

  it("keeps identical native thread IDs and colon-containing IDs in separate environments", () => {
    const store = createChatFoldersStore(memoryStorage());
    const first = store.getState().createFolder("A", [ref("env:a", "b")]);
    const second = store.getState().createFolder("B", [ref("env", "a:b")]);
    const third = store.getState().createFolder("C", [ref("remote", "b")]);
    const groups = groupChatFolderThreads(
      [thread("env:a", "b"), thread("env", "a:b"), thread("remote", "b")],
      store.getState(),
    );
    expect(groups.folders.map((group) => [group.folder.id, group.threads.length])).toEqual([
      [first, 1],
      [second, 1],
      [third, 1],
    ]);
  });

  it("keeps hidden chats available for search and unknown assignments in the normal list", () => {
    const store = createChatFoldersStore(memoryStorage());
    const folderId = store.getState().createFolder("Hidden", [ref("env", "hidden")]);
    store.getState().setCollapsed(folderId, true);
    const chats = [thread("env", "hidden"), thread("env", "orphan"), thread("env", "unfiled")];
    const state = {
      ...store.getState(),
      threadFolders: {
        ...store.getState().threadFolders,
        [chatFolderThreadKey(ref("env", "orphan"))]: "missing",
      },
    };
    const grouped = groupChatFolderThreads(chats, state);
    expect(grouped.folders[0]?.threads).toEqual([chats[0]]);
    expect(
      grouped.folders.filter((group) => !group.folder.collapsed).flatMap((group) => group.threads),
    ).toEqual([]);
    expect(grouped.unfiled).toEqual(chats.slice(1));
    expect(chats.map((chat) => chat.id)).toEqual(["hidden", "orphan", "unfiled"]);
  });

  it("rejects blank folder names and stale move destinations without losing membership", () => {
    const store = createChatFoldersStore(memoryStorage());
    expect(() => store.getState().createFolder("   ")).toThrow();
    const folder = store.getState().createFolder("Valid", [ref("env", "one")]);
    const before = store.getState();
    expect(() => store.getState().renameFolder(folder, "")).toThrow();
    store.getState().moveThreads([ref("env", "one")], "removed");
    expect(store.getState()).toBe(before);
  });

  it("leaves the displayed and saved state intact when a move cannot be persisted", () => {
    const storage = memoryStorage();
    const store = createChatFoldersStore(storage);
    const folder = store.getState().createFolder("Saved", [ref("env", "one")]);
    const before = store.getState();
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("Storage quota exceeded");
    });
    expect(() => store.getState().moveThreads([ref("env", "one")], null)).toThrow(
      "Storage quota exceeded",
    );
    expect(store.getState()).toBe(before);
    expect(
      createChatFoldersStore(storage).getState().threadFolders[
        chatFolderThreadKey(ref("env", "one"))
      ],
    ).toBe(folder);
  });

  it("preserves unreadable saved data and does not overwrite it with empty folders", () => {
    const storage = memoryStorage();
    storage.setItem(CHAT_FOLDERS_STORAGE_KEY, "{broken");
    const store = createChatFoldersStore(storage);
    expect(store.getState().loadError).toBeInstanceOf(Error);
    expect(() => store.getState().createFolder("Replacement")).toThrow("could not be loaded");
    expect(storage.getItem(CHAT_FOLDERS_STORAGE_KEY)).toBe("{broken");
  });
});
