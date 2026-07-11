# serial_comm.py
#
# Handles the USB serial link to the ESP32. Sends one byte per character
# (a 6-bit dot pattern) and listens for single-byte button events the
# firmware sends back ('N' = next, 'B' = back).
#
# If no board is plugged in (or pyserial can't open the port), every method
# fails gracefully and logs a message instead of crashing the backend, so
# the rest of the demo (frontend + audio) keeps working without hardware.

import os

import serial

# Both overridable via environment variables so this works on any machine/OS.
SERIAL_PORT = os.environ.get("BRAILLE_SERIAL_PORT", "/dev/ttyUSB0")
BAUD_RATE = int(os.environ.get("BRAILLE_BAUD_RATE", "9600"))


class SerialLink:
    def __init__(self, port=SERIAL_PORT, baud=BAUD_RATE):
        self.port = port
        self.baud = baud
        self.connection = None
        self._connect()

    def _connect(self):
        try:
            self.connection = serial.Serial(self.port, self.baud, timeout=0)
            print(f"[serial_comm] Connected to ESP32 on {self.port} @ {self.baud} baud")
        except Exception as exc:
            self.connection = None
            print(f"[serial_comm] No ESP32 on {self.port} ({exc}). Continuing without hardware.")

    def send_byte(self, pattern):
        """Send one 6-bit dot pattern (0-63) to the ESP32. No-op if disconnected."""
        if self.connection is None:
            return False
        try:
            self.connection.write(bytes([pattern & 0x3F]))
            return True
        except Exception as exc:
            print(f"[serial_comm] Write failed ({exc}). Marking hardware disconnected.")
            self.connection = None
            return False

    def read_button_event(self):
        """
        Non-blocking check for a button-event byte sent back by the ESP32.
        Returns b'N', b'B', or None if nothing is waiting / no hardware.
        """
        if self.connection is None:
            return None
        try:
            if self.connection.in_waiting:
                return self.connection.read(1)
        except Exception as exc:
            print(f"[serial_comm] Read failed ({exc}). Marking hardware disconnected.")
            self.connection = None
        return None

    def close(self):
        if self.connection is not None:
            self.connection.close()
