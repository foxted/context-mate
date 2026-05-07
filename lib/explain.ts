export type ContextSource = "user" | "auto" | "mixed" | "unknown";

export interface Explanation {
  what: string;
  source: ContextSource;
}

/**
 * Mapping of known top-level keys in `messageRequestContext` payloads to a
 * human explanation and a source tag.
 *
 * Cursor's schema is undocumented and shifts between releases. Only add a key
 * here once you have observed it directly in a payload and are confident
 * about its origin. Keep entries terse, one sentence each.
 */
export const EXPLANATIONS: Record<string, Explanation> = {
  attachedFoldersListDirResults: {
    what: "Directory listings for folders you @-mentioned or that are configured as defaults.",
    source: "user",
  },
  attachedFolders: {
    what: "Folders attached to the request via @-mention or pin.",
    source: "user",
  },
  attachedFiles: {
    what: "Files attached to the request via @-mention or pin.",
    source: "user",
  },
  attachedDocs: {
    what: "Docs added to the project's @Docs index.",
    source: "user",
  },
  webReferences: {
    what: "URLs fetched via @-web or agent navigation.",
    source: "mixed",
  },
  knowledgeItems: {
    what: "Knowledge items saved in Cursor settings; auto-injected on every request.",
    source: "mixed",
  },
  summarizedComposers: {
    what: "Summaries of prior threads in this composer chain. Grows with session length.",
    source: "auto",
  },
  cursorRules: {
    what: "Rules from .cursor/rules/ that matched active files or are always-applied.",
    source: "auto",
  },
  userRules: {
    what: "Personal rules from your Cursor settings; auto-injected on every request.",
    source: "auto",
  },
  gitStatusRaw: {
    what: "Output of `git status`; auto-attached when the branch has uncommitted changes.",
    source: "auto",
  },
  gitDiff: {
    what: "Output of `git diff`; auto-attached when the branch has uncommitted changes.",
    source: "auto",
  },
  terminalFiles: {
    what: "Recent terminal output snapshots; auto-attached as soft context.",
    source: "auto",
  },
  openFiles: {
    what: "Files currently open in the editor; auto-attached.",
    source: "auto",
  },
  recentlyViewedFiles: {
    what: "Recently viewed files; auto-attached as soft context.",
    source: "auto",
  },
  selections: {
    what: "Text selections in the active editor at request time.",
    source: "user",
  },
  diffsSinceLastApply: {
    what: "File diffs accumulated since the last accepted apply; auto-attached so the agent sees uncommitted edits.",
    source: "auto",
  },
  projectLayouts: {
    what: "Directory tree snapshots of the workspace root; auto-attached.",
    source: "auto",
  },
  multiFileLinterErrors: {
    what: "Aggregated linter errors across recently touched files; auto-attached.",
    source: "auto",
  },
  todos: {
    what: "Agent todo list for the current session; auto-attached.",
    source: "auto",
  },
  ideEditorsState: {
    what: "Snapshot of editor tabs and cursor positions; auto-attached.",
    source: "auto",
  },
};

export function explain(key: string): Explanation | undefined {
  return EXPLANATIONS[key];
}

const SOURCE_LABEL: Record<ContextSource, string> = {
  user: "user-attached",
  auto: "auto-injected",
  mixed: "mixed",
  unknown: "unknown",
};

export function sourceLabel(source: ContextSource): string {
  return SOURCE_LABEL[source];
}
