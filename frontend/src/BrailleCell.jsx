// BrailleCell.jsx
//
// Renders Braille letters as 6-dot cells: filled circles for raised dots,
// empty outlined circles for lowered ones. Dot layout matches the physical
// solenoid layout used by the firmware:
//   1 4
//   2 5
//   3 6
// Each `pattern` is the same 6-bit byte (bit0=dot1 ... bit5=dot6) sent to
// the ESP32, so what's drawn here always matches what the hardware does.
//
// The physical display only has one 6-solenoid cell, but we render two
// side by side here (current letter + upcoming letter) so the reader gets
// a preview of what's coming next, the way multi-cell Braille displays do.

// Dot order for rendering: row-major over the 2x3 dot grid.
const DOT_ORDER = [
  [0, 3], // row 1: dot 1, dot 4
  [1, 4], // row 2: dot 2, dot 5
  [2, 5], // row 3: dot 3, dot 6
];

function Dot({ raised }) {
  return (
    <span
      className={
        'block h-4 w-4 rounded-full border-2 transition-colors ' +
        (raised ? 'border-emerald-400 bg-emerald-400' : 'border-neutral-600 bg-transparent')
      }
    />
  );
}

function SingleCell({ pattern, label, active }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={
          'grid grid-cols-2 gap-2 rounded-lg p-3 ' +
          (active ? 'bg-neutral-800 ring-2 ring-emerald-400' : 'bg-neutral-900')
        }
      >
        {DOT_ORDER.map((row, rowIndex) => (
          <div key={rowIndex} className="contents">
            {row.map((bit) => (
              <Dot key={bit} raised={Boolean(pattern & (1 << bit))} />
            ))}
          </div>
        ))}
      </div>
      {label && <span className="text-xs uppercase tracking-wide text-neutral-500">{label}</span>}
    </div>
  );
}

export default function BrailleCell({ currentPattern = 0, currentLabel, nextPattern = 0, nextLabel }) {
  return (
    <div className="flex items-center gap-6">
      <SingleCell pattern={currentPattern} label={currentLabel || 'current'} active />
      <SingleCell pattern={nextPattern} label={nextLabel || 'next'} />
    </div>
  );
}
