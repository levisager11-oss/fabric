// Toki's script adds window.toki inside Toki. Everywhere else these calls do nothing.
interface TokiApi {
  score(n: number, board?: string): void;
  achievement(id: string): void;
}
const api = (): TokiApi | undefined => (window as unknown as { toki?: TokiApi }).toki;

export const toki = {
  score(n: number, board?: string): void {
    try { if (board) api()?.score?.(n, board); else api()?.score?.(n); } catch { /* not in Toki */ }
  },
  achievement(id: string): void {
    try { api()?.achievement?.(id); } catch { /* not in Toki */ }
  },
};
