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

Watch numbers in particular: `Number("")` is `0`, and `0` is a valid id in
most schemas.

## Let the code explain itself

Name and extract until a comment is unnecessary. A comment earns its place
only for a _why_ the code cannot express: a constraint, a decision, a link to
the ADR behind it. A comment that restates _what_ the code does goes stale the
first time the code changes.

## Arrange tests through the module under test

Test setup calls the module's own functions. When the function you need does
not exist, add it to the module rather than inserting rows directly, so a
change to how the module stores its data leaves its tests alone.

## A route does not query data a module owns

Once a module owns a feature's data, the route asks the module for it and
does not import `~/db` or `drizzle-orm` itself. The instructor analytics
route gets everything from `~/modules/instructor-analytics/index.server`. A
query in the loader splits the feature's rules across two files, and the
module's tests stop covering what the page shows.

`npm run lint:boundaries` enforces this rule, and the module entry-point rules
in [app/modules/README.md](./app/modules/README.md), where it can. It cannot
see every case, so follow them where it is silent.

## Wrap related writes in a transaction

Two writes that must both land, or neither, go in a transaction. If the second
one fails and the first stayed, you have invented a state nothing knows how to
read. (The refund bug: the refund was approved, the enrollment was never
ended, and the learner kept the course.)

## Derive, do not store

If a value can be worked out from another value you already hold, work it out.
Storing it gives you two things that must agree, and one day they will not.

```ts
// Bad
const [items, setItems] = useState(rows);
const [count, setCount] = useState(rows.length);

// Good
const [items, setItems] = useState(rows);
const count = items.length;
```

## Check permission in the action, not only the loader

A loader guard does not protect an action. They are separate requests. For a
week anybody who was signed in could approve a refund by posting to
`/admin/refunds`.

## Name a boolean so it reads as a question

`isPublished`, `hasSeats`, `canRefund`. Not `published`, `seats`, `refund`.

## Every image has alt text

Decorative images take `alt=""`, not no attribute.

## Avoid the N+1

One query in a loop is N+1 queries. Use a join, or one query with an `IN`.

## Prefer composition to configuration

A function that takes a `mode` flag and branches on it is two functions that
have not been separated yet. The same goes for a component with a `variant`
prop that changes what it renders rather than how it looks.

## Money is stored in integer cents.

Never a float. Floats cannot hold a tenth. Regional prices came out as
`19.990000000000002` until we changed this.

## Don't leave commented-out code

Git has it. Delete it.

## Name a test for the behaviour, not the function

`"refuses a refund after the window closes"`, not `"refund test 3"`.

## Do not put a side effect in the render path

Rendering is for working out what the output is, not for doing something.
Anything that touches the outside world belongs in an effect or an action.

## Timestamps are stored as ISO strings in UTC

A local time in a column is a bug waiting for somebody in another country. The
refund window closed a day early for learners in Sydney before this.

## Imports are sorted: packages, then aliases, then relative

Within each group, alphabetically.

## Every input has a label

## Paginate anything that can grow

A query with no limit is fine on a seeded database and fatal on a real one.
If the row count is a function of how long the product has been alive, add a
limit. The instructor's students page timed out on the first big course.

## Catch the narrowest thing you can

A bare `catch` that swallows everything hides the bug you are about to spend
a day on.

## Every item in a list gets a stable key

The index of an item is not a key. When the list is reordered, every row
below the change is rebuilt, and anything the row was holding is lost. Use
the row's id. (Reordering modules used to drop the half-typed lesson title.)

## Colour is never the only signal

## never log a secret

## Hoist a constant out of the body

A value that does not depend on anything in the body goes outside the body,
so it is built once instead of on every pass.

## Validate at the edge, trust inside

Parse once, at the boundary. After that the value has a type and you do not
check it again.

## Keep the fixture close to the test

A shared fixture that every test bends is worse than a little duplication.

## Use semantic elements

A `div` with an `onClick` is a button that nobody can tab to.

## Index every foreign key

A foreign key without an index is a table scan on every join. Add the index
in the same change that adds the key.

## Name a function for what it returns, not how it works

`getPendingRefunds`, not `queryRefundsTableFilteredByStatus`.

## Never mutate a value you were handed

Take a copy, change the copy, hand the copy back. A caller that passed you
something does not expect to find it different afterwards.

## Also

- Do not set a positive `tabIndex`.
- Do not test the framework.

## Inject the clock

A function that calls `Date.now()` cannot be tested at a fixed moment. Take
the time as an argument. The refund window tests failed every night at
midnight until we did this.

## Migrations are forward-only

Never edit a migration that has been applied. Write another one.

## Escape anything a person typed before you render it as HTML

## Effects declare every value they read

If an effect reads a value, that value is in the dependency array. Leaving it
out is a bug that will not show up until the value changes.

## Log the error, not just the message

The stack is the useful part.

## One assertion per test, where you can manage it

A test that fails should tell you what is broken without being read.

## Return early rather than nesting

Turn the condition around and leave at the top, rather than wrapping the rest
of the body in an `if`. (ESLint already rejects an `else` after a `return`.)

## No inline styles except for a computed value

A width that is a percentage of progress is fine. A colour is not.

## Enumerations live in the schema file

A status string that the code compares against is an enum in `app/db/schema.ts`,
not a literal repeated in six places. Refund status was `"pending"` in four
files and `"Pending"` in one.

## Do not remove the focus ring

Restyle it if you must, but leave something visible.

## Split a component when it grows a second reason to change

A component that both fetches and lays out is two components. Pull the layout
out and pass it what it needs.

## Do not export something only one file uses

Keep it private until a second caller appears.

## Keep the heading levels in order

## Do not write a type that the compiler can infer

`const count: number = items.length` says nothing the compiler did not know.
ESLint catches an annotation on a literal (`limit: number = 3`); the rest is
yours to spot.

## Set `rel="noopener noreferrer"` on every external link

## Do not use a default parameter to hide a required one

If the caller must always pass it, make them.

## Do not mock what you own

## No TODO without a name and a date

`// TODO(matt, 2026-03-01): …`. A TODO with nobody's name on it is a wish.

## Debounce anything that fires on keystroke

## Prefer a pure function

If it can be written without reading the clock, the database or the network,
write it that way. It is the only kind of function that is pleasant to test.

## Assert an invariant rather than commenting it
