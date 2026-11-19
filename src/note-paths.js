// Pure helpers for the note paths the settings name (the inbox and the
// backlog note).

// Where a note ends up when `oldPath` (the note itself or a folder holding it)
// is renamed or moved to `newPath`. Returns null when the rename doesn't touch
// the note, so a repeated event for the same rename (a folder rename may be
// reported again for each file inside) finds nothing left to change.
export function followRename(notePath, oldPath, newPath) {
  if (notePath == null) return null;
  if (notePath === oldPath) return newPath;
  if (notePath.startsWith(`${oldPath}/`)) {
    return newPath + notePath.slice(oldPath.length);
  }
  return null;
}
