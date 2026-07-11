// esp32_braille.ino
//
// Firmware for the physical Braille display.
//
// - Listens on serial (USB) for incoming bytes from the Python backend.
//   Each byte is a 6-bit dot pattern: bit0=dot1 ... bit5=dot6. We drive one
//   GPIO pin per dot. The solenoids are active-low: driving a pin LOW raises
//   its dot, driving it HIGH pushes the dot back down. So a SET bit (raised
//   dot) -> LOW, and a CLEAR bit (flat dot) -> HIGH.
//
// Next/back navigation is handled on the laptop (the frontend's left/right
// arrow keys POST to the backend), so this firmware only drives solenoids.
//

#include <Arduino.h>

// ---- Configurable values -------------------------------------------------

// One GPIO pin per Braille dot (dot 1 -> DOT_PIN[0], ... dot 6 -> DOT_PIN[5]).
// Change these to match how the solenoids are wired on your board.
//
//                       1  2  3   4   5   6
const int DOT_PINS[6] = {4, 5, 18, 19, 13, 14};


const long SERIAL_BAUD_RATE = 115200;

// How long a solenoid stays energized for one dot pattern before the next
// byte can overwrite it. Keep short so rapid characters don't blur together.
const int SOLENOID_HOLD_MS = 300;

void setup() {
  Serial.begin(SERIAL_BAUD_RATE);

  // Start with a blank (flat) cell: HIGH holds every dot down (active-low).
  for (int i = 0; i < 6; i++) {
    pinMode(DOT_PINS[i], OUTPUT);
    digitalWrite(DOT_PINS[i], HIGH);
  }

  Serial.println("ready");
}

// Drives the 6 solenoid pins from a 6-bit dot pattern byte.
// Solenoids are active-low: LOW raises the dot, HIGH pushes it back down.
void setDots(uint8_t pattern) {
  for (int dot = 0; dot < 6; dot++) {
    bool raised = bitRead(pattern, dot);
    digitalWrite(DOT_PINS[dot], raised ? LOW : HIGH);
  }
}

// Reads any incoming dot-pattern byte from the backend and fires the
// solenoids accordingly.
void handleIncomingSerial() {
  if (Serial.available() > 0) {
    uint8_t pattern = Serial.read();
    setDots(pattern);

    // Debug echo: report the received byte and which dots it raised so the
    // host backend can log the ESP32's view of the data.
    Serial.print("RX byte=");
    Serial.print(pattern);
    Serial.print(" raised dots:");
    bool any = false;
    for (int dot = 0; dot < 6; dot++) {
      if (bitRead(pattern, dot)) {
        Serial.print(' ');
        Serial.print(dot + 1);
        any = true;
      }
    }
    if (!any) {
      Serial.print(" (blank)");
    }
    Serial.println();

    delay(SOLENOID_HOLD_MS);
  }
}


void loop() {
  handleIncomingSerial();
}
