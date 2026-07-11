// esp32_braille.ino
//
// Firmware for the physical Braille display.
//
// - Listens on serial (USB) for incoming bytes from the Python backend.
//   Each byte is a 6-bit dot pattern: bit0=dot1 ... bit5=dot6. We drive one
//   GPIO pin per dot, firing the solenoid for any bit that's set.
// - Listens for two push buttons ("next" and "back"). On a press, sends a
//   single byte back over serial so the backend can step forward/backward
//   one letter at a time: 'N' for next, 'B' for back.
//
// NOTE: The Arduino/ESP32 framework has no concept of environment variables
// at build time, so all configurable values below are grouped into one
// `#define` block instead (the C++ equivalent for firmware). Change the pin
// numbers here to match your wiring; everything else in the project uses
// real environment variables (see backend/README).

#include <Arduino.h>

// ---- Configurable values -------------------------------------------------

// One GPIO pin per Braille dot (dot 1 -> DOT_PIN[0], ... dot 6 -> DOT_PIN[5]).
// Change these to match how the solenoids are wired on your board.
const int DOT_PINS[6] = {13, 12, 14, 27, 26, 25};

// Button pins. Wired with INPUT_PULLUP, so a press pulls the pin LOW.
const int NEXT_BUTTON_PIN = 32;
const int BACK_BUTTON_PIN = 33;

const long SERIAL_BAUD_RATE = 9600;

// How long a solenoid stays energized for one dot pattern before the next
// byte can overwrite it. Keep short so rapid characters don't blur together.
const int SOLENOID_HOLD_MS = 300;

// Simple debounce so one physical press doesn't register as multiple events.
const int BUTTON_DEBOUNCE_MS = 250;

// ---- State ----------------------------------------------------------------

unsigned long lastNextPressMs = 0;
unsigned long lastBackPressMs = 0;

void setup() {
  Serial.begin(SERIAL_BAUD_RATE);

  for (int i = 0; i < 6; i++) {
    pinMode(DOT_PINS[i], OUTPUT);
    digitalWrite(DOT_PINS[i], LOW);
  }

  pinMode(NEXT_BUTTON_PIN, INPUT_PULLUP);
  pinMode(BACK_BUTTON_PIN, INPUT_PULLUP);
}

// Drives the 6 solenoid pins from a 6-bit dot pattern byte.
void setDots(uint8_t pattern) {
  for (int dot = 0; dot < 6; dot++) {
    bool raised = bitRead(pattern, dot);
    digitalWrite(DOT_PINS[dot], raised ? HIGH : LOW);
  }
}

// Reads any incoming dot-pattern byte from the backend and fires the
// solenoids accordingly.
void handleIncomingSerial() {
  if (Serial.available() > 0) {
    uint8_t pattern = Serial.read();
    setDots(pattern);
    delay(SOLENOID_HOLD_MS);
  }
}

// Checks both buttons and reports a press back to the backend as a single
// byte: 'N' for next, 'B' for back.
void handleButtons() {
  unsigned long now = millis();

  if (digitalRead(NEXT_BUTTON_PIN) == LOW && now - lastNextPressMs > BUTTON_DEBOUNCE_MS) {
    lastNextPressMs = now;
    Serial.write('N');
  }

  if (digitalRead(BACK_BUTTON_PIN) == LOW && now - lastBackPressMs > BUTTON_DEBOUNCE_MS) {
    lastBackPressMs = now;
    Serial.write('B');
  }
}

void loop() {
  handleIncomingSerial();
  handleButtons();
}
