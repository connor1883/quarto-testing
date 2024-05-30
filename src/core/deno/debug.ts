/*
 * debug.ts
 *
 * Copyright (C) 2024 Posit Software, PBC
 *
 * Debugging utilities.
 */

import * as colors from "colors";
import { warn } from "log/mod.ts";

type StackEntry = {
  pos: string;
  name: string;
  line: string;
  col: string;
};
const compareEntry = (prev: StackEntry, next: StackEntry): boolean => {
  return prev.pos === next.pos && prev.line === next.line &&
    prev.col === next.col;
};
let previousStack: StackEntry[] = [];

// returns the length of the common prefix of the two stacks
const compareStacks = (prev: StackEntry[], next: StackEntry[]): number => {
  prev = prev.toReversed();
  next = next.toReversed();
  let i = 0;
  while (i < prev.length && i < next.length && compareEntry(prev[i], next[i])) {
    i++;
  }
  return i;
};

export const getStackAsArray = (
  format?: "json" | "raw" | "ansi",
  offset?: number,
) => {
  let rawStack = (new Error().stack ?? "").split("\n").slice(offset ?? 2);
  // now we heuristically try to match the first entry of the stack trace (last in the stack)
  // to our expectations of quarto.ts being the entry point.
  // This will only happen in dev builds and when
  //
  // export QUARTO_DENO_EXTRA_OPTIONS=--v8-flags=--stack-trace-limit=LARGE_ENOUGH_NUMBER
  //
  // is set.
  const m = rawStack[rawStack.length - 1].match(
    /^.*at async (.*)src\/quarto.ts:\d+:\d+$/,
  );
  if (!m) {
    warn(
      "Could not find quarto.ts in stack trace, is QUARTO_DENO_EXTRA_OPTIONS with a sufficiently-large stack size set?",
    );
  }
  if (m && (typeof format !== "undefined") && (format !== "raw")) {
    const pathPrefix = m[1];
    // first, trim all the path prefixes
    rawStack = rawStack.map((s) => s.replace(pathPrefix, ""));
    // then, entries can be async or not, and be in the main entry point or not.

    // main entry point async entries look like: "at async src/quarto.ts:170:5"
    // main entry point sync entries look like: "at src/quarto.ts:170:5"
    // other async entries look like: "at async render (src/command/render/render-shared.ts:112:22)"
    // other sync entries look like: "at render (src/command/render/render-shared.ts:112:22)"

    // we want them all to start with the source file and line number in parentheses
    const entries: StackEntry[] = rawStack.map((s) => {
      // main entry point? (no parentheses)
      const m1 = s.match(/^.*at (async )?(src\/quarto.ts):(\d+):(\d+)$/);
      if (m1) {
        return {
          pos: m1[2],
          name: `${m1[1] ?? ""}<main>`,
          line: m1[3],
          col: m1[4],
        };
      }
      // other stack entry? (with parentheses)
      const m2 = s.match(/^.*at (async )?(.*) \((src\/.+):(\d+):(\d+)\)$/);
      if (m2) {
        return {
          pos: m2[3],
          name: `${m2[1] ?? ""}${m2[2]}`,
          line: m2[4],
          col: m2[5],
        };
      }
      // links to deno's core?
      // FIXME these will generate bad links in vscode
      const m3 = s.match(
        /^.*at (async )?(.*) \(ext:(core\/.+):(\d+):(\d+)*\)$/,
      );
      if (m3) {
        return {
          pos: m3[3],
          name: `${m3[1] ?? ""}${m3[2]}`,
          line: m3[4],
          col: m3[5],
        };
      }
      throw new Error(`Unexpected stack entry: ${s}`);
    });

    if (format === "json") {
      return entries;
    }
    const maxPosLength = Math.max(...entries.map((e) => e.pos.length));
    const maxLineLength = Math.max(
      ...entries.map((e) => String(e.line).length),
    );
    const maxColLength = Math.max(...entries.map((e) => String(e.col).length));
    // this one only works in super fancy terminal emulators and vscode, :shrug:
    // https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda
    // now we format them all
    const accentColor = colors.gray;
    const commonPrefixLength = compareStacks(previousStack, entries);
    rawStack = entries.map((e, i) => {
      const linkedPos = `\x1b]8;;${
        pathPrefix.replace("file://", "vscode://file")
      }${e.pos}:${e.line}:${e.col}\x1b\\${e.pos}\x1b]8;;\x1b\\`;
      const srcPadding = " ".repeat(maxPosLength - e.pos.length);
      const linePadding = " ".repeat(maxLineLength - String(e.line).length);
      const colPadding = " ".repeat(maxColLength - String(e.col).length);

      const isFirstChange = i === entries.length - commonPrefixLength - 1;
      if (!isFirstChange) {
        return `${srcPadding}${
          accentColor(
            linkedPos + ":" + linePadding + e.line + colPadding + ":" + e.col +
              ": " + e.name,
          )
        }`;
      }
      return `${srcPadding}${linkedPos}${
        accentColor(":")
      }${linePadding}${e.line}${accentColor(":")}${colPadding}${e.col}${
        accentColor(":")
      } ${colors.yellow(e.name)}`;
    });
    previousStack = entries;
  }
  return rawStack;
};

export const getStack = (format?: "json" | "raw" | "ansi", offset?: number) => {
  return "Stack:\n" +
    getStackAsArray(format, offset ? offset + 1 : 3).join("\n");
};

// use debugPrint instead of console.log so it's easy to find stray print statements
// on our codebase
//
// deno-lint-ignore no-explicit-any
export const debugPrint = (...data: any[]) => {
  console.log(...data);
};

export const debugLogWithStack = async (...data: unknown[]) => {
  const payload = {
    payload: data,
    stack: getStackAsArray(),
    timestamp: new Date().toISOString(),
  };
  await Deno.writeTextFile(
    "/tmp/stack-debug.json",
    JSON.stringify(payload) + "\n",
    {
      append: true,
    },
  );
};
