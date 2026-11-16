# Coding standards

## Fail with a thrown response, not a return value

A loader or an action that cannot continue throws. It does not return an
error shape for the component to unpack.

```ts
if (!course) throw data("Course not found", { status: 404 });
```

The route then has one success path. A returned error shape gives every
component a second path to forget about.

The one exception is a refusal the user can act on in the form they just
submitted. The action may return it so the form can show it:

```ts
return data({ error: "Invalid input." }, { status: 400 });
```

Everything else throws.

Returning `{ ok: false }` from a loader or an action is enforced by
`npm run lint`. Whether a refusal is user-correctable is still a judgement call.

## Parse untrusted input with a schema

Form data, search parameters and request bodies get a zod schema before the
values reach any query. Do not read `formData.get("x") as string` (enforced
by `npm run lint`). The cast is a lie the type checker believes.

## Do not write `any`, and do not write `!`

(enforced by `npm run lint`)

Both switch the type checker off at the exact point you are least sure. If a
value can be missing, narrow it with a check. If you cannot name the type,
the shape is wrong — fix the shape.
