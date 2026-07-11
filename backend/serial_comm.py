# serial_comm.py
#
# Handles the USB serial link to the ESP32. Sends one byte per character
# (a 6-bit dot pattern) and reads back whatever the firmware echoes over
# serial (its debug output — see main.py's poll_serial_debug).
#
# If no board is plugged in (or pyserial can't open the port), every method
# fails gracefully and logs a message instead of crashing the backend, so
# the rest of the demo (frontend + audio) keeps working without hardware.

import os

import serial

# Both overridable via environment variables so this works on any machine/OS.
SERIAL_PORT = os.environ.get("BRAILLE_SERIAL_PORT", "/dev/cu.usbserial-0001")
BAUD_RATE = int(os.environ.get("BRAILLE_BAUD_RATE", "115200"))


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
            print("[serial_comm] send_byte skipped: no hardware connected.")
            return False
        try:
            self.connection.write(bytes([pattern & 0x3F]))
            print(f"[serial_comm] sent byte {pattern & 0x3F:#08b} ({pattern & 0x3F})")
            return True
        except Exception as exc:
            print(f"[serial_comm] Write failed ({exc}). Marking hardware disconnected.")
            self.connection = None
            return False

    def read_available(self):
        """
        Non-blocking read of whatever bytes the ESP32 has sent back (its debug
        output). Returns the waiting bytes, or b'' if nothing is waiting / no
        hardware.
        """
        if self.connection is None:
            return b""
        try:
            waiting = self.connection.in_waiting
            if waiting:
                return self.connection.read(waiting)
        except Exception as exc:
            print(f"[serial_comm] Read failed ({exc}). Marking hardware disconnected.")
            self.connection = None
        return b""

    def close(self):
        if self.connection is not None:
            self.connection.close()
