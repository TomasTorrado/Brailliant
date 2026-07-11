# Bill of Materials — Refreshable Braille Cell (single cell, 6 dots)

An ESP32-driven single braille cell. Six 12 V push-pull solenoids act as the dots,
switched by a ULN2803A Darlington array. The solenoid rail is powered by a LiPo
battery through a switch; the ESP32 is powered/programmed over USB.

<img width="1500" height="1096" alt="Circuit diagram" src="https://github.com/user-attachments/assets/bd524801-df16-42b1-9c52-63d0aa6f89b4" />

**Interactive circuit diagram:** https://app.cirkitdesigner.com/project/e82fda3e-3d09-49e1-956e-e4bf4a69a14f

## Components

| Ref | Component | Qty | Specs / Notes |
|-----|-----------|-----|---------------|
| U1 | ESP32-WROOM-32 DevKitC | 1 | Classic ESP32 (30/38-pin). USB provides logic power + serial. |
| U2 | ULN2803A Darlington transistor array | 1 | 8-channel low-side driver; built-in flyback diodes (COM tied to +V rail). |
| BB1 | Solderless breadboard | 1 | 400-point (half-size) or larger. |
| SOL1–SOL6 | 12 V micro push-pull solenoid | 6 | QINIZX open-frame, 4 mm stroke, ~460 mA, ~26 Ω, 5.5 W each. |
| BT1 | LiPo battery, 3S (11.1 V) | 1 | Powers the solenoid rail; 3S matches the 12 V solenoids. |
| J1 | XT60 connector (pair) | 1 | Battery-to-rail connection. |
| SW1 | SPST toggle switch | 1 | Inline on the battery positive lead. |
| W1 | Jumper wires (M–M) | ~20 | Signal and power. |
| W2 | USB cable | 1 | ESP32 to computer (match your board's port). |

### Also in this project (not on the breadboard)
| Part | Qty | Notes |
|------|-----|-------|
| 3D-printed base | 1 | Houses solenoids, ESP32, driver; pocket wire troughs + USB slot. |
| 3D-printed lid | 1 | Friction-fit, six dot holes. |
| 3D-printed dot cap | 6 | Press-fit onto each solenoid shaft. |

## Recommended additions (not shown in the diagram, but advised)

| Component | Qty | Why |
|-----------|-----|-----|
| 10 kΩ resistor | 6 | One from each ULN2803A input to GND. Holds every channel **off** during ESP32 boot — prevents the coils from pulling in during the ~1 s power-up window (fixes the GPIO5/GPIO14 strapping-pin glitch). |
| 1000 µF electrolytic capacitor (≥16 V) | 1 | Across the solenoid rail near U2; absorbs the pull-in current surge. |
| 0.1 µF ceramic capacitor | 2 | Decoupling on the rail and near the ESP32. |

## Notes

- **Common ground.** The LiPo/driver ground and the ESP32 (USB) ground must be tied together, or the logic signals have no reference and nothing switches reliably.
- **Duty cycle.** These solenoids are rated for *instant use only* (manufacturer: power-on time under ~1 minute). Pulse dots on refresh — do not hold all six energized continuously. A "full-power pull-in, then PWM hold" scheme greatly reduces heat.
- **Pin selection.** Avoid strapping pins (GPIO 0, 2, 5, 12, 15) and flash pins (GPIO 6–11) as outputs. Boot-clean output pins on this board include GPIO 13, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33.
- **Dot numbering.** Standard braille layout for mapping firmware to pins:

  ```
  dot 1  ●  ●  dot 4
  dot 2  ●  ●  dot 5
  dot 3  ●  ●  dot 6
  ```