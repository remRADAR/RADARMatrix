// Persistence interfaces for v0.9 production-hardening

export interface MemoryRepository {
  create(memory: any): Promise<{ memory_id: string }>;
  getById(memory_id: string): Promise<any | null>;
  listByWorkspace(workspace_id: string): Promise<any[]>;
}

export interface DecisionRepository {
  create(decision: any): Promise<{ decision_id: string }>;
  getById(decision_id: string): Promise<any | null>;
  listByWorkspace(workspace_id: string): Promise<any[]>;
}

export interface SearchRepository {
  search(workspace_id: string, query: string, opts?: any): Promise<any>;
}

export interface AuditSink {
  record(event: any): Promise<void>;
}

export interface RateLimiter {
  allowRequest(opts: { workspace_id?: string; actor_id?: string; tool?: string }): Promise<boolean>;
}
