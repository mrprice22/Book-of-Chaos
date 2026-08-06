import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `src/module_bindings/` is written by `spacetime generate`. It is checked by
  // `tsc`, but linting output nobody may hand-edit is noise.
  { ignores: ['dist', 'src/module_bindings'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // The trust boundary is the reducer, but a stray `any` still hides real
      // type errors in SDK results — CLAUDE.md forbids both of these.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      // No user-facing copy in JSX — everything goes through `t()`. Expressed as
      // selectors rather than eslint-plugin-react's jsx-no-literals so the rule can
      // also catch the user-visible *attributes*, which that rule ignores.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXText[value=/[^\\s]/]',
          message: 'User-facing text belongs in src/i18n/en-US.ts — render it with t().',
        },
        {
          // Only on host elements (lowercase names). `title` on a component is a
          // prop carrying data — `<BookLanding title={...} />` — not copy the
          // browser will render.
          selector:
            'JSXOpeningElement[name.name=/^[a-z]/] > JSXAttribute[name.name=/^(title|alt|placeholder|aria-label|aria-description)$/] > Literal',
          message:
            'User-facing attribute text belongs in src/i18n/en-US.ts — pass t() instead.',
        },
      ],
    },
  },
);
