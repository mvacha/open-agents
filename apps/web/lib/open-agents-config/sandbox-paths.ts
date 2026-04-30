import path from "node:path";

const OPEN_AGENTS_DIR = ".open-agents";
const PIDS_DIR_NAME = ".pids";
const SETUP_MARKER_NAME = ".setup-done";

export function configPath(workingDirectory: string): string {
  return path.posix.join(workingDirectory, OPEN_AGENTS_DIR, "config.json");
}

export function pidsDirPath(workingDirectory: string): string {
  return path.posix.join(workingDirectory, OPEN_AGENTS_DIR, PIDS_DIR_NAME);
}

export function pidFilePath(workingDirectory: string, name: string): string {
  return path.posix.join(pidsDirPath(workingDirectory), `${name}.pid`);
}

export function setupMarkerPath(workingDirectory: string): string {
  return path.posix.join(workingDirectory, OPEN_AGENTS_DIR, SETUP_MARKER_NAME);
}

export function processCwdPath(
  workingDirectory: string,
  processCwd: string,
): string {
  if (processCwd === "." || processCwd === "") {
    return workingDirectory;
  }
  return path.posix.join(workingDirectory, processCwd);
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
