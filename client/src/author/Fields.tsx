import { t, type MessageKey } from '../i18n';

/**
 * The form primitives the author screens share.
 *
 * Labels are wired with a real `htmlFor`/`id` pair rather than wrapping, because the
 * author forms are the only place in v0.1 with more than one control per screen and
 * an unlabelled input is unusable with a screen reader.
 */

export function TextField({
  id,
  labelKey,
  value,
  onChange,
  multiline = false,
}: {
  id: string;
  labelKey: MessageKey;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  return (
    <p className="field">
      <label htmlFor={id}>{t(labelKey)}</label>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          rows={4}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </p>
  );
}

export function CheckField({
  id,
  labelKey,
  checked,
  onChange,
}: {
  id: string;
  labelKey: MessageKey;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <p className="field field-check">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label htmlFor={id}>{t(labelKey)}</label>
    </p>
  );
}

export function ErrorMessage({ error }: { error: string | undefined }) {
  if (error === undefined) return null;
  return (
    <p className="error" role="alert">
      {t('action.failed', { reason: error })}
    </p>
  );
}
