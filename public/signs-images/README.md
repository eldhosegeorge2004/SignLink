# Sign Language Images

This folder contains language-specific images of sign language gestures displayed as cards during speech-to-sign translation.

## Folder Structure

```
signs-images/
├── isl/              # Indian Sign Language images
│   ├── hello.jpg
│   ├── thank-you.jpg
│   └── ...
└── asl/              # American Sign Language images
    ├── hello.jpg
    ├── thank-you.jpg
    └── ...
```

## How to Add Sign Images

### 1. **Organize by Language**
- ISL signs go in → `signs-images/isl/`
- ASL signs go in → `signs-images/asl/`

### 2. **File Naming Convention**
Name images after the word they represent in lowercase:
- `hello.jpg` - displays when "hello" is spoken
- `thank-you.jpg` - displays when "thank you" is spoken (hyphenated for compound words)
- `please.jpg` - displays when "please" is spoken
- `yes.jpg`, `no.jpg`, `goodbye.jpg`, etc.

### 3. **File Format**
Supported formats: `.jpg`, `.png`, `.gif`, or `.webp`
- Use `.gif` for animated/dynamic sign cards with motion sequences

### 4. **Image Size**
- Recommended: 200x200px or larger
- Display size: 100x100px (scaled down on page)

## Getting Sign Images

### Free Sources:
- **[Spreadthesign.com](https://www.spreadthesign.com/)** - Extract video frames
  - Search for sign, play video, take screenshot
  - Supports multiple languages including ISL and ASL

- **[ASL Dictionary](https://www.asldict.com/)** - ASL images and videos

- **[Lifeprint.com](https://lifeprint.com/)** - ASL learning resources

- **[Indian Sign Language Dictionary](http://www.isld.in/)** - ISL resources

### Create Your Own:
1. Record yourself signing
2. Extract a clear frame/screenshot or create a multi-frame animation
3. Crop and save as `.jpg`, `.png`, or `.gif` (use GIF for animated signs)
4. Place in appropriate language folder

## How It Works

### When User Speaks:
1. Speech is recognized in speech-to-sign mode
2. Current language is detected (ISL or ASL)
3. Cards are displayed from `/signs-images/{language}/{word}.jpg/png/gif`
4. Animated cards (GIFs) will play automatically in the card display
5. If image missing → word label still shows
6. If user switches language → new images display automatically

### Example Flow:
```
User says "hello" in ISL mode
  ↓
Looks for: /signs-images/isl/hello.jpg
  ↓
Card displays with ISL sign image

User switches to ASL mode
  ↓
Looks for: /signs-images/asl/hello.jpg
  ↓
Card displays with ASL sign image (different handshape/movement)
```

## Compound Words

For multi-word signs, use hyphens:
- "thank-you" → one card with `thank-you.jpg`
- "how-are-you" → three cards: `how.jpg`, `are.jpg`, `you.jpg`

Choose based on whether that word pair is a single distinct sign.

## Testing

1. Open translation page
2. Select language (ISL or ASL)
3. Click "Switch to Live Speech"
4. Speak a word you have an image for
5. Card should display!

---

**Quick start:** Add a few `.jpg` files to the language folders and they'll display automatically when words are recognized! 🎉

