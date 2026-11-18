import { describe, expect, it } from "vitest";

import { renderComment } from "./comment-markdown.server";

describe("renderComment", () => {
  describe("markdown", () => {
    it("renders basic formatting", async () => {
      const html = await renderComment("**bold** and _italic_");

      expect(html).toContain("<strong>bold</strong>");
      expect(html).toContain("<em>italic</em>");
    });

    it("renders lists", async () => {
      const html = await renderComment("- one\n- two");

      expect(html).toContain("<li>one</li>");
    });

    it("colours the keywords of a supported language", async () => {
      const html = await renderComment("```typescript\nconst a = 1;\n```");

      expect(html).toMatch(/<span style="color:[^"]+">const<\/span>/);
    });

    it.each([
      ["javascript", "const a = 1;"],
      ["typescript", "const a: number = 1;"],
      ["tsx", "const a = <b>x</b>;"],
      ["jsx", "const a = <b>x</b>;"],
      ["json", '{"a": 1}'],
      ["bash", "echo hi"],
      ["html", "<b>x</b>"],
      ["css", "a { color: red; }"],
      ["sql", "SELECT 1;"],
      ["yaml", "a: 1"],
      ["markdown", "# Title"],
    ])(
      "highlights %s rather than showing it as plain text",
      async (lang, code) => {
        const html = await renderComment(`\`\`\`${lang}\n${code}\n\`\`\``);

        expect(html).not.toBe(
          await renderComment(`\`\`\`text\n${code}\n\`\`\``)
        );
      }
    );

    it("shows plain text in the same dark code block as highlighted code", async () => {
      const html = await renderComment("```text\n+++\n```");

      expect(html).toContain('<pre class="shiki github-dark"');
    });

    it("renders an unsupported language as plain text", async () => {
      const html = await renderComment("```brainfuck\n+++\n```");

      expect(html).toBe(await renderComment("```text\n+++\n```"));
    });

    it("renders a fence with no language as plain text", async () => {
      const html = await renderComment("```\n+++\n```");

      expect(html).toBe(await renderComment("```text\n+++\n```"));
    });

    it("escapes markup inside code blocks", async () => {
      const html = await renderComment(
        "```html\n<script>alert(1)</script>\n```"
      );

      // shiki escapes as &#x3C; rather than &lt; — either is safe.
      expect(html).not.toContain("<script>");
      expect(html).not.toContain("</script>");
    });

    it("escapes markup inside inline code", async () => {
      const html = await renderComment("use `<script>` carefully");

      expect(html).not.toContain("<script>");
    });
  });

  describe("raw HTML", () => {
    it("escapes a script tag instead of emitting it", async () => {
      const html = await renderComment("<script>alert('xss')</script>");

      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });

    it("escapes an event-handler attribute", async () => {
      const html = await renderComment('<img src=x onerror="alert(1)">');

      expect(html).not.toContain("<img");
      expect(html).not.toContain('onerror="alert(1)"');
    });

    it("escapes an iframe", async () => {
      const html = await renderComment('<iframe src="https://evil.test">');

      expect(html).not.toContain("<iframe");
    });

    it("escapes inline HTML mixed into a paragraph", async () => {
      const html = await renderComment("hello <b onclick='x()'>there</b>");

      expect(html).not.toContain("<b onclick");
      expect(html).toContain("&lt;b onclick");
    });

    it("escapes ampersands and both kinds of quote", async () => {
      const html = await renderComment(`<div title="Tom & 'Jerry'">`);

      expect(html).toContain(
        "&lt;div title=&quot;Tom &amp; &#39;Jerry&#39;&quot;&gt;"
      );
    });

    it("escapes a style tag", async () => {
      const html = await renderComment("<style>body{display:none}</style>");

      expect(html).not.toContain("<style>");
    });
  });

  describe("links", () => {
    it("keeps http and https links and marks them nofollow", async () => {
      const html = await renderComment("[docs](https://example.test/a)");

      expect(html).toContain('href="https://example.test/a"');
      expect(html).toContain('rel="nofollow noopener noreferrer"');
      expect(html).toContain('target="_blank"');
    });

    it("keeps plain http links", async () => {
      const html = await renderComment("[docs](http://example.test/a)");

      expect(html).toContain('href="http://example.test/a"');
    });

    it("keeps mailto links", async () => {
      const html = await renderComment("[mail me](mailto:a@example.test)");

      expect(html).toContain('href="mailto:a@example.test"');
    });

    it("renders a link with no title as a bare anchor", async () => {
      const html = await renderComment("[docs](https://example.test/a)");

      expect(html).toContain(
        '<a href="https://example.test/a" rel="nofollow noopener noreferrer" target="_blank">docs</a>'
      );
    });

    it("keeps a link title, escaped", async () => {
      const html = await renderComment(
        `[docs](https://example.test/a 'say "hi" & bye')`
      );

      expect(html).toContain(
        '<a href="https://example.test/a" title="say &quot;hi&quot; &amp; bye" rel="nofollow noopener noreferrer" target="_blank">docs</a>'
      );
    });

    it("keeps a relative link written with spaces inside angle brackets", async () => {
      const html = await renderComment("[lesson](< /courses/x/lessons/1 >)");

      expect(html).toContain('href="/courses/x/lessons/1"');
    });

    it("keeps relative links", async () => {
      const html = await renderComment("[lesson](/courses/x/lessons/1)");

      expect(html).toContain('href="/courses/x/lessons/1"');
    });

    it("downgrades a javascript: link to plain text", async () => {
      const html = await renderComment("[click](javascript:alert(1))");

      expect(html).not.toContain("javascript:");
      expect(html).not.toContain("<a ");
      expect(html).toContain("click");
    });

    it("downgrades a data: link to plain text", async () => {
      const html = await renderComment(
        "[click](data:text/html;base64,PHNjcmlwdD4=)"
      );

      expect(html).not.toContain("<a ");
    });

    it("downgrades a protocol-relative link", async () => {
      const html = await renderComment("[click](//evil.test)");

      expect(html).not.toContain("<a ");
    });

    it("downgrades a backslash link that browsers read as protocol-relative", async () => {
      const html = await renderComment("[click](/\\evil.test)");

      expect(html).not.toContain("<a ");
    });

    it("downgrades a tab-split link that browsers read as protocol-relative", async () => {
      const html = await renderComment("[click](</\t/evil.test>)");

      expect(html).not.toContain("<a ");
    });

    it("downgrades a link that starts with two backslashes", async () => {
      const html = await renderComment("[click](\\\\evil.test)");

      expect(html).not.toContain("<a ");
    });

    it("keeps a relative link's query and fragment exactly", async () => {
      const html = await renderComment("[lesson](/courses/x/lessons/1?x=1#h)");

      expect(html).toContain('href="/courses/x/lessons/1?x=1#h"');
    });

    it("escapes quotes in a link title", async () => {
      const html = await renderComment(
        '[x](https://example.test "a" onmouseover="alert(1)")'
      );

      expect(html).not.toContain('onmouseover="alert(1)"');
    });

    it("keeps autolinks", async () => {
      const html = await renderComment("<https://example.test>");

      expect(html).toContain('href="https://example.test/"');
    });
  });

  describe("images", () => {
    it("drops images, keeping only the alt text", async () => {
      const html = await renderComment("![tracking](https://evil.test/px.gif)");

      expect(html).not.toContain("<img");
      expect(html).toContain("tracking");
    });
  });
});
