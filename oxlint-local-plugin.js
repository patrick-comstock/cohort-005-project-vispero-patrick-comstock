// Rules oxlint does not ship natively, loaded through `jsPlugins` in
// .oxlintrc.json. Rule names are prefixed `local/`, so a disable comment
// reads `eslint-disable local/no-restricted-syntax`.

// ESLint's core `no-restricted-syntax`: report every node matching one of
// the configured esquery selectors. oxlint's JS plugin visitor accepts esquery
// selectors as keys, so each selector maps straight to a visitor.
const noRestrictedSyntax = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow syntax matched by esquery selectors",
    },
    schema: {
      type: "array",
      items: {
        oneOf: [
          { type: "string" },
          {
            type: "object",
            properties: {
              selector: { type: "string" },
              message: { type: "string" },
            },
            required: ["selector"],
            additionalProperties: false,
          },
        ],
      },
      uniqueItems: true,
    },
  },
  create(context) {
    const visitor = {};
    for (const option of context.options) {
      const { selector, message } =
        typeof option === "string" ? { selector: option } : option;
      const text = message ?? `Using '${selector}' is not allowed.`;
      visitor[selector] = (node) => context.report({ node, message: text });
    }
    return visitor;
  },
};

export default {
  meta: { name: "local" },
  rules: { "no-restricted-syntax": noRestrictedSyntax },
};
