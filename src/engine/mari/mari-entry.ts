export type MariTraceEvent = {
  type: string;
  approvalId?: string;
  label?: string;
  summary?: string;
  tool?: string;
  status?: "success" | "error" | string;
  startedAt?: string;
  finishedAt?: string;
  content?: string;
  arguments?: unknown;
  result?: unknown;
  error?: string;
  toolCalls?: unknown[];
};

export type MariMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  trace?: MariTraceEvent[];
};

export type MariAttachment = {
  id?: string;
  name: string;
  type: string;
  size: number;
  content: string;
};

export type MariPersonaContext = {
  id?: string | null;
  name?: string | null;
  comment?: string | null;
  description?: string | null;
  personality?: string | null;
  scenario?: string | null;
  backstory?: string | null;
  appearance?: string | null;
};

export type MariEntryRequest = {
  userMessage: string;
  messages: MariMessage[];
  compactedSummary?: string | null;
  connectionId?: string | null;
  persona?: MariPersonaContext | null;
  attachments?: MariAttachment[];
};

export const MARI_ACTION_ENTITIES = [
  "characters",
  "character-groups",
  "personas",
  "persona-groups",
  "lorebooks",
  "lorebook-entries",
  "prompts",
  "prompt-sections",
  "prompt-groups",
  "prompt-variables",
] as const;

export type MariActionEntity = (typeof MARI_ACTION_ENTITIES)[number];

export type MariFileChange = {
  op: "create" | "modify" | "delete" | string;
  path: string;
  before?: string;
  after?: string;
  reason?: string;
  binding?: {
    entity?: MariActionEntity | string;
    id?: string;
    field?: string | null;
  };
};

export type MariStorageAction =
  | {
      type: "create_record";
      entity: MariActionEntity;
      draft: Record<string, unknown>;
      label?: string;
      rationale?: string;
      paths?: string[];
    }
  | {
      type: "edit_record";
      entity: MariActionEntity;
      id: string;
      patch: Record<string, unknown>;
      label?: string;
      rationale?: string;
      paths?: string[];
    };

export type MariEntryAction =
  | {
      type: "none";
      capability: "bashkit_virtual_workspace" | "read_only" | "workspace_agent";
      reason: string;
      changes?: MariFileChange[];
      workspaceManifest?: unknown;
      approvalRequired?: false;
    }
  | {
      type: "staged_file_changes";
      capability: "bashkit_virtual_workspace";
      changes: MariFileChange[];
      storageActions: MariStorageAction[];
      unmappedChanges: MariFileChange[];
      workspaceManifest?: unknown;
      approvalRequired: boolean;
    }
  | MariStorageAction;

const MARI_NO_CHANGES_REASON = "Professor Mari did not stage any storage changes.";

export const MARI_NO_CHANGES_ACTION: MariEntryAction = {
  type: "none",
  capability: "bashkit_virtual_workspace",
  reason: MARI_NO_CHANGES_REASON,
  approvalRequired: false,
};

export type MariApprovalRequest = {
  id: string;
  tool?: string;
  label?: string;
  requestedAt?: string;
  action: Extract<MariEntryAction, { type: "staged_file_changes" }>;
  result?: unknown;
};

export type MariApprovalOutcome = {
  id: string;
  status: "approved" | "rejected" | string;
  approved: boolean;
  changeCount: number;
  storageActionCount: number;
  unmappedChangeCount: number;
  summary?: string;
  applied?: MariApplyStagedChangesResult | null;
  error?: string | null;
};

export type MariApplyStagedChangesResult = {
  applied: number;
  appliedAt?: string;
  results: Array<{
    type: "create_record" | "edit_record" | string;
    entity?: MariActionEntity | string;
    id?: string;
    record?: unknown;
  }>;
};

export type MariEntryResponse = {
  content: string;
  createdAt: string;
  action: MariEntryAction;
  trace: MariTraceEvent[];
};

export type MariGatewayResponse = Omit<MariEntryResponse, "action" | "trace"> & {
  action?: unknown;
  trace?: unknown;
};

export type MariGateway = {
  prompt(input: MariEntryRequest): Promise<MariGatewayResponse>;
};

export async function runProfessorMariEntry(input: MariEntryRequest, gateway: MariGateway): Promise<MariEntryResponse> {
  const response = await gateway.prompt({
    ...input,
    userMessage: input.userMessage.trim(),
    messages: input.messages.slice(),
    compactedSummary: input.compactedSummary ?? null,
    attachments: input.attachments ?? [],
    connectionId: input.connectionId ?? null,
    persona: input.persona ?? null,
  });
  const content = typeof response.content === "string" ? response.content : "";
  if (!content.trim()) {
    throw new Error("Professor Mari returned an empty response. Try again or select a different connection.");
  }
  return {
    ...response,
    content,
    action: normalizeMariEntryAction(response.action),
    trace: normalizeMariTrace(response.trace),
  };
}

export function isMariStagedAction(
  action: MariEntryAction | null | undefined,
): action is Extract<MariEntryAction, { type: "staged_file_changes" }> {
  return action?.type === "staged_file_changes";
}

function normalizeMariTrace(value: unknown): MariTraceEvent[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((event) => ({
    type: typeof event.type === "string" ? event.type : "event",
    ...(typeof event.label === "string" ? { label: event.label } : {}),
    ...(typeof event.summary === "string" ? { summary: event.summary } : {}),
    ...(typeof event.tool === "string" ? { tool: event.tool } : {}),
    ...(typeof event.status === "string" ? { status: event.status } : {}),
    ...(typeof event.startedAt === "string" ? { startedAt: event.startedAt } : {}),
    ...(typeof event.finishedAt === "string" ? { finishedAt: event.finishedAt } : {}),
    ...(typeof event.approvalId === "string" ? { approvalId: event.approvalId } : {}),
    ...(typeof event.content === "string" ? { content: event.content } : {}),
    ...("arguments" in event ? { arguments: event.arguments } : {}),
    ...("result" in event ? { result: event.result } : {}),
    ...(typeof event.error === "string" ? { error: event.error } : {}),
    ...(Array.isArray(event.toolCalls) ? { toolCalls: event.toolCalls } : {}),
  }));
}

function normalizeMariEntryAction(value: unknown): MariEntryAction {
  if (!isRecord(value)) return MARI_NO_CHANGES_ACTION;
  if (value.type === "none") {
    return {
      type: "none",
      capability:
        value.capability === "read_only" || value.capability === "workspace_agent"
          ? value.capability
          : "bashkit_virtual_workspace",
      reason: typeof value.reason === "string" && value.reason.trim() ? value.reason : MARI_NO_CHANGES_REASON,
      changes: normalizeMariFileChanges(value.changes),
      workspaceManifest: value.workspaceManifest,
      approvalRequired: false,
    };
  }
  if (value.type === "staged_file_changes") {
    return {
      type: "staged_file_changes",
      capability: "bashkit_virtual_workspace",
      changes: normalizeMariFileChanges(value.changes),
      storageActions: normalizeMariStorageActions(value.storageActions),
      unmappedChanges: normalizeMariFileChanges(value.unmappedChanges),
      workspaceManifest: value.workspaceManifest,
      approvalRequired: value.approvalRequired === true,
    };
  }
  const storageAction = normalizeMariStorageAction(value);
  return storageAction ?? MARI_NO_CHANGES_ACTION;
}

function normalizeMariStorageActions(value: unknown): MariStorageAction[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeMariStorageAction).filter((action): action is MariStorageAction => !!action);
}

function normalizeMariStorageAction(value: unknown): MariStorageAction | null {
  if (!isRecord(value)) return null;
  if (value.type === "create_record" && isMariActionEntity(value.entity) && isRecord(value.draft)) {
    return {
      type: "create_record",
      entity: value.entity,
      draft: value.draft,
      ...(typeof value.label === "string" ? { label: value.label } : {}),
      ...(typeof value.rationale === "string" ? { rationale: value.rationale } : {}),
      ...(Array.isArray(value.paths) ? { paths: value.paths.filter((path): path is string => typeof path === "string") } : {}),
    };
  }
  if (value.type === "edit_record" && isMariActionEntity(value.entity) && typeof value.id === "string" && value.id.trim() && isRecord(value.patch)) {
    return {
      type: "edit_record",
      entity: value.entity,
      id: value.id,
      patch: value.patch,
      ...(typeof value.label === "string" ? { label: value.label } : {}),
      ...(typeof value.rationale === "string" ? { rationale: value.rationale } : {}),
      ...(Array.isArray(value.paths) ? { paths: value.paths.filter((path): path is string => typeof path === "string") } : {}),
    };
  }
  return null;
}

function normalizeMariFileChanges(value: unknown): MariFileChange[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((change) => {
    if (typeof change.path !== "string" || !change.path.trim()) return [];
    return [
      {
        op: typeof change.op === "string" ? change.op : "modify",
        path: change.path,
        ...(typeof change.before === "string" ? { before: change.before } : {}),
        ...(typeof change.after === "string" ? { after: change.after } : {}),
        ...(typeof change.reason === "string" ? { reason: change.reason } : {}),
        ...(isRecord(change.binding)
          ? {
              binding: {
                ...(typeof change.binding.entity === "string" ? { entity: change.binding.entity } : {}),
                ...(typeof change.binding.id === "string" ? { id: change.binding.id } : {}),
                ...(typeof change.binding.field === "string" || change.binding.field === null ? { field: change.binding.field } : {}),
              },
            }
          : {}),
      },
    ];
  });
}

export function normalizeMariApprovalRequest(value: unknown): MariApprovalRequest | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) return null;
  const action = normalizeMariEntryAction(value.action);
  if (!isMariStagedAction(action)) return null;
  return {
    id: value.id,
    ...(typeof value.tool === "string" ? { tool: value.tool } : {}),
    ...(typeof value.label === "string" ? { label: value.label } : {}),
    ...(typeof value.requestedAt === "string" ? { requestedAt: value.requestedAt } : {}),
    action,
    ...("result" in value ? { result: value.result } : {}),
  };
}

export function normalizeMariApprovalOutcome(value: unknown): MariApprovalOutcome | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) return null;
  return {
    id: value.id,
    status: typeof value.status === "string" ? value.status : value.approved === false ? "rejected" : "approved",
    approved: value.approved !== false,
    changeCount: typeof value.changeCount === "number" ? value.changeCount : 0,
    storageActionCount: typeof value.storageActionCount === "number" ? value.storageActionCount : 0,
    unmappedChangeCount: typeof value.unmappedChangeCount === "number" ? value.unmappedChangeCount : 0,
    ...(typeof value.summary === "string" ? { summary: value.summary } : {}),
    ...(isMariApplyStagedChangesResult(value.applied) ? { applied: value.applied } : {}),
    ...(typeof value.error === "string" ? { error: value.error } : {}),
  };
}

function isMariApplyStagedChangesResult(value: unknown): value is MariApplyStagedChangesResult {
  return isRecord(value) && typeof value.applied === "number" && Array.isArray(value.results);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMariActionEntity(value: unknown): value is MariActionEntity {
  return typeof value === "string" && MARI_ACTION_ENTITIES.includes(value as MariActionEntity);
}
