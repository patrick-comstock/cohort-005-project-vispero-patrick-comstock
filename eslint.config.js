// Lint only the mechanical rules in CODING_STANDARDS.md. Judgement calls stay
// with the reviewer; whole recommended presets are deliberately not enabled.
import tseslint from "typescript-eslint";

const loaderOrAction =
  ":matches(FunctionDeclaration[id.name=/^(loader|action)$/], VariableDeclarator[id.name=/^(loader|action)$/])";

export default tseslint.config(
  {
    ignores: [
      "build/**",
      "node_modules/**",
      ".react-router/**",
      "drizzle/**",
      "**/+types/**",
    ],
  },
  {
    files: [
      "app/**/*.{ts,tsx}",
      "scripts/**/*.{ts,tsx}",
      "request-logger/**/*.{ts,tsx}",
    ],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      // "Do not write `any`, and do not write `!`"
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-syntax": [
        "error",
        // "Fail with a thrown response, not a return value"
        {
          selector: `${loaderOrAction} ReturnStatement Property[key.name="ok"]:matches([value.value=false], [value.expression.value=false])`,
          message:
            'Loaders and actions throw on failure (e.g. throw data("Not found", { status: 404 })). A refusal the user can fix in the form is returned as data({ error }, { status: 400 }). See CODING_STANDARDS.md.',
        },
        // "Parse untrusted input with a schema"
        {
          selector:
            "TSAsExpression[typeAnnotation.type='TSStringKeyword'] > CallExpression[callee.property.name='get'][callee.object.name=/^(formData|form|searchParams|params)$/i]",
          message:
            "Do not cast form or search input with `as string`. Parse it with a zod schema via parseFormData from app/lib/validation.ts.",
        },
        {
          selector:
            "TSAsExpression[typeAnnotation.type='TSStringKeyword'] > CallExpression[callee.property.name='get'][callee.object.property.name=/^(formData|searchParams)$/]",
          message:
            "Do not cast form or search input with `as string`. Parse it with a zod schema via parseFormData from app/lib/validation.ts.",
        },
      ],
    },
  },
  // CODING_STANDARDS: zero-violation core rules. Each comment names the
  // CODING_STANDARDS.md section the rule replaced. These use
  // no-restricted-exports / no-restricted-properties rather than
  // no-restricted-syntax because a later config object replaces a rule's
  // options instead of merging them, which would drop the selectors above.
  {
    files: [
      "app/**/*.{ts,tsx}",
      "scripts/**/*.{ts,tsx}",
      "request-logger/**/*.{ts,tsx}",
    ],
    rules: {
      // "Throw `Error`, never a string"
      "no-throw-literal": "error",
      // "Do not catch an error only to re-throw it unchanged"
      "no-useless-catch": "error",
      // "Prefer arrow functions for callbacks"
      "prefer-arrow-callback": "error",
      // "Return early rather than nesting" (the `else` after a `return`)
      "no-else-return": ["error", { allowElseIf: false }],
      // "Default exports only for route modules" (route modules exempted below;
      // root config files such as vite.config.ts are outside the lint scope)
      "no-restricted-exports": [
        "error",
        {
          restrictDefaultExports: {
            direct: true,
            named: true,
            defaultFrom: true,
            namedFrom: true,
            namespaceFrom: true,
          },
        },
      ],
      "no-restricted-properties": [
        "error",
        // "Do not commit a skipped test"
        ...["describe", "it", "test"].flatMap((object) =>
          ["skip", "only", "todo"].map((property) => ({
            object,
            property,
            message:
              "Do not commit a skipped, focused or placeholder test: fix it or delete it. Use skipIf only for a platform the test cannot run on.",
          }))
        ),
        // "Never build a query by joining strings"
        {
          object: "sql",
          property: "raw",
          message:
            "sql.raw splices a string into the query. Use the sql`...` template, which parameterises every interpolated value.",
        },
      ],
    },
  },
  {
    // React Router loads a route module's component from its default export.
    files: ["app/routes/**/*.{ts,tsx}", "app/root.tsx", "app/routes.ts"],
    rules: {
      "no-restricted-exports": "off",
    },
  }
);
