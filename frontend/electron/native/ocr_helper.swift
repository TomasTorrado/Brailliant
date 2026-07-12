// ocr_helper.swift
//
// Tiny CLI wrapper around macOS's Vision framework text recognition
// (VNRecognizeTextRequest) — the same engine behind "Live Text": built
// specifically to find and read text within real-world photos (angled,
// cluttered backgrounds, uneven lighting), not just clean scanned
// documents. Electron's renderer can't call this directly (it's a native
// macOS API), so main.cjs shells out to this compiled binary and reads
// back whatever it prints to stdout.
//
// Usage: ocr_helper <path-to-image>
// Prints a JSON array of {"text": ..., "top": ...} to stdout, one entry per
// detected text line, where `top` is that line's top edge as a fraction of
// the image's height (0 = top of image, 1 = bottom). main.cjs uses `top` to
// drop lines that fall inside a maximized browser's chrome (tabs/address
// bar/bookmarks bar) for Screenshot Mode, without us having to guess at a
// fixed crop in pixels.

import AppKit
import Foundation
import Vision

struct OcrLine: Codable {
    let text: String
    let top: Double
}

guard CommandLine.arguments.count > 1 else {
    FileHandle.standardError.write("Usage: ocr_helper <image_path>\n".data(using: .utf8)!)
    exit(1)
}

let imagePath = CommandLine.arguments[1]

guard let image = NSImage(contentsOfFile: imagePath),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("Could not load image at \(imagePath)\n".data(using: .utf8)!)
    exit(1)
}

let semaphore = DispatchSemaphore(value: 0)
var resultLines: [OcrLine] = []
var requestError: Error?

let request = VNRecognizeTextRequest { request, error in
    defer { semaphore.signal() }
    if let error = error {
        requestError = error
        return
    }
    guard let observations = request.results as? [VNRecognizedTextObservation] else { return }
    // Vision's boundingBox is normalized to [0,1] with the origin at the
    // BOTTOM-left of the image (Core Graphics convention), not the top-left
    // like screen/CSS coordinates. Flip it here so `top` means what it says
    // — distance from the top of the image — and callers don't also need
    // to know about Vision's coordinate convention.
    resultLines = observations.compactMap { observation in
        guard let text = observation.topCandidates(1).first?.string else { return nil }
        let box = observation.boundingBox
        let top = 1.0 - (box.origin.y + box.size.height)
        return OcrLine(text: text, top: Double(top))
    }
}
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    requestError = error
    semaphore.signal()
}

semaphore.wait()

if let requestError = requestError {
    FileHandle.standardError.write("Vision request failed: \(requestError)\n".data(using: .utf8)!)
    exit(1)
}

let encoder = JSONEncoder()
guard let data = try? encoder.encode(resultLines), let json = String(data: data, encoding: .utf8) else {
    FileHandle.standardError.write("Failed to encode OCR results\n".data(using: .utf8)!)
    exit(1)
}
print(json)
