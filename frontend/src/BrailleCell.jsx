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
// The physical display only has one 6-solenoid cell, so we render exactly
// one cell here too — no "next letter" preview, since the hardware can
// never show more than the current step.

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
        'block h-5 w-5 rounded-full border-3 border-border transition-colors ' +
        (raised ? 'bg-primary shadow-brutal-sm' : 'bg-dotEmpty')
      }
    />
  );
}

export default function BrailleCell({ currentPattern = 0, currentLabel }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="grid grid-cols-2 gap-2 rounded-xl border-3 border-border bg-cardBg p-4 shadow-brutal transition-all">
        {DOT_ORDER.map((row, rowIndex) => (
          <div key={rowIndex} className="contents">
            {row.map((bit) => (
              <Dot key={bit} raised={Boolean(currentPattern & (1 << bit))} />
            ))}
          </div>
        ))}
      </div>
      {currentLabel && (
        <span className="text-xs font-bold uppercase tracking-wide text-subtext">{currentLabel}</span>
      )}
    </div>
  );
}
