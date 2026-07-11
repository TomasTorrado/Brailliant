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

function Dot({ raised, colorClass }) {
  return (
    <span
      className={
        'block h-5 w-5 rounded-full border-3 border-border transition-colors ' +
        (raised ? `${colorClass} shadow-brutal-sm` : 'bg-dotEmpty')
      }
    />
  );
}

function SingleCell({ pattern, label, active, colorClass }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={
          'grid grid-cols-2 gap-2 rounded-xl border-3 border-border bg-cardBg p-4 transition-all ' +
          (active ? 'shadow-brutal' : 'shadow-brutal-sm opacity-90')
        }
      >
        {DOT_ORDER.map((row, rowIndex) => (
          <div key={rowIndex} className="contents">
            {row.map((bit) => (
              <Dot key={bit} raised={Boolean(pattern & (1 << bit))} colorClass={colorClass} />
            ))}
          </div>
        ))}
      </div>
      {label && <span className="text-xs font-bold uppercase tracking-wide text-subtext">{label}</span>}
    </div>
  );
}

export default function BrailleCell({ currentPattern = 0, currentLabel, nextPattern = 0, nextLabel }) {
  return (
    <div className="flex items-center gap-6">
      <SingleCell pattern={currentPattern} label={currentLabel || 'current'} active colorClass="bg-primary" />
      <SingleCell pattern={nextPattern} label={nextLabel || 'next'} colorClass="bg-teal" />
    </div>
  );
}
