// W6-06 (W6 plan sections 2.1 and 2.4): the operator mail recipients (D06). The list editor with e-mail fields and the
// synthetic-only rule stated up front; the server refuses any other address while `MAIL_MODE` is a sink
// (`recipient_not_synthetic`), and mail never leaves the sink in W6.

import type { JSX } from 'react';
import { ListEditor, type ListEditorProps } from './list-editor.js';

export function RecipientsEditor(
  props: Omit<ListEditorProps, 'legendKey' | 'itemLabelKey' | 'addLabelKey' | 'hintKey' | 'inputType'>,
): JSX.Element {
  return (
    <ListEditor
      {...props}
      legendKey={'admin.config.kind.operator_recipients'}
      itemLabelKey={'admin.config.editor.item.operator_recipients'}
      addLabelKey={'admin.config.editor.add.operator_recipients'}
      hintKey={'admin.config.editor.recipients_hint'}
      inputType={'email'}
    />
  );
}
