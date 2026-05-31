#!/usr/bin/env node
import { scan, formatTable, formatJson, formatMarkdown } from "./scanner.js";
import { resolve } from "path";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
tsprune — find unused exports in TypeScript projects

Usage:
  tsprune [path] [options]

Options:
  --json           Output as JSON
  --markdown       Output as markdown
  --ignore-types   Skip type-only exports (interfaces, type aliases)
  --help, -h       Show this help

Examples:
  tsprune .
  tsprune src --json
  tsprune packages/utils --ignore-types
`);
  process.exit(0);
}

const root = resolve(args.find((a: string) => !a.startsWith("-")) || ".");
const json = args.includes("--json");
const md = args.includes("--markdown");
const ignoreTypes = args.includes("--ignore-types");

const result = scan(root, { ignoreTypes });

if (json) {
  console.log(formatJson(result));
} else if (md) {
  console.log(formatMarkdown(result));
} else {
  console.log(formatTable(result));
}

// Exit 1 if unused exports found (CI-friendly)
process.exit(result.unused.length > 0 ? 1 : 0);
