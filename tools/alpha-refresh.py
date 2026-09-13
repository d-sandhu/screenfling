from pathlib import Path


def edit(name, old, new, count=1):
    path = Path(name)
    text = path.read_text()
    if text.count(old) != count:
        raise RuntimeError(f'Unexpected patch anchor in {name}: {old}')
    path.write_text(text.replace(old, new))


edit('src/main/macos-selector-acl.ts',
     'typeof process.resourcesPath === "string"',
     'process.versions.electron !== undefined')
edit('src/main/macos-selector-acl.ts',
     r'/[\u0000-\u001f\u007f]/u', r'/\p{Cc}/u')
edit('tools/acceptance/lifecycle.cjs',
     'const { chromium } = require("playwright");',
     'const { chromium } = require("playwright");\nconst { z } = require("zod");')
edit('tools/acceptance/lifecycle.cjs',
     '  if (address === null || typeof address === "string") throw new Error("devtools-unavailable");\n  return address.port;',
     '  const parsed = z.object({ port: z.number().int().min(1).max(65535) }).safeParse(address);\n  if (!parsed.success) throw new Error("devtools-unavailable");\n  return parsed.data.port;')
for field in ['require', 'process', 'captureBridge']:
    property_name = 'captureOverlay' if field == 'captureBridge' else field
    edit('tools/acceptance/lifecycle.cjs',
         f'{field}Type: typeof window.{property_name}',
         f'{field}Absent: window.{property_name} === undefined')
    edit('tools/acceptance/lifecycle.cjs',
         f'assert.equal(boundary.{field}Type, "undefined");',
         f'assert.equal(boundary.{field}Absent, true);')
edit('tools/acceptance/ui.test.cjs',
     '\ntest("renderer fixture:', '\nvoid test("renderer fixture:', 11)
