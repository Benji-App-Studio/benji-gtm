// On-device OCR for the creative runner (macOS Vision, free, no network). For each image path it
// prints one JSON object: the image size and every recognised line with its confidence, its box
// (normalised, origin top-left), its height as a share of the image height, and a contrast ratio
// (WCAG formula) between the darkest and lightest tenth of the pixels inside the box; and the box of
// every face Vision finds (QA warns when text covers a face).
//   swift ocr.swift frame1.png frame2.png      (or compile once: swiftc -O ocr.swift -o ocr)
import Foundation
import Vision
import CoreGraphics
import ImageIO

struct Line: Codable { let text: String; let confidence: Float; let x: Double; let y: Double; let w: Double; let h: Double; let heightFrac: Double; let contrast: Double }
struct Box: Codable { let x: Double; let y: Double; let w: Double; let h: Double }
struct Result: Codable { let path: String; let width: Int; let height: Int; let lines: [Line]; let faces: [Box]?; let error: String? }

func luminance(_ r: UInt8, _ g: UInt8, _ b: UInt8) -> Double {
  func channel(_ c: UInt8) -> Double { let v = Double(c) / 255; return v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/// RGBA8 pixels of the whole image, drawn once.
func pixels(_ image: CGImage) -> [UInt8] {
  let w = image.width, h = image.height
  var data = [UInt8](repeating: 0, count: w * h * 4)
  let space = CGColorSpaceCreateDeviceRGB()
  data.withUnsafeMutableBytes { buffer in
    if let ctx = CGContext(data: buffer.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) {
      ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    }
  }
  return data
}

func contrast(_ data: [UInt8], width: Int, height: Int, box: CGRect) -> Double {
  // `box` is top-left normalised.
  let x0 = max(0, Int(box.minX * Double(width))), x1 = min(width, Int(box.maxX * Double(width)))
  let y0 = max(0, Int(box.minY * Double(height))), y1 = min(height, Int(box.maxY * Double(height)))
  if x1 <= x0 || y1 <= y0 { return 1 }
  var values: [Double] = []
  let step = max(1, Int(sqrt(Double((x1 - x0) * (y1 - y0)) / 4000)))
  var y = y0
  while y < y1 {
    var x = x0
    while x < x1 {
      let i = (y * width + x) * 4
      values.append(luminance(data[i], data[i + 1], data[i + 2]))
      x += step
    }
    y += step
  }
  values.sort()
  let dark = values[Int(Double(values.count - 1) * 0.1)], light = values[Int(Double(values.count - 1) * 0.9)]
  return (light + 0.05) / (dark + 0.05)
}

func recognise(_ path: String) -> Result {
  guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    return Result(path: path, width: 0, height: 0, lines: [], faces: nil, error: "unreadable image")
  }
  // Accurate first; when the Neural Engine isn't available (sandboxes, some VMs) fall back to the
  // fast recogniser, which runs on the CPU.
  var request = VNRecognizeTextRequest()
  var failure: String? = nil
  for level in [VNRequestTextRecognitionLevel.accurate, .fast] {
    request = VNRecognizeTextRequest()
    request.recognitionLevel = level
    request.usesLanguageCorrection = false
    do { try VNImageRequestHandler(cgImage: image, options: [:]).perform([request]); failure = nil; break } catch { failure = "\(error)" }
  }
  if let failure { return Result(path: path, width: image.width, height: image.height, lines: [], faces: nil, error: failure) }
  let data = pixels(image)
  let lines: [Line] = (request.results ?? []).compactMap { observation in
    guard let top = observation.topCandidates(1).first else { return nil }
    let b = observation.boundingBox // bottom-left origin
    let box = CGRect(x: b.minX, y: 1 - b.maxY, width: b.width, height: b.height)
    return Line(text: top.string, confidence: top.confidence, x: box.minX, y: box.minY, w: box.width, h: box.height,
                heightFrac: box.height, contrast: (contrast(data, width: image.width, height: image.height, box: box) * 100).rounded() / 100)
  }
  // Faces: nil when the detector couldn't run (not looked for), else every face's box, top-left origin.
  let faceRequest = VNDetectFaceRectanglesRequest()
  let faces: [Box]? = (try? VNImageRequestHandler(cgImage: image, options: [:]).perform([faceRequest])) == nil ? nil
    : (faceRequest.results ?? []).map { f in let b = f.boundingBox; return Box(x: b.minX, y: 1 - b.maxY, w: b.width, h: b.height) }
  return Result(path: path, width: image.width, height: image.height, lines: lines, faces: faces, error: nil)
}

let encoder = JSONEncoder()
for path in CommandLine.arguments.dropFirst() {
  if let json = try? encoder.encode(recognise(path)), let text = String(data: json, encoding: .utf8) { print(text) }
}
