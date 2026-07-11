// WordDisplay.jsx
//
// Shows the word currently being read, with the letter that's actively
// being embossed (the one whose dot pattern is currently on the solenoids)
// highlighted.

export default function WordDisplay({ word, activeIndex }) {
  if (!word) {
    return <p className="text-4xl text-neutral-600">Waiting for text…</p>;
  }

  return (
    <p className="text-6xl font-semibold tracking-wide">
      {word.split('').map((letter, i) => (
        <span
          key={i}
          className={i === activeIndex ? 'text-emerald-400 underline decoration-4 underline-offset-8' : 'text-neutral-100'}
        >
          {letter}
        </span>
      ))}
    </p>
  );
}
