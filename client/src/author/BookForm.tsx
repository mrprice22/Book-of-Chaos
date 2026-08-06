import { useState } from 'react';
import { t } from '../i18n';
import { ErrorMessage, TextField } from './Fields';

export type BookDraft = { title: string; description: string };

/**
 * Create a book. Plain form, no rich editor — see docs/mvp-scope.md.
 *
 * Client-side validation is deliberately absent: `create_book` validates and returns
 * a human-readable message, and a second set of rules here would drift from it. The
 * form's job is to submit and to show what came back.
 */
export function BookForm({
  onSubmit,
  pending,
  error,
}: {
  onSubmit: (draft: BookDraft) => void;
  pending: boolean;
  error: string | undefined;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  return (
    <form
      className="author-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ title, description });
        setTitle('');
        setDescription('');
      }}
    >
      <h3>{t('author.newBook')}</h3>
      <TextField
        id="book-title"
        labelKey="field.title"
        value={title}
        onChange={setTitle}
      />
      <TextField
        id="book-description"
        labelKey="field.description"
        value={description}
        onChange={setDescription}
        multiline
      />
      <ErrorMessage error={error} />
      <button type="submit" disabled={pending}>
        {pending ? t('action.saving') : t('action.create')}
      </button>
    </form>
  );
}
