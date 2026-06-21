import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFileAtomic, dirSize, pathExists } from "./fs-utils";

let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "kt-fsutils-"));
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("writes file contents and creates parent dirs", async () => {
    const target = path.join(dir, "nested", "deep", "file.json");
    await writeFileAtomic(target, JSON.stringify({ a: 1 }));
    const read = JSON.parse(await fs.readFile(target, "utf8"));
    expect(read).toEqual({ a: 1 });
  });

  it("overwrites atomically and leaves no temp files behind", async () => {
    const target = path.join(dir, "over.txt");
    await writeFileAtomic(target, "first");
    await writeFileAtomic(target, "second");
    expect(await fs.readFile(target, "utf8")).toBe("second");

    // No leftover .tmp-* files in the directory.
    const entries = await fs.readdir(dir);
    expect(entries.some((n) => n.startsWith(".tmp-"))).toBe(false);
  });

  it("writes Buffers", async () => {
    const target = path.join(dir, "buf.bin");
    await writeFileAtomic(target, Buffer.from([1, 2, 3, 4]));
    const buf = await fs.readFile(target);
    expect([...buf]).toEqual([1, 2, 3, 4]);
  });
});

describe("dirSize / pathExists", () => {
  it("sums file sizes recursively", async () => {
    const root = path.join(dir, "sizetest");
    await fs.mkdir(path.join(root, "sub"), { recursive: true });
    await fs.writeFile(path.join(root, "a.txt"), "12345"); // 5
    await fs.writeFile(path.join(root, "sub", "b.txt"), "1234567890"); // 10
    expect(await dirSize(root)).toBe(15);
  });

  it("pathExists reflects reality", async () => {
    expect(await pathExists(dir)).toBe(true);
    expect(await pathExists(path.join(dir, "nope-nope"))).toBe(false);
  });

  it("dirSize returns 0 for a missing directory", async () => {
    expect(await dirSize(path.join(dir, "does-not-exist"))).toBe(0);
  });
});
