import { z } from "zod";
import type { Sandbox } from "./sandbox";

export const todoStatusSchema = z.enum(["pending", "in_progress", "completed"]);
export type TodoStatus = z.infer<typeof todoStatusSchema>;

export const todoItemSchema = z.object({
  id: z.string().describe("Unique identifier for the todo item"),
  content: z.string().describe("The task description"),
  status: todoStatusSchema.describe(
    "Current status. Only ONE task should be in_progress at a time."
  ),
});
export type TodoItem = z.infer<typeof todoItemSchema>;

export const memoryEntrySchema = z.object({
  id: z.string(),
  content: z.string(),
  tags: z.array(z.string()),
  createdAt: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type MemoryEntry = z.infer<typeof memoryEntrySchema>;

export interface MemoryStore {
  entries: MemoryEntry[];
}

/**
 * Agent execution modes that control behavior based on execution context.
 *
 * - 'interactive': Human in the loop, local development. Tool approval required for writes/bash.
 * - 'background': Async execution, cloud sandbox. Auto-approve all tools, checkpoint via git.
 */
export type AgentMode = "interactive" | "background";

export interface AgentContext {
  sandbox: Sandbox;
  mode: AgentMode;
}

export const EVICTION_THRESHOLD_BYTES = 80 * 1024;
