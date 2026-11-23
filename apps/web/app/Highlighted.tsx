/**
 * A sentence with one stretch in brand indigo, written as {curly braces}:
 * "What do you want to {learn} today?". Translations keep the braces
 * around whatever words they choose to highlight.
 */
export default function Highlighted({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\{[^}]+\})/).map((part, i) =>
        part.startsWith("{") && part.endsWith("}") ? <span key={i}>{part.slice(1, -1)}</span> : part,
      )}
    </>
  );
}
