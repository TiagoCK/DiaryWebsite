/**
 * Where an upload waits between "here is the plan" and "yes, add them".
 *
 * The uploader mirrors `npm run add` then `--commit`: you see what the pages
 * would be and can correct the single/spread guess before anything is written.
 * That needs the derived JPEGs to survive between two requests, and
 * re-rasterising a forty page PDF on commit would double the slowest part of
 * the job. So the plan step writes them to a temp directory and commit picks
 * them up.
 *
 * Nothing here is reachable without an admin session; the id checks below are
 * for what a caller could put in the JSON body, not for who they are.
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const ROOT = path.join(os.tmpdir(), "diary-upload");

/** Staging directories older than this are abandoned and get swept. */
const TTL_MS = 60 * 60 * 1000;

const ID_PATTERN = /^[a-f0-9]{32}$/;

/** A new staging directory, returning its id. */
export async function createStaging() {
  await mkdir(ROOT, { recursive: true });
  const id = randomBytes(16).toString("hex");
  await mkdir(path.join(ROOT, id));
  return id;
}

/**
 * The directory for an id, or a throw.
 *
 * Two checks rather than one: the pattern rejects anything with a separator or
 * a dot in it, and the resolved path is then required to sit directly under the
 * root, so even a pattern mistake could not walk out of the staging area.
 */
export function stagingDir(id) {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    throw new Error("Invalid upload id.");
  }
  const resolved = path.resolve(ROOT, id);
  if (path.dirname(resolved) !== path.resolve(ROOT)) {
    throw new Error("Invalid upload id.");
  }
  return resolved;
}

/** Item file names are ours, never the caller's -- index in, name out. */
const derivedName = (index) => `${String(index).padStart(3, "0")}.jpg`;
const masterName = (index, ext) => `${String(index).padStart(3, "0")}-master${ext}`;

export async function writeItem(id, index, { derived, master, masterExt }) {
  const dir = stagingDir(id);
  await writeFile(path.join(dir, derivedName(index)), derived);
  if (master) await writeFile(path.join(dir, masterName(index, masterExt)), master);
}

export async function readDerived(id, index) {
  return readFile(path.join(stagingDir(id), derivedName(index)));
}

export async function readMaster(id, index, ext) {
  try {
    return await readFile(path.join(stagingDir(id), masterName(index, ext)));
  } catch {
    return null;
  }
}

export async function writePlan(id, plan) {
  await writeFile(path.join(stagingDir(id), "plan.json"), JSON.stringify(plan));
}

/**
 * The staged plan, or null if there is no longer one.
 *
 * stagingDir() is called OUTSIDE the try on purpose: a malformed id is a
 * different thing from an expired upload, and swallowing its throw here would
 * report "choose the file again" to someone who sent a path traversal, and
 * leave the caller's own validation branch unreachable.
 */
export async function readPlan(id) {
  const dir = stagingDir(id);
  try {
    return JSON.parse(await readFile(path.join(dir, "plan.json"), "utf8"));
  } catch {
    return null;
  }
}

export async function discard(id) {
  await rm(stagingDir(id), { recursive: true, force: true });
}

/**
 * Drop staging directories nobody came back for.
 *
 * Called on the way into a plan request rather than on a timer: this only needs
 * to happen when the feature is in use, and a timer would keep a handle alive
 * in a process that is otherwise idle. Failures are ignored -- a stale temp
 * directory is untidy, not a reason to refuse an upload.
 */
export async function sweep() {
  try {
    const entries = await readdir(ROOT, { withFileTypes: true });
    const cutoff = Date.now() - TTL_MS;
    await Promise.all(
      entries
        .filter((e) => e.isDirectory() && ID_PATTERN.test(e.name))
        .map(async (e) => {
          const dir = path.join(ROOT, e.name);
          const info = await stat(dir);
          if (info.mtimeMs < cutoff) await rm(dir, { recursive: true, force: true });
        })
    );
  } catch {
    // Nothing staged yet, or nothing to clean.
  }
}
