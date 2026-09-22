// W0-07 section 4.7 `MemoryMailSink` (`MAIL_MODE=sink-memory`, the default in tests and CI). Keeps the delivered
// requests and an accepted-key set in memory; nothing leaves the process.

import type { DeliveryReceipt, DeliveryRequest } from '@rai/shared/mail/types';
import { BaseMailSink, type MailSinkOptions } from './base.js';

export class MemoryMailSink extends BaseMailSink {
  readonly identity = { sink: 'memory', version: 'w1-11' } as const;
  #index = 0;

  constructor(options: MailSinkOptions) {
    super(options);
  }

  health(): Promise<'ok'> {
    return Promise.resolve('ok');
  }

  protected record(_request: DeliveryRequest, _receipt: DeliveryReceipt): Promise<string> {
    this.#index += 1;
    return Promise.resolve(`memory:${this.#index}`);
  }
}
