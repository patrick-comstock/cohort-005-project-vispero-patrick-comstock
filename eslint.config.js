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
        // "Use the design tokens". A hex colour in a string or template. A
        // quoted hex inside a CSS attribute selector (stroke='#ccc') is not a
        // colour being set, so it is not matched.
        ...["Literal[value", "TemplateElement[value.raw"].map((node) => ({
          selector: `${node}=/(^|[^'"\\w&-])#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b/]`,
          message:
            "Use a design token (e.g. text-muted-foreground), not a raw hex colour.",
        })),
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
  },
  // CODING_STANDARDS: core rules with fixes. Each rule replaced a section of
  // CODING_STANDARDS.md; the quoted heading names the section it replaced.
  {
    files: [
      "app/**/*.{ts,tsx}",
      "scripts/**/*.{ts,tsx}",
      "request-logger/**/*.{ts,tsx}",
    ],
    rules: {
      // "Use `===`, never `==`"
      eqeqeq: ["error", "always"],
      // "Use `const` unless you reassign"
      "prefer-const": "error",
      "no-var": "error",
      // "Do not write a type that the compiler can infer" (literal cases only)
      "@typescript-eslint/no-inferrable-types": "error",
      // "Prefer `interface` for object shapes, `type` for unions" and
      // "Component props are a `type`": one way to write a shape, `type`.
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      // "Do not nest more than three levels"
      "max-depth": ["error", 3],
    },
  },
  // CODING_STANDARDS: no console.log in the app. scripts/ and request-logger/
  // are CLIs, where printing is the output.
  {
    files: ["app/**/*.{ts,tsx}"],
    rules: {
      // "No `console.log` left in a committed file"
      "no-console": ["error", { allow: ["error", "warn"] }],
    },
  },
  // CODING_STANDARDS: "Keep every file under 500 lines". Tests and the seed
  // script are exempt: they grow with the behaviour they cover.
  {
    files: [
      "app/**/*.{ts,tsx}",
      "scripts/**/*.{ts,tsx}",
      "request-logger/**/*.{ts,tsx}",
    ],
    ignores: ["**/*.test.{ts,tsx}", "scripts/seed.ts"],
    rules: {
      "max-lines": [
        "error",
        { max: 500, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  // CODING_STANDARDS: max-lines grandfather list. These files were over 500
  // lines when the rule arrived. A file leaves this list when it is split;
  // never add one.
  {
    files: [
      "app/lib/refund-eligibility.server.ts",
      "app/modules/instructor-analytics/lib/analytics-page.server.ts",
      "app/routes/admin.categories.tsx",
      "app/routes/courses.$slug.lessons.$lessonId.tsx",
      "app/routes/courses.$slug.tsx",
      "app/routes/instructor.$courseId.lessons.$lessonId.quiz.tsx",
      "app/routes/instructor.$courseId.tsx",
      "app/routes/instructor.analytics.tsx",
      "request-logger/agents.ts",
      "request-logger/render.ts",
    ],
    rules: {
      "max-lines": "off",
    },
  }
);
