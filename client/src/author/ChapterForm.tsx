import { useState } from 'react';
import { t } from '../i18n';
import { CheckField, ErrorMessage, TextField } from './Fields';

export type ChapterDraft = {
  title: string;
  description: string;
  isOptional: boolean;
  isPinned: boolean;
};

/** Create a chapter. Prerequisites are chosen after it exists (M7.2). */
export function ChapterForm({
  onSubmit,
  pending,
  error,
}: {
  onSubmit: (draft: ChapterDraft) => void;
  pending: boolean;
  error: string | undefined;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isOptional, setIsOptional] = useState(false);
  const [isPinned, setIsPinned] = useState(false);

  return (
    <form
      className="author-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ title, description, isOptional, isPinned });
        setTitle('');
        setDescription('');
        setIsOptional(false);
        setIsPinned(false);
      }}
    >
      <h3>{t('author.newChapter')}</h3>
      <TextField
        id="chapter-title"
        labelKey="field.title"
        value={title}
        onChange={setTitle}
      />
      <TextField
        id="chapter-description"
        labelKey="field.description"
        value={description}
        onChange={setDescription}
        multiline
      />
      <CheckField
        id="chapter-optional"
        labelKey="field.optional"
        checked={isOptional}
        onChange={setIsOptional}
      />
      <CheckField
        id="chapter-pinned"
        labelKey="field.pinned"
        checked={isPinned}
        onChange={setIsPinned}
      />
      <ErrorMessage error={error} />
      <button type="submit" disabled={pending}>
        {pending ? t('action.saving') : t('action.create')}
      </button>
    </form>
  );
}
