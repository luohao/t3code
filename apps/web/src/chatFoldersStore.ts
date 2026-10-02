import { type EnvironmentId, type ScopedThreadRef, type ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { randomUUID } from "./lib/utils";

export const CHAT_FOLDERS_STORAGE_KEY = "t3code:chat-folders:v1";
export const CHAT_FOLDER_NAME_MAX_LENGTH = 100;

const FolderName = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isNonEmpty(),
  Schema.isMaxLength(CHAT_FOLDER_NAME_MAX_LENGTH),
);
const ChatFolder = Schema.Struct({
  id: Schema.String.check(Schema.isNonEmpty()),
  name: FolderName,
  collapsed: Schema.Boolean,
});
const ChatFolders = Schema.Struct({
  folders: Schema.Array(ChatFolder),
  threadFolders: Schema.Record(Schema.String, Schema.String),
});
const decodeSavedFolders = Schema.decodeSync(Schema.fromJsonString(ChatFolders));
const decodeFolderName = Schema.decodeSync(FolderName);
export type ChatFolder = typeof ChatFolder.Type;
export type ChatFoldersState = typeof ChatFolders.Type;

interface ChatFoldersStore extends ChatFoldersState {
  readonly loadError: Error | null;
  readonly createFolder: (name: string, threads?: readonly ScopedThreadRef[]) => string;
  readonly renameFolder: (folderId: string, name: string) => void;
  /** Removing a folder unfiles its chats; it never changes the conversations. */
  readonly removeFolder: (folderId: string) => void;
  readonly moveThreads: (threads: readonly ScopedThreadRef[], folderId: string | null) => void;
  readonly setCollapsed: (folderId: string, collapsed: boolean) => void;
}

// IDs can themselves contain colons; a tuple keeps environment boundaries intact.
export function chatFolderThreadKey(thread: ScopedThreadRef): string {
  return JSON.stringify([thread.environmentId, thread.threadId]);
}

function assignThreads(
  assignments: ChatFoldersState["threadFolders"],
  threads: readonly ScopedThreadRef[],
  folderId: string | null,
) {
  const next = { ...assignments };
  for (const thread of threads) {
    const key = chatFolderThreadKey(thread);
    if (folderId === null) delete next[key];
    else next[key] = folderId;
  }
  return next;
}

/** Client-owned organization, independent of a chat's project and lifecycle.
 * Writes complete before publishing state, so a storage failure cannot pretend
 * a move was saved. Unreadable saved data stays intact for recovery. */
export function createChatFoldersStore(storage: Pick<Storage, "getItem" | "setItem">) {
  let initial: ChatFoldersState = { folders: [], threadFolders: {} };
  let loadError: Error | null = null;
  try {
    const raw = storage.getItem(CHAT_FOLDERS_STORAGE_KEY);
    if (raw !== null) {
      initial = decodeSavedFolders(raw);
      if (new Set(initial.folders.map((folder) => folder.id)).size !== initial.folders.length) {
        throw new Error("Saved chat folders contain duplicate IDs.");
      }
    }
  } catch (error) {
    loadError = error instanceof Error ? error : new Error(String(error));
    initial = { folders: [], threadFolders: {} };
  }

  return createStore<ChatFoldersStore>()((set, get) => {
    const save = (next: ChatFoldersState) => {
      if (loadError !== null) {
        throw new Error(
          "Saved chat folders could not be loaded. Reload after restoring their data.",
        );
      }
      storage.setItem(CHAT_FOLDERS_STORAGE_KEY, JSON.stringify(next));
      set(next);
    };
    const folderName = (name: string) => decodeFolderName(name.trim());

    return {
      ...initial,
      loadError,
      createFolder: (name, threads = []) => {
        const folder = { id: randomUUID(), name: folderName(name), collapsed: false };
        const state = get();
        save({
          folders: [...state.folders, folder],
          threadFolders: assignThreads(state.threadFolders, threads, folder.id),
        });
        return folder.id;
      },
      renameFolder: (folderId, name) => {
        const state = get();
        const nextName = folderName(name);
        if (!state.folders.some((folder) => folder.id === folderId && folder.name !== nextName))
          return;
        save({
          folders: state.folders.map((folder) =>
            folder.id === folderId ? { ...folder, name: nextName } : folder,
          ),
          threadFolders: state.threadFolders,
        });
      },
      removeFolder: (folderId) => {
        const state = get();
        if (!state.folders.some((folder) => folder.id === folderId)) return;
        save({
          folders: state.folders.filter((folder) => folder.id !== folderId),
          threadFolders: Object.fromEntries(
            Object.entries(state.threadFolders).filter(
              ([, assignedFolder]) => assignedFolder !== folderId,
            ),
          ),
        });
      },
      moveThreads: (threads, folderId) => {
        const state = get();
        if (folderId !== null && !state.folders.some((folder) => folder.id === folderId)) return;
        if (
          threads.every(
            (thread) => (state.threadFolders[chatFolderThreadKey(thread)] ?? null) === folderId,
          )
        )
          return;
        save({
          folders: state.folders,
          threadFolders: assignThreads(state.threadFolders, threads, folderId),
        });
      },
      setCollapsed: (folderId, collapsed) => {
        const state = get();
        if (
          !state.folders.some((folder) => folder.id === folderId && folder.collapsed !== collapsed)
        )
          return;
        save({
          folders: state.folders.map((folder) =>
            folder.id === folderId ? { ...folder, collapsed } : folder,
          ),
          threadFolders: state.threadFolders,
        });
      },
    };
  });
}

export const chatFoldersStore = createChatFoldersStore({
  getItem: (key) => (typeof window === "undefined" ? null : window.localStorage.getItem(key)),
  setItem: (key, value) => {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  },
});

export function useChatFolders<T>(select: (state: ChatFoldersStore) => T): T {
  return useStore(chatFoldersStore, select);
}

/** Preserve the caller's ordering within each folder. Unknown assignments stay
 * unfiled, and collapse only affects rendering: search can still use every chat. */
export function groupChatFolderThreads<
  T extends { readonly environmentId: EnvironmentId; readonly id: ThreadId },
>(threads: readonly T[], state: ChatFoldersState) {
  const folders = state.folders.map((folder) => ({ folder, threads: [] as T[] }));
  const byId = new Map(folders.map((group) => [group.folder.id, group]));
  const unfiled: T[] = [];
  for (const thread of threads) {
    const folderId =
      state.threadFolders[
        chatFolderThreadKey({ environmentId: thread.environmentId, threadId: thread.id })
      ];
    const group = folderId === undefined ? undefined : byId.get(folderId);
    (group?.threads ?? unfiled).push(thread);
  }
  return { folders, unfiled };
}
