export function quizAnswerMatches(value: string, answer: string): boolean {
  const normalize = (text: string) => text.normalize("NFC").trim().toLocaleLowerCase();
  return normalize(value) === normalize(answer);
}
