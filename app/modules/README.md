# Modules

Each folder under `app/modules/` is a **deep module**: a lot of behaviour behind a small interface. Its interface is its **entry points**, the files at the module's root. Everything in a subfolder is implementation and is hidden.

```
app/modules/
  <name>/
    index.ts          ← an entry point. Import this from outside.
    index.server.ts   ← another entry point. A module may expose several.
    lib/              ← implementation: hidden from outside, free to import each other.
    tests/            ← tests and fixtures: they import entry points only.
```

Start a new module by copying `app/modules/example/`. Modules are flat: one tier under `app/modules/`, and a module never contains another.

**Import only through a module's entry points (its root files).** Never reach into `lib/`, `tests/` or any other subfolder of a module you are not inside.

**Do not write barrel files.** Expose several small entry points (`index.ts`, `index.server.ts`, `client.ts`) instead of re-exporting a whole subtree through one `index.ts`. Each entry point should export only what its callers need.

## The rules

`npm run lint:boundaries` runs dependency-cruiser (`.dependency-cruiser.cjs`) over all of `app/`. `npm run check` runs it too. Type-only imports count.

1. **Entry-point seam.** Code outside a module (routes, `app/lib`, another module) may import only that module's entry points, never anything in its subfolders.
2. **Freedom inside.** A module's own files import each other freely.
3. **Tests through the entry points.** Files under `<name>/tests/` may import any module's entry points and their own `tests/` fixtures, but never a module's internals, not even their own. Code outside a module's tests may not import its `tests/` folder either.
4. **No cycles.** No dependency cycles anywhere in `app/`.

Which modules may depend on which (layering) is not enforced yet; add such rules to `.dependency-cruiser.cjs` when needed.
