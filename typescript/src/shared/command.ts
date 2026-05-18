import fs from "node:fs";
import path from "node:path";

export type ParsedCommand = {
  file: string;
  args: string[];
};

export function parseCommand(command: string): ParsedCommand {
  const parts: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;
  let escaping = false;

  for (const char of command.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\" && quote !== "'" && process.platform !== "win32") {
      escaping = true;
      continue;
    }

    if ((char === "\"" || char === "'") && quote === null) {
      quote = char;
      continue;
    }

    if (char === quote) {
      quote = null;
      continue;
    }

    if (/\s/.test(char) && quote === null) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaping) current += "\\";
  if (current) parts.push(current);
  if (parts.length === 0) throw new Error("Command must not be empty");

  const [file, ...args] = parts;
  return { file: resolveCommandFile(file), args };
}

function resolveCommandFile(file: string): string {
  if (process.platform !== "win32" || hasPathSegment(file) || path.extname(file)) return file;

  const pathValue = process.env.PATH ?? "";
  const dirs = pathValue.split(path.delimiter).filter(Boolean);
  const pathExts = pathExtCandidates();
  return findCommandCandidate(file, dirs, pathExts) ?? file;
}

function pathExtCandidates(): string[] {
  const configured = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((ext) => ext.trim().toUpperCase())
    .filter(Boolean);
  return [...new Set([".EXE", ".COM", ".CMD", ".BAT", ...configured])];
}

function findCommandCandidate(file: string, dirs: string[], pathExts: string[]): string | null {
  for (const dir of dirs) {
    for (const ext of pathExts) {
      const candidate = path.join(dir, `${file}${ext.toLowerCase()}`);
      if (fs.existsSync(candidate)) return candidate;
      const upperCandidate = path.join(dir, `${file}${ext.toUpperCase()}`);
      if (fs.existsSync(upperCandidate)) return upperCandidate;
    }
  }
  return null;
}

function hasPathSegment(file: string): boolean {
  return file.includes("/") || file.includes("\\");
}
