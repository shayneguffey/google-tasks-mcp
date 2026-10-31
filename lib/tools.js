// MCP tool definitions for Google Tasks. Each tool has a JSON Schema for its
// input, MCP annotations (so clients like Claude know which calls are
// read-only or destructive), and a run() that talks to the Tasks API.

import { tasksApi } from "./google.js";

const LIST_ID = {
  type: "string",
  description: 'Task list ID from list_task_lists. Defaults to "@default" (your primary "My Tasks" list).',
};
const DUE = {
  type: "string",
  description: "Due date as YYYY-MM-DD. Google Tasks stores dates only; any time of day is ignored.",
};

// Google wants RFC 3339 but only keeps the date part.
function toDue(date) {
  if (date === undefined) return undefined;
  if (date === null || date === "") return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(date);
  if (!m) throw new Error(`Invalid due date "${date}", expected YYYY-MM-DD`);
  return `${m[1]}T00:00:00.000Z`;
}

function slimTask(t) {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    due: t.due ? t.due.slice(0, 10) : undefined,
    notes: t.notes || undefined,
    parent: t.parent || undefined,
    completed: t.completed || undefined,
    updated: t.updated,
    links: t.links?.length ? t.links : undefined,
    webViewLink: t.webViewLink || undefined,
  };
}

export const tools = [
  {
    name: "list_task_lists",
    title: "List task lists",
    description: "List all of the user's Google Tasks lists (ID and title).",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run() {
      const lists = [];
      let pageToken;
      do {
        const page = await tasksApi("/users/@me/lists", { query: { maxResults: 100, pageToken } });
        lists.push(...(page.items || []).map((l) => ({ id: l.id, title: l.title, updated: l.updated })));
        pageToken = page.nextPageToken;
      } while (pageToken);
      return { taskLists: lists };
    },
  },
  {
    name: "list_tasks",
    title: "List tasks",
    description:
      "List tasks in a Google Tasks list. By default returns only open (not completed) tasks. " +
      "Subtasks have a 'parent' field pointing at their parent task's ID.",
    inputSchema: {
      type: "object",
      properties: {
        tasklist_id: LIST_ID,
        include_completed: { type: "boolean", description: "Also return completed tasks. Default false." },
        due_after: { type: "string", description: "Only tasks due on or after this date (YYYY-MM-DD)." },
        due_before: { type: "string", description: "Only tasks due before this date (YYYY-MM-DD)." },
        max_results: { type: "integer", minimum: 1, maximum: 500, description: "Maximum tasks to return. Default 100." },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run({ tasklist_id = "@default", include_completed = false, due_after, due_before, max_results = 100 }) {
      const tasks = [];
      let pageToken;
      do {
        const page = await tasksApi(`/lists/${encodeURIComponent(tasklist_id)}/tasks`, {
          query: {
            maxResults: 100,
            pageToken,
            showCompleted: include_completed,
            showHidden: include_completed,
            dueMin: toDue(due_after),
            dueMax: toDue(due_before),
          },
        });
        tasks.push(...(page.items || []).map(slimTask));
        pageToken = page.nextPageToken;
      } while (pageToken && tasks.length < max_results);
      return { tasks: tasks.slice(0, max_results) };
    },
  },
  {
    name: "create_task",
    title: "Create task",
    description: "Create a new task in a Google Tasks list.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title." },
        notes: { type: "string", description: "Optional notes / description." },
        due: DUE,
        tasklist_id: LIST_ID,
        parent_task_id: { type: "string", description: "Make this a subtask of the given task ID." },
      },
      required: ["title"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run({ title, notes, due, tasklist_id = "@default", parent_task_id }) {
      const task = await tasksApi(`/lists/${encodeURIComponent(tasklist_id)}/tasks`, {
        method: "POST",
        query: { parent: parent_task_id },
        body: { title, notes, due: toDue(due) },
      });
      return { task: slimTask(task) };
    },
  },
  {
    name: "update_task",
    title: "Update task",
    description:
      "Change a task's title, notes, due date, or status. Only the fields you pass are changed. " +
      'Pass an empty string for notes or due to clear them. Set status to "completed" or "needsAction".',
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "ID of the task to update." },
        tasklist_id: LIST_ID,
        title: { type: "string" },
        notes: { type: "string" },
        due: DUE,
        status: { type: "string", enum: ["needsAction", "completed"] },
      },
      required: ["task_id"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run({ task_id, tasklist_id = "@default", title, notes, due, status }) {
      const body = {};
      if (title !== undefined) body.title = title;
      if (notes !== undefined) body.notes = notes === "" ? null : notes;
      if (due !== undefined) body.due = toDue(due);
      if (status !== undefined) {
        body.status = status;
        // Reopening a task requires clearing its completion timestamp.
        if (status === "needsAction") body.completed = null;
      }
      const task = await tasksApi(
        `/lists/${encodeURIComponent(tasklist_id)}/tasks/${encodeURIComponent(task_id)}`,
        { method: "PATCH", body }
      );
      return { task: slimTask(task) };
    },
  },
  {
    name: "complete_task",
    title: "Complete task",
    description: "Mark a task as completed.",
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string" }, tasklist_id: LIST_ID },
      required: ["task_id"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run({ task_id, tasklist_id = "@default" }) {
      const task = await tasksApi(
        `/lists/${encodeURIComponent(tasklist_id)}/tasks/${encodeURIComponent(task_id)}`,
        { method: "PATCH", body: { status: "completed" } }
      );
      return { task: slimTask(task) };
    },
  },
  {
    name: "delete_task",
    title: "Delete task",
    description: "Permanently delete a task. This cannot be undone.",
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string" }, tasklist_id: LIST_ID },
      required: ["task_id"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    async run({ task_id, tasklist_id = "@default" }) {
      await tasksApi(`/lists/${encodeURIComponent(tasklist_id)}/tasks/${encodeURIComponent(task_id)}`, {
        method: "DELETE",
      });
      return { deleted: task_id };
    },
  },
];
