import { once } from 'node:events';
import { createInterface } from 'node:readline/promises';

import type { Readable, Writable } from 'node:stream';

export interface ConfirmPromptOptions {
  input?: Readable;
  output?: Writable;
}

export function createConfirmPrompt(
  options: ConfirmPromptOptions = {}
): (message: string) => Promise<boolean> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;

  return async (message: string): Promise<boolean> => {
    const readline = createInterface({ input, output });

    try {
      const closed = once(readline, 'close').then(() => ({ kind: 'eof' }) as const);
      const answered = readline.question(`${message} [y/N] `).then(
        (value) => ({ kind: 'answer', value }) as const,
        () => ({ kind: 'eof' }) as const
      );
      const result = await Promise.race([answered, closed]);

      return result.kind === 'answer' && /^y(?:es)?$/i.test(result.value.trim());
    } finally {
      readline.close();
    }
  };
}
