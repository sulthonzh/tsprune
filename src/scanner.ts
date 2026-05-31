import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname, relative, dirname } from "path";

export interface ExportInfo {
  name: string;
  file: string;
  line: number;
  type: "function" | "class" | "const" | "type" | "interface" | "enum" | "default";
  isTypeOnly: boolean;
  isReexport: boolean;
}

export interface ImportInfo {
  name: string;
  file: string;
  source: string;
  isTypeOnly: boolean;
}

export interface UnusedExport extends ExportInfo {
  usedIn: string[];
  usageCount: number;
}

export interface ScanResult {
  files: number;
  exports: number;
  unused: UnusedExport[];
  used: ExportInfo[];
  stats: {
    totalExports: number;
    totalUnused: number;
    unusedPercent: number;
    byType: Record<string, { total: number; unused: number }>;
  };
}

const TS_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);
const IGNORE_DIRS = new Set(["node_modules", "dist", ".git", "build", "coverage", ".next", ".nuxt", "out"]);

function isIgnored(dir: string): boolean {
  return IGNORE_DIRS.has(dir) || dir.startsWith(".");
}

export function collectFiles(root: string): string[] {
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !isIgnored(entry.name)) {
        walk(join(dir, entry.name));
      } else if (entry.isFile() && TS_EXTS.has(extname(entry.name))) {
        if (!entry.name.endsWith(".d.ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".spec.ts")) {
          files.push(join(dir, entry.name));
        }
      }
    }
  }
  walk(root);
  return files;
}

// Parse exports from a single file
export function parseExports(filePath: string, content: string): ExportInfo[] {
  const exports: ExportInfo[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // export default ...
    const defaultMatch = line.match(/^export\s+default\s+(?:function\s+)?(\w+)/);
    if (defaultMatch) {
      exports.push({ name: "default", file: filePath, line: lineNum, type: "default", isTypeOnly: false, isReexport: false });
      continue;
    }

    // export function
    const fnMatch = line.match(/^export\s+(?:async\s+)?function\s+(\w+)/);
    if (fnMatch) {
      exports.push({ name: fnMatch[1], file: filePath, line: lineNum, type: "function", isTypeOnly: false, isReexport: false });
      continue;
    }

    // export class
    const classMatch = line.match(/^export\s+(?:abstract\s+)?class\s+(\w+)/);
    if (classMatch) {
      exports.push({ name: classMatch[1], file: filePath, line: lineNum, type: "class", isTypeOnly: false, isReexport: false });
      continue;
    }

    // export const/let/var
    const varMatch = line.match(/^export\s+(?:const|let|var)\s+(\w+)/);
    if (varMatch) {
      exports.push({ name: varMatch[1], file: filePath, line: lineNum, type: "const", isTypeOnly: false, isReexport: false });
      continue;
    }

    // export type
    const typeMatch = line.match(/^export\s+type\s+(\w+)/);
    if (typeMatch) {
      exports.push({ name: typeMatch[1], file: filePath, line: lineNum, type: "type", isTypeOnly: true, isReexport: false });
      continue;
    }

    // export interface
    const ifaceMatch = line.match(/^export\s+interface\s+(\w+)/);
    if (ifaceMatch) {
      exports.push({ name: ifaceMatch[1], file: filePath, line: lineNum, type: "interface", isTypeOnly: true, isReexport: false });
      continue;
    }

    // export enum
    const enumMatch = line.match(/^export\s+(?:const\s+)?enum\s+(\w+)/);
    if (enumMatch) {
      exports.push({ name: enumMatch[1], file: filePath, line: lineNum, type: "enum", isTypeOnly: false, isReexport: false });
      continue;
    }

    // export { ... } (named re-exports or grouped exports)
    const namedMatch = line.match(/^export\s+\{([^}]+)\}/);
    if (namedMatch) {
      const names = namedMatch[1].split(",").map((s) => {
        const parts = s.trim().split(/\s+as\s+/);
        return parts.length > 1 ? parts[1]!.trim() : parts[0]!.trim();
      }).filter(Boolean);
      for (const name of names) {
        exports.push({ name, file: filePath, line: lineNum, type: "const", isTypeOnly: false, isReexport: true });
      }
    }

    // export * from '...'  (star re-export — we note it but can't track individual names)
    if (/^export\s+\*\s+from/.test(line)) {
      // skip — star exports are dynamic
    }
  }

  return exports;
}

// Parse imports from a single file
export function parseImports(filePath: string, content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    // import { X, Y as Z } from '...'
    const namedImport = line.match(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
    if (namedImport) {
      const isTypeOnly = line.includes("import type");
      const names = namedImport[1].split(",").map((s) => {
        const parts = s.trim().split(/\s+as\s+/);
        return parts[0]!.trim();
      }).filter(Boolean);
      for (const name of names) {
        imports.push({ name, file: filePath, source: namedImport[2]!, isTypeOnly });
      }
      continue;
    }

    // import X from '...'
    const defaultImport = line.match(/import\s+(?:type\s+)?(\w+)\s+from\s+['"]([^'"]+)['"]/);
    if (defaultImport) {
      imports.push({ name: "default", file: filePath, source: defaultImport[2]!, isTypeOnly: false });
      continue;
    }

    // import * as X from '...'
    const namespaceImport = line.match(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
    if (namespaceImport) {
      imports.push({ name: "*", file: filePath, source: namespaceImport[2]!, isTypeOnly: false });
    }
  }

  return imports;
}

function resolveImportPath(importerFile: string, source: string, root: string): string | null {
  if (source.startsWith(".") || source.startsWith("/")) {
    const dir = dirname(importerFile);
    let resolved = join(dir, source);
    
    // Try extensions
    for (const ext of ["", ".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", "/index.ts", "/index.tsx", "/index.js"]) {
      const candidate = resolved + ext;
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {}
    }
    return null;
  }
  // Non-relative — could be node_modules or alias, skip
  return null;
}

export function scan(root: string, options?: { ignoreTypes?: boolean; ignoreTests?: boolean }): ScanResult {
  const files = collectFiles(root);
  const allExports: ExportInfo[] = [];
  const allImports: ImportInfo[] = [];

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    allExports.push(...parseExports(file, content));
    allImports.push(...parseImports(file, content));
  }

  // Build usage map: export name -> files that import it
  const usageMap = new Map<string, Set<string>>();

  for (const imp of allImports) {
    const resolved = resolveImportPath(imp.file, imp.source, root);
    if (!resolved) continue;

    const key = `${imp.name}::${resolved}`;
    if (!usageMap.has(key)) usageMap.set(key, new Set());
    usageMap.get(key)!.add(imp.file);

    // namespace import means everything from that file is used
    if (imp.name === "*") {
      for (const exp of allExports) {
        if (exp.file === resolved) {
          const k = `${exp.name}::${resolved}`;
          if (!usageMap.has(k)) usageMap.set(k, new Set());
          usageMap.get(k)!.add(imp.file);
        }
      }
    }
  }

  const ignoreTypes = options?.ignoreTypes ?? false;
  const unused: UnusedExport[] = [];
  const used: ExportInfo[] = [];

  for (const exp of allExports) {
    if (ignoreTypes && exp.isTypeOnly) {
      used.push(exp);
      continue;
    }
    const key = `${exp.name}::${exp.file}`;
    const users = usageMap.get(key);
    if (!users || users.size === 0) {
      unused.push({ ...exp, usedIn: [], usageCount: 0 });
    } else {
      used.push(exp);
    }
  }

  // Stats
  const byType: Record<string, { total: number; unused: number }> = {};
  for (const exp of allExports) {
    if (!byType[exp.type]) byType[exp.type] = { total: 0, unused: 0 };
    byType[exp.type]!.total++;
  }
  for (const u of unused) {
    if (!byType[u.type]) byType[u.type] = { total: 0, unused: 0 };
    byType[u.type]!.unused++;
  }

  return {
    files: files.length,
    exports: allExports.length,
    unused,
    used,
    stats: {
      totalExports: allExports.length,
      totalUnused: unused.length,
      unusedPercent: allExports.length > 0 ? Math.round((unused.length / allExports.length) * 100) : 0,
      byType,
    },
  };
}

export function formatTable(result: ScanResult): string {
  if (result.unused.length === 0) return "✅ No unused exports found!";
  const lines: string[] = [];
  lines.push(`Found ${result.unused.length} unused export${result.unused.length > 1 ? "s" : ""} in ${result.files} files\n`);

  // Group by file
  const byFile = new Map<string, UnusedExport[]>();
  for (const u of result.unused) {
    if (!byFile.has(u.file)) byFile.set(u.file, []);
    byFile.get(u.file)!.push(u);
  }

  for (const [file, exports] of byFile) {
    lines.push(`  ${file}`);
    for (const exp of exports) {
      const typeBadge = exp.isTypeOnly ? " (type)" : "";
      lines.push(`    → ${exp.name} (${exp.type}${typeBadge}) line ${exp.line}`);
    }
    lines.push("");
  }

  lines.push(`Summary: ${result.stats.totalUnused}/${result.stats.totalExports} unused (${result.stats.unusedPercent}%)`);
  return lines.join("\n");
}

export function formatJson(result: ScanResult): string {
  return JSON.stringify(result, null, 2);
}

export function formatMarkdown(result: ScanResult): string {
  const lines: string[] = [];
  lines.push(`# tsprune results`);
  lines.push("");
  lines.push(`**${result.stats.totalUnused}** unused exports out of **${result.stats.totalExports}** total (**${result.stats.unusedPercent}%**)`);
  lines.push("");

  if (result.unused.length === 0) {
    lines.push("✅ All exports are being used!");
    return lines.join("\n");
  }

  lines.push("| File | Export | Type | Line |");
  lines.push("|------|--------|------|------|");
  for (const u of result.unused) {
    lines.push(`| ${u.file} | \`${u.name}\` | ${u.type} | ${u.line} |`);
  }

  lines.push("");
  lines.push("### By Type");
  lines.push("");
  lines.push("| Type | Total | Unused |");
  lines.push("|------|-------|--------|");
  for (const [type, stats] of Object.entries(result.stats.byType)) {
    lines.push(`| ${type} | ${stats.total} | ${stats.unused} |`);
  }

  return lines.join("\n");
}
