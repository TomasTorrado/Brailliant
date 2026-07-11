// WordDisplay.jsx
//
// Shows the word currently being read, with the letter that's actively
// being embossed (the one whose dot pattern is currently on the solenoids)
// highlighted.

export default function WordDisplay({ word, activeIndex }) {
  if (!word) {
    return <p className="text-4xl font-semibold text-subtext">Waiting for text…</p>;
  }

  return (
    <p className="text-6xl font-extrabold tracking-wide text-text">
      {word.split('').map((letter, i) => (
        <span
          key={i}
          className={
            i === activeIndex
              ? 'rounded-md bg-primary px-1 text-text underline decoration-4 underline-offset-8'
              : 'text-text'
          }
        >
          {letter}
        </span>
      ))}
    </p>
  );
}
