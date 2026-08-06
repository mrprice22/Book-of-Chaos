import { useState } from 'react';

export type Action<Args> = {
  readonly run: (args: Args) => void;
  readonly pending: boolean;
  readonly error: string | undefined;
};

/**
 * Wrap a reducer call with the two things every author form needs: a pending flag,
 * and the server's rejection message.
 *
 * The reducer is the trust boundary, so its `Err(String)` is the authoritative
 * validation result — messages are written for a human reading a toast (CLAUDE.md),
 * and showing them verbatim is the point rather than a shortcut.
 */
export function useAction<Args>(
  call: (args: Args) => Promise<void>,
  onDone?: () => void,
): Action<Args> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const run = (args: Args) => {
    setPending(true);
    setError(undefined);
    call(args)
      .then(() => {
        setPending(false);
        onDone?.();
      })
      .catch((e: unknown) => {
        setPending(false);
        setError(e instanceof Error ? e.message : String(e));
      });
  };

  return { run, pending, error };
}
