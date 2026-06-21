"use client";

import type { JobStatus, InputKind } from "./types";

/**
 * Browser-local persistence for the "Recent jobs" list and user settings.
 *
 * Job tokens are stored here so the user can return to a result page after a
 * refresh. This is appropriate for a local/MVP single-user tool. In a real
 * multi-user product, jobs would be tied to an authenticated account server-side
 * and never persisted in localStorage.
 */

const JOBS_KEY = "kanban-tools.recent-jobs.v1";
const SETTINGS_KEY = "kanban-tools.settings.v1";
const MAX_RECENT = 25;

export interface RecentJob {
  id: string;
  token: string;
  label: string; // primary file name or URL
  outputLabel?: string; // e.g. "WebP", "MP3"
  kind: InputKind;
  status: JobStatus;
  createdAt: number;
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    // Notify same-tab listeners (storage event only fires cross-tab).
    window.dispatchEvent(new Event("kanban-tools:store"));
  } catch {
    /* quota / disabled storage — ignore */
  }
}

export function getRecentJobs(): RecentJob[] {
  return read<RecentJob[]>(JOBS_KEY, []);
}

export function upsertRecentJob(job: RecentJob) {
  const all = getRecentJobs().filter((j) => j.id !== job.id);
  all.unshift(job);
  write(JOBS_KEY, all.slice(0, MAX_RECENT));
}

export function updateRecentJob(id: string, patch: Partial<RecentJob>) {
  const all = getRecentJobs();
  const idx = all.findIndex((j) => j.id === id);
  if (idx === -1) return;
  all[idx] = { ...all[idx], ...patch };
  write(JOBS_KEY, all);
}

export function removeRecentJob(id: string) {
  write(
    JOBS_KEY,
    getRecentJobs().filter((j) => j.id !== id),
  );
}

export function clearRecentJobs() {
  write(JOBS_KEY, []);
}

export interface AppSettings {
  maxFileSizeMb: number;
  jobTtlMinutes: number;
}

const DEFAULT_SETTINGS: AppSettings = {
  maxFileSizeMb: 512,
  jobTtlMinutes: 30,
};

export function getSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS, ...read<Partial<AppSettings>>(SETTINGS_KEY, {}) };
}

export function saveSettings(patch: Partial<AppSettings>) {
  write(SETTINGS_KEY, { ...getSettings(), ...patch });
}
