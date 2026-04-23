import path from "node:path";

export function assertInsideWorkspace(workspaceRoot: string, targetPath: string): string {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const resolvedTargetPath = path.resolve(targetPath);
  const relativePath = path.relative(resolvedWorkspaceRoot, resolvedTargetPath);

  if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`)) {
    throw new Error("Path escapes workspace root");
  }

  return resolvedTargetPath;
}
