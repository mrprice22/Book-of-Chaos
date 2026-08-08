import { useState } from 'react';
import { t, type MessageKey } from '../i18n';
import type { BlockType } from '../module_bindings/types';
import { CheckField, ErrorMessage, TextField } from './Fields';

export type BlockDraft = {
  title: string;
  blockType: BlockType;
  bodyHtml: string;
  url: string | undefined;
  isOptional: boolean;
};

/**
 * Every block type, with the label it gets in the dropdown.
 *
 * A `Record` keyed by the tag rather than the array this used to be: `BlockType` is
 * a tagged union with no runtime list of its variants, and the old hand-written
 * `['Reading', 'ResourceLink']` did not gain `Quiz` when the enum did — it simply
 * kept compiling, so the author could not create the block type the whole release
 * is about. A missing key here is now a type error.
 */
const TYPE_LABELS: Record<BlockType['tag'], MessageKey> = {
  Reading: 'blockType.Reading',
  ResourceLink: 'blockType.ResourceLink',
  Quiz: 'blockType.Quiz',
};

const TYPES = Object.entries(TYPE_LABELS) as [BlockType['tag'], MessageKey][];

function blockTagFrom(value: string): BlockType['tag'] {
  return value in TYPE_LABELS ? (value as BlockType['tag']) : 'Reading';
}

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
          onChange={(e) => setBlockType(blockTagFrom(e.target.value))}
        >
          {TYPES.map(([type, labelKey]) => (
            <option key={type} value={type}>
              {t(labelKey)}
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
