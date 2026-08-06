import { useState } from 'react';
import { t } from '../i18n';
import type { BlockType } from '../module_bindings/types';
import { CheckField, ErrorMessage, TextField } from './Fields';

export type BlockDraft = {
  title: string;
  blockType: BlockType;
  bodyHtml: string;
  url: string | undefined;
  isOptional: boolean;
};

const TYPES = ['Reading', 'ResourceLink'] as const;

/**
 * Create a block inside one chapter.
 *
 * The body is HTML and is sanitized server-side on write (M2.4) — the author types
 * markup, the reducer decides what survives. `url` is only sent for a ResourceLink,
 * because `create_block` rejects a URL on a Reading block.
 */
export function BlockForm({
  chapterId,
  onSubmit,
  pending,
  error,
}: {
  chapterId: bigint;
  onSubmit: (draft: BlockDraft) => void;
  pending: boolean;
  error: string | undefined;
}) {
  const [title, setTitle] = useState('');
  const [blockType, setBlockType] = useState<BlockType['tag']>('Reading');
  const [bodyHtml, setBodyHtml] = useState('');
  const [url, setUrl] = useState('');
  const [isOptional, setIsOptional] = useState(false);

  // ids must be unique across the chapter list, which renders one form per chapter.
  const field = (name: string) => `block-${chapterId}-${name}`;

  return (
    <form
      className="author-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          title,
          blockType: { tag: blockType },
          bodyHtml,
          url: blockType === 'ResourceLink' ? url : undefined,
          isOptional,
        });
        setTitle('');
        setBodyHtml('');
        setUrl('');
        setIsOptional(false);
      }}
    >
      <h4>{t('author.newBlock')}</h4>
      <TextField
        id={field('title')}
        labelKey="field.title"
        value={title}
        onChange={setTitle}
      />

      <p className="field">
        <label htmlFor={field('type')}>{t('field.blockType')}</label>
        <select
          id={field('type')}
          value={blockType}
          onChange={(e) =>
            setBlockType(e.target.value === 'ResourceLink' ? 'ResourceLink' : 'Reading')
          }
        >
          {TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`blockType.${type}`)}
            </option>
          ))}
        </select>
      </p>

      <TextField
        id={field('body')}
        labelKey="field.bodyHtml"
        value={bodyHtml}
        onChange={setBodyHtml}
        multiline
      />
      {blockType === 'ResourceLink' && (
        <TextField id={field('url')} labelKey="field.url" value={url} onChange={setUrl} />
      )}
      <CheckField
        id={field('optional')}
        labelKey="field.optional"
        checked={isOptional}
        onChange={setIsOptional}
      />
      <ErrorMessage error={error} />
      <button type="submit" disabled={pending}>
        {pending ? t('action.saving') : t('action.create')}
      </button>
    </form>
  );
}
