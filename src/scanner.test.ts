import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseExports, parseImports, scan, formatTable, formatJson, formatMarkdown } from "./scanner.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

const TMP = join("/tmp", "tsprune-test-" + Date.now());

function setup(files: Record<string, string>) {
  mkdirSync(TMP, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const fp = join(TMP, name);
    mkdirSync(join(fp, ".."), { recursive: true });
    writeFileSync(fp, content);
  }
}

function cleanup() {
  rmSync(TMP, { recursive: true, force: true });
}

describe("parseExports", () => {
  it("finds exported functions", () => {
    const exports = parseExports("a.ts", "export function hello() {}\nexport async function world() {}");
    assert.equal(exports.length, 2);
    assert.equal(exports[0].name, "hello");
    assert.equal(exports[0].type, "function");
    assert.equal(exports[1].name, "world");
    assert.equal(exports[1].type, "function");
  });

  it("finds exported classes", () => {
    const exports = parseExports("a.ts", "export class Foo {}\nexport abstract class Bar {}");
    assert.equal(exports.length, 2);
    assert.equal(exports[0].name, "Foo");
    assert.equal(exports[0].type, "class");
    assert.equal(exports[1].name, "Bar");
  });

  it("finds exported constants", () => {
    const exports = parseExports("a.ts", "export const X = 1;\nexport let Y = 2;");
    assert.equal(exports.length, 2);
    assert.equal(exports[0].name, "X");
    assert.equal(exports[0].type, "const");
  });

  it("finds exported types and interfaces", () => {
    const exports = parseExports("a.ts", "export type ID = string;\nexport interface User { name: string }");
    assert.equal(exports.length, 2);
    assert.equal(exports[0].name, "ID");
    assert.equal(exports[0].type, "type");
    assert.equal(exports[0].isTypeOnly, true);
    assert.equal(exports[1].name, "User");
    assert.equal(exports[1].type, "interface");
    assert.equal(exports[1].isTypeOnly, true);
  });

  it("finds exported enums", () => {
    const exports = parseExports("a.ts", "export enum Color { Red, Green }");
    assert.equal(exports.length, 1);
    assert.equal(exports[0].name, "Color");
    assert.equal(exports[0].type, "enum");
  });

  it("finds default exports", () => {
    const exports = parseExports("a.ts", "export default function main() {}");
    assert.equal(exports.length, 1);
    assert.equal(exports[0].name, "default");
    assert.equal(exports[0].type, "default");
  });

  it("finds named export groups", () => {
    const exports = parseExports("a.ts", "export { foo, bar as baz }");
    assert.equal(exports.length, 2);
    assert.equal(exports[0].name, "foo");
    assert.equal(exports[1].name, "baz");
  });
});

describe("parseImports", () => {
  it("finds named imports", () => {
    const imports = parseImports("b.ts", 'import { hello, world } from "./a"');
    assert.equal(imports.length, 2);
    assert.equal(imports[0].name, "hello");
    assert.equal(imports[1].name, "world");
  });

  it("finds aliased imports", () => {
    const imports = parseImports("b.ts", 'import { foo as bar } from "./a"');
    assert.equal(imports.length, 1);
    assert.equal(imports[0].name, "foo");
  });

  it("finds default imports", () => {
    const imports = parseImports("b.ts", 'import main from "./a"');
    assert.equal(imports.length, 1);
    assert.equal(imports[0].name, "default");
  });

  it("finds namespace imports", () => {
    const imports = parseImports("b.ts", 'import * as utils from "./a"');
    assert.equal(imports.length, 1);
    assert.equal(imports[0].name, "*");
  });

  it("detects type-only imports", () => {
    const imports = parseImports("b.ts", 'import type { User } from "./a"');
    assert.equal(imports.length, 1);
    assert.equal(imports[0].isTypeOnly, true);
  });
});

describe("scan", () => {
  it("detects unused exports", () => {
    setup({
      "a.ts": "export function used() {}\nexport function unused() {}",
      "b.ts": 'import { used } from "./a"',
    });
    try {
      const result = scan(TMP);
      assert.equal(result.unused.length, 1);
      assert.equal(result.unused[0].name, "unused");
      assert.equal(result.stats.totalExports, 2);
      assert.equal(result.stats.totalUnused, 1);
    } finally {
      cleanup();
    }
  });

  it("marks all used exports as used", () => {
    setup({
      "a.ts": "export function foo() {}",
      "b.ts": 'import { foo } from "./a"',
    });
    try {
      const result = scan(TMP);
      assert.equal(result.unused.length, 0);
      assert.equal(result.used.length, 1);
    } finally {
      cleanup();
    }
  });

  it("skips type-only exports with --ignore-types", () => {
    setup({
      "a.ts": "export type ID = string;\nexport function foo() {}",
      "b.ts": 'import { foo } from "./a"',
    });
    try {
      const result = scan(TMP, { ignoreTypes: true });
      assert.equal(result.unused.length, 0);
    } finally {
      cleanup();
    }
  });

  it("tracks stats by type", () => {
    setup({
      "a.ts": "export function foo() {}\nexport type Bar = string;",
      "b.ts": 'import { foo } from "./a"',
    });
    try {
      const result = scan(TMP);
      assert.equal(result.stats.byType["function"].total, 1);
      assert.equal(result.stats.byType["function"].unused, 0);
      assert.equal(result.stats.byType["type"].total, 1);
      assert.equal(result.stats.byType["type"].unused, 1);
    } finally {
      cleanup();
    }
  });

  it("handles default export/import matching", () => {
    setup({
      "a.ts": "export default function main() {}",
      "b.ts": 'import main from "./a"',
    });
    try {
      const result = scan(TMP);
      assert.equal(result.unused.length, 0);
    } finally {
      cleanup();
    }
  });

  it("counts files correctly", () => {
    setup({
      "a.ts": "export function foo() {}",
      "b.ts": 'import { foo } from "./a"',
      "c.ts": "export function bar() {}",
    });
    try {
      const result = scan(TMP);
      assert.equal(result.files, 3);
      assert.equal(result.unused.length, 1);
      assert.equal(result.unused[0].name, "bar");
    } finally {
      cleanup();
    }
  });
});

describe("formatters", () => {
  const result: any = {
    files: 2,
    exports: 3,
    unused: [{ name: "bar", file: "c.ts", line: 1, type: "function", isTypeOnly: false, isReexport: false, usedIn: [], usageCount: 0 }],
    used: [{ name: "foo", file: "a.ts", line: 1, type: "function", isTypeOnly: false, isReexport: false }],
    stats: { totalExports: 3, totalUnused: 1, unusedPercent: 33, byType: { function: { total: 3, unused: 1 } } },
  };

  it("formatTable outputs text", () => {
    const out = formatTable(result);
    assert.ok(out.includes("bar"));
    assert.ok(out.includes("33%"));
  });

  it("formatJson outputs valid JSON", () => {
    const out = formatJson(result);
    const parsed = JSON.parse(out);
    assert.equal(parsed.unused.length, 1);
  });

  it("formatMarkdown outputs markdown table", () => {
    const out = formatMarkdown(result);
    assert.ok(out.includes("| File |"));
    assert.ok(out.includes("bar"));
  });

  it("formatTable handles no unused", () => {
    const empty = { ...result, unused: [], stats: { ...result.stats, totalUnused: 0, unusedPercent: 0 } };
    const out = formatTable(empty);
    assert.ok(out.includes("No unused"));
  });
});
