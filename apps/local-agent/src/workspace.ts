import path from "node:path";
import { realpathSync } from "node:fs";

export function assertInsideWorkspace(workspaceRoot: string, targetPath: string): string {
  const resolvedWorkspaceRoot = realpathSync(path.resolve(workspaceRoot));
  const resolvedTargetPath = realpathSync(path.resolve(targetPath));
  const relativePath = path.relative(resolvedWorkspaceRoot, resolvedTargetPath);

  if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`)) {
    throw new Error("Path escapes workspace root");
  }

  return resolvedTargetPath;
}
