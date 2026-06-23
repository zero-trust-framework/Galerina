// Gates the #163 inline-comment lint as part of the compiler suite, so the fail-open
// CLASS (an inline-returned WAT fragment ending in a `;;` line comment that swallows the
// enclosing paren) can never be reintroduced by hand without turning the build red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "lint-wat-inline-comments.mjs");

test("wat-emitter carries no inline-returned `;;` line comment (#163 fail-open class)", () => {
  // Exits 0 when clean; non-zero (throws here) lists each hazard with its fix.
  const out = execFileSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  assert.match(out, /clean/, out);
});
