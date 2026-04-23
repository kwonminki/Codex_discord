import type { PrismaClient } from "@prisma/client";

export interface WorkspaceInventoryItem {
  id: string;
  absolutePath: string;
  displayName: string;
  status: string;
}

export interface ComputerInventoryItem {
  id: string;
  displayName: string;
  hostname: string;
  status: string;
  allowedRoleIds: string[];
  capabilities: string[];
  workspaces: WorkspaceInventoryItem[];
}

export interface InventoryService {
  listComputers(): Promise<ComputerInventoryItem[]>;
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    return [];
  }

  return [];
}

export function createInventoryService(prisma: PrismaClient): InventoryService {
  return {
    async listComputers() {
      const computers = await prisma.computer.findMany({
        include: {
          workspaces: {
            orderBy: { displayName: "asc" },
          },
        },
        orderBy: { displayName: "asc" },
      });

      return computers.map((computer) => ({
        id: computer.id,
        displayName: computer.displayName,
        hostname: computer.hostname,
        status: computer.status,
        allowedRoleIds: parseStringArray(computer.allowedRoleIds),
        capabilities: parseStringArray(computer.capabilities),
        workspaces: computer.workspaces.map((workspace) => ({
          id: workspace.id,
          absolutePath: workspace.absolutePath,
          displayName: workspace.displayName,
          status: workspace.status,
        })),
      }));
    },
  };
}
