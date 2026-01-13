# webLibs/qrLib/qr.min.js - QR Code Library

## Overview

Third-party QR code library for encoding and decoding QR codes. Used by WebChat and other browser interfaces for generating shareable meeting links and scanning QR codes from camera feeds.

## Source File

`webLibs/qrLib/qr.min.js`

## Library Information

**Library**: paulmillr-qr
**License**: Apache 2.0 OR MIT (dual-licensed)
**Author**: Paul Miller (paulmillr.com)
**Copyright**: 2023

## Global Export

```javascript
var qr = (function() {
    // ... minified library code ...
})();
```

The library exports a global `qr` object with encoding/decoding functionality.

## Public API

### qr.encodeQR(text, outputFormat, options)

**Purpose**: Encodes text into QR code

**Parameters**:
- `text` (string): Text to encode
- `outputFormat` (string): Output format - `'raw'`, `'ascii'`, `'svg'`, `'gif'`, `'term'`
- `options` (Object): Optional configuration
  - `ecc` (string): Error correction level - `'low'`, `'medium'`, `'quartile'`, `'high'`
  - `encoding` (string): Encoding mode - `'numeric'`, `'alphanumeric'`, `'byte'`, `'kanji'`, `'eci'`
  - `mask` (number): Mask pattern 0-7
  - `version` (number): QR version 1-40
  - `border` (number): Border size in modules (default: 2)
  - `scale` (number): Scale factor
  - `optimize` (boolean): SVG path optimization

**Returns**: Depends on outputFormat:
- `'raw'`: 2D boolean array
- `'ascii'`: ASCII art string
- `'svg'`: SVG string
- `'gif'`: Uint8Array GIF data
- `'term'`: Terminal color string

**Example**:
```javascript
// Generate SVG QR code
const svg = qr.encodeQR('https://example.com', 'svg', { ecc: 'medium' });

// Generate ASCII QR code
const ascii = qr.encodeQR('Hello', 'ascii');
```

### qr.decodeQR(image, options)

**Purpose**: Decodes QR code from image data

**Parameters**:
- `image` (Object): Image data
  - `height` (number): Image height
  - `width` (number): Image width
  - `data` (Uint8Array|Uint8ClampedArray|Array): Pixel data (RGB or RGBA)
- `options` (Object): Optional configuration
  - `cropToSquare` (boolean): Crop image to square before processing
  - `imageOnBitmap` (Function): Callback with bitmap image
  - `pointsOnDetect` (Function): Callback with finder pattern points
  - `imageOnDetect` (Function): Callback with detected image
  - `imageOnResult` (Function): Callback with result image

**Returns**: (string) Decoded text

**Example**:
```javascript
// Decode from canvas ImageData
const ctx = canvas.getContext('2d');
const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
const text = qr.decodeQR(imageData);
```

### qr.Bitmap

**Purpose**: Bitmap manipulation class for QR code data

**Static Methods**:
- `Bitmap.size(size, max)`: Calculate bounded size
- `Bitmap.fromString(str)`: Parse bitmap from string representation

**Instance Methods**:
- `point(pos)`: Get point value
- `isInside(pos)`: Check if position is inside bitmap
- `rect(pos, size, value)`: Draw/fill rectangle
- `rectRead(pos, size, callback)`: Read rectangle area
- `hLine(pos, length, value)`: Draw horizontal line
- `vLine(pos, length, value)`: Draw vertical line
- `border(width, value)`: Add border
- `embed(pos, bitmap)`: Embed another bitmap
- `rectSlice(pos, size)`: Extract rectangle as new bitmap
- `inverse()`: Transpose bitmap
- `scale(factor)`: Scale bitmap
- `clone()`: Clone bitmap
- `toString()`: Convert to string representation
- `toASCII()`: Convert to ASCII art
- `toTerm()`: Convert to terminal colors
- `toSVG(optimize)`: Convert to SVG
- `toGIF()`: Convert to GIF bytes
- `toImage(rgb)`: Convert to image data

### qr.dom

**Purpose**: DOM utilities for QR code display and camera capture

**Exports**:
- `QRCanvas`: Canvas-based QR display/decode class
- `frameLoop(callback)`: Animation frame loop helper
- `frontalCamera(video)`: Get camera stream
- `getSize(element)`: Get element dimensions
- `svgToPng(svg, width, height)`: Convert SVG to PNG data URL

### qr.dom.QRCanvas

**Purpose**: Canvas wrapper for QR display and decoding

**Constructor Options**:
- `overlay` (HTMLCanvasElement): Overlay canvas for finder patterns
- `bitmap` (HTMLCanvasElement): Bitmap visualization canvas
- `resultQR` (HTMLCanvasElement): Result display canvas

**Configuration**:
- `resultBlockSize`: Block size for result display (default: 8)
- `overlayMainColor`: Main overlay color (default: 'green')
- `overlayFinderColor`: Finder pattern color (default: 'blue')
- `overlaySideColor`: Side area color (default: 'black')
- `overlayTimeout`: Overlay clear timeout (default: 500ms)
- `cropToSquare`: Crop to square (default: true)

**Methods**:
- `setSize(height, width)`: Set canvas dimensions
- `drawBitmap(imageData)`: Draw bitmap visualization
- `drawResultQr(imageData)`: Draw result QR
- `drawOverlay(points)`: Draw finder pattern overlay
- `drawImage(source, height, width)`: Draw and decode image
- `clear()`: Clear all canvases

### qr.dom.frontalCamera(videoElement)

**Purpose**: Initialize camera stream

**Returns**: (Promise<CameraController>) Camera controller

**CameraController Methods**:
- `listDevices()`: List available cameras
- `setDevice(deviceId)`: Switch camera
- `readFrame(qrCanvas, invert)`: Read frame to canvas
- `stop()`: Stop camera stream

### qr.dom.frameLoop(callback)

**Purpose**: Animation frame loop

**Returns**: (Function) Stop function

```javascript
const stop = qr.dom.frameLoop((timestamp) => {
    // Called each frame
    camera.readFrame(qrCanvas);
});

// Later: stop the loop
stop();
```

### qr.dom.svgToPng(svg, width, height)

**Purpose**: Convert SVG to PNG data URL

**Parameters**:
- `svg` (string): SVG markup
- `width` (number): Output width
- `height` (number): Output height

**Returns**: (Promise<string>) PNG data URL

## Constants

### qr.ECMode

Error correction levels: `['low', 'medium', 'quartile', 'high']`

### qr.Encoding

Encoding modes: `['numeric', 'alphanumeric', 'byte', 'kanji', 'eci']`

## Error Correction Levels

| Level | Recovery Capability |
|-------|---------------------|
| `low` | ~7% |
| `medium` | ~15% |
| `quartile` | ~25% |
| `high` | ~30% |

## Usage in Ploinky

### WebChat QR Code Generation

```javascript
// Generate meeting link QR code
const meetingUrl = `${location.origin}/webchat?token=${token}`;
const svg = qr.encodeQR(meetingUrl, 'svg', {
    ecc: 'medium',
    border: 2
});
document.getElementById('qr-container').innerHTML = svg;
```

### Camera-based QR Scanning

```javascript
const qrCanvas = new qr.dom.QRCanvas({
    overlay: document.getElementById('overlay')
});

const camera = await qr.dom.frontalCamera(document.getElementById('video'));

qr.dom.frameLoop(() => {
    const result = qrCanvas.drawImage(video, video.videoHeight, video.videoWidth);
    if (result) {
        console.log('Decoded:', result);
        camera.stop();
    }
});
```

## Bundle Notes

This is a minified third-party bundle. The source is not included in the Ploinky repository. For updates or modifications, obtain the original library from the author's repository.

## Related Modules

- [../cli/server/webchat/server-webchat-index.md](../cli/server/webchat/server-webchat-index.md) - WebChat integration
