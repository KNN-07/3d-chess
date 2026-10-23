import { chooseMove } from './ai.js';

self.onmessage = ({ data }) => {
  const { id, fen, level } = data || {};
  try {
    self.postMessage({ id, ...chooseMove(fen, level) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
