import { enUS } from './en-US';

export type MessageKey = keyof typeof enUS;

export type MessageParams = Readonly<Record<string, string | number>>;

/**
 * Look up a user-facing string.
 *
 * `{placeholder}` spans are substituted from `params`. Interpolation lives here
 * rather than in the callers so that no component ever builds a sentence by
 * concatenation — word order is exactly the thing a translation changes.
 *
 * An unsubstituted placeholder is left in place: a visible `{count}` is a bug report,
 * where an empty string is silent.
 */
export function t(key: MessageKey, params?: MessageParams): string {
  const message: string = enUS[key];
  return params ? interpolate(message, params) : message;
}

/** Exported for its own tests; no key in `en-US.ts` takes a placeholder yet. */
export function interpolate(message: string, params: MessageParams): string {
  return message.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
