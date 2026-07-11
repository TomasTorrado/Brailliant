# test_serial.py
#
# Standalone hardware diagnostic. Bypasses the frontend, WebSocket, and
# translator entirely — it just opens the serial port and sends known dot
# patterns straight to the ESP32 so you can watch the solenoids react.
#
# Run from the backend/ dir with the venv active:  python test_serial.py
#
# What you should see, in order:
#   - Each of the 6 dots raised ONE AT A TIME (dot 1, then 2, ... then 6).
#     This verifies the DOT_PINS[] mapping in the firmware matches the
#     physical dots. Watch which physical dot rises on each step.
#   - All 6 dots raised at once.
#   - All dots flat (blank cell).

import os
import time

import serial

PORT = os.environ.get("BRAILLE_SERIAL_PORT", "/dev/cu.usbserial-0001")
BAUD = int(os.environ.get("BRAILLE_BAUD_RATE", "115200"))


def main():
    print(f"Opening {PORT} @ {BAUD} baud ...")
    conn = serial.Serial(PORT, BAUD, timeout=0)
    print("Port open. Opening the port resets the ESP32 — waiting 2s for boot.")
    time.sleep(2)

    # Raise each dot on its own so you can confirm the pin->dot mapping.
    for dot in range(6):
        pattern = 1 << dot  # bit0=dot1 ... bit5=dot6
        print(f"Dot {dot + 1}  -> byte {pattern:#08b} ({pattern})")
        conn.write(bytes([pattern]))
        time.sleep(1.5)

    print("All dots -> byte 0b111111 (63)")
    conn.write(bytes([0b111111]))
    time.sleep(2)

    print("Blank cell -> byte 0 (all flat)")
    conn.write(bytes([0]))
    time.sleep(1)

    conn.close()
    print("Done.")


if __name__ == "__main__":
    main()
