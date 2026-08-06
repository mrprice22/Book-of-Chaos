import { ESLint } from 'eslint';
import { enUS } from './en-US';
import { interpolate, t } from './index';

describe('t()', () => {
  it('returns the message for a key', () => {
    expect(t('app.title')).toBe(enUS['app.title']);
  });

  it('substitutes named placeholders', () => {
    expect(interpolate('Chapter {n} of {total}', { n: 2, total: 7 })).toBe(
      'Chapter 2 of 7',
    );
  });

  it('leaves an unsupplied placeholder visible rather than blank', () => {
    expect(interpolate('Chapter {n}', { other: 1 })).toBe('Chapter {n}');
  });

  it('passes a message through untouched when it has no placeholders', () => {
    expect(t('connection.connectedAs', { unused: 'x' })).toBe(
      enUS['connection.connectedAs'],
    );
  });

  it('has no empty messages', () => {
    for (const [key, value] of Object.entries(enUS)) {
      expect(value, key).not.toBe('');
    }
  });
});

describe('the bare-JSX-literal lint rule', () => {
  // The rule is the only thing keeping copy out of components, so it gets a test of
  // its own: a misconfigured selector would fail silently and forever.
  const lint = async (code: string) => {
    const eslint = new ESLint({});
    const results = await eslint.lintText(code, { filePath: 'src/__lint_fixture.tsx' });
    return results.flatMap((r) => r.messages.map((m) => m.ruleId));
  };

  it('rejects user-facing text written directly into JSX', async () => {
    expect(await lint('export const A = () => <p>Hello reader</p>;\n')).toContain(
      'no-restricted-syntax',
    );
  });

  it('rejects a user-facing literal attribute', async () => {
    expect(
      await lint('export const A = () => <img src="x.png" alt="A diagram" />;\n'),
    ).toContain('no-restricted-syntax');
  });

  it('allows a component prop that happens to be called title', async () => {
    const code = 'export const A = () => <BookLanding title="Chaos" />;\n';
    expect(await lint(code)).not.toContain('no-restricted-syntax');
  });

  it('accepts copy routed through t()', async () => {
    const code =
      "import { t } from './i18n';\nexport const A = () => <p>{t('app.title')}</p>;\n";
    expect(await lint(code)).not.toContain('no-restricted-syntax');
  });
});
