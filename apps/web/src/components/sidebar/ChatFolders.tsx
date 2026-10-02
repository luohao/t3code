import type { ContextMenuItem, ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { ChevronRightIcon, FolderIcon, FolderOpenIcon, MoreHorizontalIcon } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { create } from "zustand";
import {
  CHAT_FOLDER_NAME_MAX_LENGTH,
  type ChatFolder,
  chatFoldersStore,
  chatFolderThreadKey,
  useChatFolders,
} from "../../chatFoldersStore";
import { useThreadSelectionStore } from "../../threadSelectionStore";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "../ui/menu";
import { toastManager } from "../ui/toast";

export type ChatFolderMenuId =
  | "chat-folder"
  | "chat-folder:none"
  | "chat-folder:new"
  | `chat-folder:move:${string}`;

type FolderEditRequest = {
  readonly folderId: string | null;
  readonly name: string;
  readonly threads: readonly ScopedThreadRef[];
};
const useFolderEdit = create<{ request: FolderEditRequest | null }>(() => ({ request: null }));

export function requestNewChatFolder(threads: readonly ScopedThreadRef[] = []) {
  useFolderEdit.setState({ request: { folderId: null, name: "", threads } });
}

function requestFolderRename(folder: ChatFolder) {
  useFolderEdit.setState({ request: { folderId: folder.id, name: folder.name, threads: [] } });
}

function reportFolderError(error: unknown) {
  toastManager.add({
    type: "error",
    title: "Could not save chat folders",
    description: error instanceof Error ? error.message : "Please try again.",
  });
}

/** One move menu for sidebar rows, bulk selections, and the chat header. */
export function chatFolderMoveMenu(
  threads: readonly ScopedThreadRef[],
): ContextMenuItem<ChatFolderMenuId> {
  const state = chatFoldersStore.getState();
  const assigned = threads.map(
    (thread) => state.threadFolders[chatFolderThreadKey(thread)] ?? null,
  );
  return {
    id: "chat-folder",
    label: "Move to folder",
    icon: "folder",
    children: [
      { id: "chat-folder:none", label: "No folder", checked: assigned.every((id) => id === null) },
      ...state.folders.map((folder) => ({
        id: `chat-folder:move:${folder.id}` as const,
        label: folder.name,
        checked: assigned.every((id) => id === folder.id),
      })),
      { id: "chat-folder:new", label: "New folder…", separatorBefore: true },
    ],
  };
}

export function handleChatFolderMenuAction(
  action: string | null | undefined,
  threads: readonly ScopedThreadRef[],
): boolean {
  if (action === "chat-folder:new") {
    requestNewChatFolder(threads);
    return true;
  }
  if (action !== "chat-folder:none" && !action?.startsWith("chat-folder:move:")) return false;
  const folderId = action === "chat-folder:none" ? null : action.slice("chat-folder:move:".length);
  try {
    const state = chatFoldersStore.getState();
    const folder = state.folders.find((candidate) => candidate.id === folderId);
    if (folderId !== null && folder === undefined) {
      toastManager.add({ type: "error", title: "This folder no longer exists" });
      return true;
    }
    state.moveThreads(threads, folderId);
    toastManager.add({
      type: "success",
      title: folder ? `Moved to ${folder.name}` : "Returned to the normal chat list",
    });
  } catch (error) {
    reportFolderError(error);
  }
  return true;
}

export function ChatFolderSection({
  folder,
  threads,
  children,
}: {
  readonly folder: ChatFolder;
  readonly threads: readonly ScopedThreadRef[];
  readonly children: ReactNode;
}) {
  const contentId = useId();
  return (
    <li className="list-none" data-thread-selection-safe>
      <div className="group/chat-folder flex items-center gap-1">
        <button
          type="button"
          aria-expanded={!folder.collapsed}
          aria-controls={folder.collapsed ? undefined : contentId}
          aria-label={`${folder.name}, ${threads.length} chats`}
          className="flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
          onClick={() => {
            try {
              chatFoldersStore.getState().setCollapsed(folder.id, !folder.collapsed);
              if (!folder.collapsed)
                useThreadSelectionStore
                  .getState()
                  .removeFromSelection(threads.map(scopedThreadKey));
            } catch (error) {
              reportFolderError(error);
            }
          }}
        >
          <ChevronRightIcon
            aria-hidden
            className={`size-3 shrink-0 ${folder.collapsed ? "" : "rotate-90"}`}
          />
          {folder.collapsed ? (
            <FolderIcon aria-hidden className="size-4 shrink-0" />
          ) : (
            <FolderOpenIcon aria-hidden className="size-4 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">{folder.name}</span>
          <span className="text-2xs tabular-nums">{threads.length}</span>
        </button>
        <Menu>
          <MenuTrigger
            render={
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label={`Actions for ${folder.name}`}
              />
            }
          >
            <MoreHorizontalIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={() => requestFolderRename(folder)}>Rename folder</MenuItem>
            <MenuItem
              onClick={() => {
                try {
                  chatFoldersStore.getState().removeFolder(folder.id);
                  toastManager.add({
                    type: "success",
                    title: "Folder removed",
                    description: "Its chats returned to the normal list.",
                  });
                } catch (error) {
                  reportFolderError(error);
                }
              }}
            >
              Remove folder
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      {!folder.collapsed ? (
        <ul id={contentId} role="presentation" className="flex flex-col gap-px pl-2">
          {threads.length === 0 ? (
            <li className="px-3 py-2 text-xs text-sidebar-muted-foreground">
              No chats in this folder
            </li>
          ) : (
            children
          )}
        </ul>
      ) : null}
    </li>
  );
}

export function ChatFolderDialogHost() {
  const request = useFolderEdit((state) => state.request);
  const loadError = useChatFolders((state) => state.loadError);
  useEffect(() => {
    if (loadError)
      toastManager.add({
        type: "error",
        title: "Saved chat folders could not be loaded",
        description:
          "Your chats remain available. The saved folder data has been preserved for recovery.",
      });
  }, [loadError]);
  return request ? (
    <ChatFolderNameDialog key={request.folderId ?? "new"} request={request} />
  ) : null;
}

function ChatFolderNameDialog({ request }: { readonly request: FolderEditRequest }) {
  const id = useId();
  const [name, setName] = useState(request.name);
  const [error, setError] = useState<string | null>(null);
  const creating = request.folderId === null;
  const close = () => useFolderEdit.setState({ request: null });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPopup className="sm:max-w-sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            try {
              const store = chatFoldersStore.getState();
              if (request.folderId === null) store.createFolder(name, request.threads);
              else store.renameFolder(request.folderId, name);
              close();
            } catch (saveError) {
              setError(
                saveError instanceof Error ? saveError.message : "Could not save this folder.",
              );
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{creating ? "New chat folder" : "Rename chat folder"}</DialogTitle>
            <DialogDescription>Organize chats from any project in your sidebar.</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-2">
              <Label htmlFor={id}>Folder name</Label>
              <Input
                id={id}
                autoFocus
                value={name}
                maxLength={CHAT_FOLDER_NAME_MAX_LENGTH}
                placeholder="e.g. Research"
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
                aria-invalid={error !== null}
                aria-describedby={error ? `${id}-error` : undefined}
              />
              {error ? (
                <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              {creating ? "Create folder" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
