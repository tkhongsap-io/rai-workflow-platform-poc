// W6-06 (W6 plan section 2.1): the working-day calendar (D06). The time zone is the fixed literal `Asia/Bangkok`,
// shown as text and always written back; the holidays are a list of dates. A calendar change applies to submissions
// after publishing: versions already submitted keep the calendar they froze (plan section 2.2).

import type { JSX } from 'react';
import { useLocale } from '../../../i18n/locale-provider.js';
import { ListEditor, type ListEditorProps } from './list-editor.js';
import { CALENDAR_TIMEZONE } from './simple-kinds.js';

export function CalendarEditor(
  props: Omit<ListEditorProps, 'legendKey' | 'itemLabelKey' | 'addLabelKey' | 'hintKey' | 'inputType'>,
): JSX.Element {
  const { t } = useLocale();
  return (
    <>
      <p className={'admin-strong'}>{t('admin.config.editor.timezone', { timezone: CALENDAR_TIMEZONE })}</p>
      <ListEditor
        {...props}
        legendKey={'admin.config.kind.calendar'}
        itemLabelKey={'admin.config.editor.item.calendar'}
        addLabelKey={'admin.config.editor.add.calendar'}
        hintKey={'admin.config.editor.calendar_hint'}
        inputType={'date'}
      />
    </>
  );
}
