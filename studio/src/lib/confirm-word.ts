// A destructive action confirmed by typing a short word (App settings › Danger zone): the word in the
// viewer's language ("削除", "삭제", "刪除") or the English DELETE, whatever the letter case and spaces
// around it. Plain TypeScript (confirm-word.test.ts).

export function confirmWordMatches(typed: string, word: string): boolean {
  const said = typed.normalize("NFKC").trim().toLowerCase();
  if (!said) return false;
  return said === word.normalize("NFKC").trim().toLowerCase() || said === "delete";
}
