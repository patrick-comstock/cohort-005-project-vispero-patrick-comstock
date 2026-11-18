// Lint only the mechanical rules in CODING_STANDARDS.md. Judgement calls stay
// with the reviewer; whole recommended presets are deliberately not enabled.
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import simpleImportSort from "eslint-plugin-simple-import-sort";
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
  // Accessibility: "Every image has alt text", "Every input has a label",
  // "Do not set a positive tabIndex", "Use semantic elements".
  {
    files: ["app/**/*.tsx"],
    plugins: { "jsx-a11y": jsxA11y },
    rules: {
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/label-has-associated-control": "error",
      "jsx-a11y/tabindex-no-positive": "error",
      "jsx-a11y/no-static-element-interactions": "error",
      "jsx-a11y/click-events-have-key-events": "error",
    },
  },
  // "Effects declare every value they read". To read a callback without
  // re-running the effect, wrap it in useEffectEvent rather than disabling.
  {
    files: ["app/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/exhaustive-deps": "error",
    },
  },
  // eslint-plugin-react, three rules only: "Every item in a list gets a stable
  // key", "Set rel=noopener noreferrer on every external link" and "Escape
  // anything a person typed before you render it as HTML". Each
  // dangerouslySetInnerHTML carries a disable saying why its HTML is safe.
  // For loading placeholders, use skeletonKeys from ~/components/ui/skeleton.
  {
    files: ["app/**/*.tsx"],
    plugins: { react },
    settings: { react: { version: "detect" } },
    rules: {
      "react/no-array-index-key": "error",
      "react/jsx-no-target-blank": "error",
      "react/no-danger": "error",
    },
  },
  // "Imports are sorted: packages, then aliases, then relative". The plugin's
  // default groups are exactly that order; `eslint --fix` sorts them.
  {
    files: [
      "app/**/*.{ts,tsx}",
      "scripts/**/*.{ts,tsx}",
      "request-logger/**/*.{ts,tsx}",
    ],
    plugins: { "simple-import-sort": simpleImportSort },
    rules: {
      "simple-import-sort/imports": "error",
    },
  }
);
