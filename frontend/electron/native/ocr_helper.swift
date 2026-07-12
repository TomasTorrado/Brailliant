// ocr_helper.swift
//
// CLI wrapper around macOS's Vision framework text recognition
// (VNRecognizeTextRequest) — the same engine behind "Live Text": built to
// find and read text within real-world photos (angled, cluttered
// backgrounds, uneven lighting), not just clean scans. Electron's renderer
// can't call native macOS APIs directly, so main.cjs talks to this binary.
//
// Three ways to run it:
//   ocr_helper <image>                — accurate OCR, prints text (one line
//                                       per detected line). Used at capture.
//   ocr_helper --fast --json <image>  — one-shot quick pass, prints a JSON
//                                       array of { text, confidence, x, y,
//                                       w, h } (box in top-left-origin
//                                       normalized coords).
//   ocr_helper --serve                — PERSISTENT streaming server for the
//                                       live camera-guidance loop. Reads
//                                       length-prefixed JPEG frames on stdin
//                                       and writes one JSON line of boxes per
//                                       frame on stdout. Keeping one warm
//                                       process (no per-frame process spawn,
//                                       no temp files, Vision already loaded)
//                                       is what makes live tracking reactive.
//
// --fast / serve trade a little accuracy for speed (recognitionLevel .fast,
// no language correction) — fine for "where is the text and how confident are
// we", which is all the guidance loop needs. Capture stays accurate.

import AppKit
import Foundation
import Vision

// Runs a text-recognition pass and returns [text, confidence, top-left box].
// Vision boxes are normalized with a bottom-left origin; y is flipped here so
// the renderer can treat them like screen space.
func recognize(_ cgImage: CGImage, fast: Bool) -> [[String: Any]] {
    let semaphore = DispatchSemaphore(value: 0)
    var observations: [VNRecognizedTextObservation] = []

    let request = VNRecognizeTextRequest { req, _ in
        defer { semaphore.signal() }
        observations = (req.results as? [VNRecognizedTextObservation]) ?? []
    }
    request.recognitionLevel = fast ? .fast : .accurate
    request.usesLanguageCorrection = !fast
    request.recognitionLanguages = ["en-US"]

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    do {
        try handler.perform([request])
    } catch {
        return []
    }
    semaphore.wait()

    var items: [[String: Any]] = []
    for obs in observations {
        guard let candidate = obs.topCandidates(1).first else { continue }
        let box = obs.boundingBox
        let h = Double(box.size.height)
        items.append([
            "text": candidate.string,
            "confidence": Double(candidate.confidence),
            "x": Double(box.origin.x),
            "y": 1.0 - Double(box.origin.y) - h,
            "w": Double(box.size.width),
            "h": h,
        ])
    }
    return items
}

func cgImage(fromData data: Data) -> CGImage? {
    guard let image = NSImage(data: data) else { return nil }
    return image.cgImage(forProposedRect: nil, context: nil, hints: nil)
}

// ---- Persistent streaming server ----------------------------------------
//
// Frame protocol on stdin: a 4-byte big-endian length, then that many bytes
// of JPEG. Response on stdout: one JSON line (the boxes array) per frame,
// written via FileHandle so it's unbuffered — `print` to a pipe is block-
// buffered and would stall the renderer.
func runServer() {
    let input = FileHandle.standardInput
    let output = FileHandle.standardOutput

    func readExactly(_ count: Int) -> Data? {
        var data = Data()
        while data.count < count {
            let chunk = input.readData(ofLength: count - data.count)
            if chunk.isEmpty { return nil } // EOF
            data.append(chunk)
        }
        return data
    }

    func emit(_ items: [[String: Any]]) {
        let json = (try? JSONSerialization.data(withJSONObject: items, options: [])) ?? Data("[]".utf8)
        output.write(json)
        output.write(Data([0x0a])) // newline
    }

    while true {
        guard let header = readExactly(4) else { break }
        let length = (Int(header[0]) << 24) | (Int(header[1]) << 16) | (Int(header[2]) << 8) | Int(header[3])
        guard length > 0, length < 50_000_000, let frame = readExactly(length) else { break }
        guard let cg = cgImage(fromData: frame) else { emit([]); continue }
        emit(recognize(cg, fast: true))
    }
}

// ---- Argument dispatch ---------------------------------------------------

var fast = false
var json = false
var serve = false
var imagePath: String?
for arg in CommandLine.arguments.dropFirst() {
    switch arg {
    case "--fast": fast = true
    case "--json": json = true
    case "--serve": serve = true
    default: imagePath = arg
    }
}

if serve {
    runServer()
    exit(0)
}

guard let imagePath = imagePath else {
    FileHandle.standardError.write("Usage: ocr_helper [--fast] [--json] <image> | --serve\n".data(using: .utf8)!)
    exit(1)
}

guard let image = NSImage(contentsOfFile: imagePath),
      let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("Could not load image at \(imagePath)\n".data(using: .utf8)!)
    exit(1)
}

let items = recognize(cg, fast: fast)

if json {
    let data = try! JSONSerialization.data(withJSONObject: items, options: [])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
} else {
    let text = items.compactMap { $0["text"] as? String }.joined(separator: "\n")
    print(text)
}
