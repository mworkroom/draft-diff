import { compareBlocks } from './compare';

self.onmessage = (event: MessageEvent<{ before: string[]; after: string[] }>) => {
  try {
    self.postMessage({ result: compareBlocks(event.data.before, event.data.after) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'An error occurred during comparison.' });
  }
};
