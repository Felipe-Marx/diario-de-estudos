export interface Character {
  skin: number; hair: number; hc: number; shirt: number;
  style: number; acc: number; ac: number; bg: number;
}
export interface User {
  id: number; email: string; username: string;
  avatarMode: 'character' | 'image'; avatarImage: string | null;
  character: Character; hasPassword: boolean;
}
export interface Subject { id: number; name: string; color: string; notes: string }
export interface Task { id: number; title: string; subject_id: number | null; project_id: number | null; due: string; done: number }
export interface Project { id: number; name: string; progress: number }
export interface AllData {
  subjects: Subject[]; tasks: Task[]; projects: Project[];
  sessions: Record<string, number>;
}
export type Act = (f: () => Promise<unknown>) => Promise<void>;

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch('/api' + path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError((data as { error?: string }).error || 'Algo deu errado. Tente de novo.', r.status);
  return data as T;
}
