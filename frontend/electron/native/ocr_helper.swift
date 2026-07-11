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
// Prints recognized text to stdout, one line per detected text line.

import AppKit
import Foundation
import Vision

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
var resultText = ""
var requestError: Error?

let request = VNRecognizeTextRequest { request, error in
    defer { semaphore.signal() }
    if let error = error {
        requestError = error
        return
    }
    guard let observations = request.results as? [VNRecognizedTextObservation] else { return }
    resultText = observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
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

print(resultText)
