# SignLink - Quick Reference & Visual Guide

## 🏗️ System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     USER 1 BROWSER                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                                                      │  │
│  │  HTML/CSS ◄─ index.html (Home Page)                │  │
│  │                                                      │  │
│  │  Interactive Elements:                              │  │
│  │  • Animated Blobs (CSS keyframes)                  │  │
│  │  • Wave Canvas (JavaScript canvas)                 │  │
│  │  • Cursor Glow (CSS radial gradient)               │  │
│  │  • 3D Card Tilts (perspective transform)           │  │
│  │  • Hover Effects (scale + shadow)                  │  │
│  │                                                      │  │
│  │  Navigation: Click card → videocall.html           │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  videocall.html (Video Call Interface)             │  │
│  │                                                      │  │
│  │  Components:                                        │  │
│  │  ┌────────────────┐  ┌──────────────┐             │  │
│  │  │ Local Video    │  │ Remote Video │             │  │
│  │  │ (Your Camera)  │  │ (Peer Camera)│             │  │
│  │  │ + Landmarks    │  │              │             │  │
│  │  └────────────────┘  └──────────────┘             │  │
│  │                                                      │  │
│  │  Prediction Overlay:                               │  │
│  │  • Text: "HELLO"                                   │  │
│  │  • Sign Cards: [🤟][🖐][✊]...                      │  │
│  │  • Confidence: 92%                                 │  │
│  │                                                      │  │
│  │  Control Buttons: [🎤][📹][☎️][🚀][📢][💬][👥]    │  │
│  │                                                      │  │
│  │  Side Panels:                                       │  │
│  │  • Training (collect frames)                       │  │
│  │  • Chat (real-time messaging)                      │  │
│  │  • Info (meeting details)                          │  │
│  │                                                      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                           │
                ┌──────────┼──────────┐
                │          │          │
                ↓          ↓          ↓
         
    ┌─────────────┐  ┌──────────────┐  ┌──────────────┐
    │   SOCKET.IO │  │  LOCAL ML    │  │   WEBRTC    │
    │             │  │              │  │             │
    │ • Join Room │  │ • MediaPipe  │  │ • Peer Conn │
    │ • Send Chat │  │ • TensorFlow │  │ • Video     │
    │ • Gestures  │  │ • Frameworks │  │ • Audio     │
    │             │  │              │  │             │
    └─────────────┘  └──────────────┘  └──────────────┘
                           │          │          │
                           │          │          │
                           ↓          ↓          ↓
    
    ┌────────────────────────────────────────────────────┐
    │         EXPRESS.JS SERVER (Node.js)                │
    │                                                    │
    │  • Socket.io Event Handler                        │
    │  • WebRTC Signaling                               │
    │  • Static File Serving                            │
    │  • API Endpoints (/api/training-data, etc)       │
    │                                                    │
    └─────────────────┬──────────────────────────────────┘
                      │
         ┌────────────┴────────────┐
         │                         │
         ↓                         ↓
    
    ┌──────────────┐         ┌──────────────────┐
    │  SUPABASE    │         │  FIREBASE        │
    │ (PostgreSQL) │         │  (Alternative)   │
    │              │         │                  │
    │ Tables:      │         │ Firestore:       │
    │ • training   │         │ • gestures       │
    │ • users      │         │ • asl_gestures   │
    │ • models     │         │ • chats          │
    │              │         │                  │
    └──────────────┘         └──────────────────┘
```

---

## 🎨 Frontend Stack Hierarchy

```
index.html (Home Page)
│
├─ CSS Variables (Custom Properties)
│  ├─ Colors (--primary, --bg-dark, --text-main)
│  ├─ Typography (--font-heading, --font-body)
│  ├─ Gradients (--gradient-primary)
│  └─ Spacing (--ease-out for animations)
│
├─ HTML Structure
│  ├─ Header (Logo + Title + Subtitle)
│  ├─ Cards Container (3 cards with hover effects)
│  │  ├─ Video Call Card
│  │  ├─ Live Translation Card
│  │  └─ AI Training Card
│  │
│  └─ Visual Effects Layers
│     ├─ Background Blobs (CSS animations)
│     ├─ Spline Canvas (JavaScript canvas waves)
│     └─ Cursor Glow (CSS radial gradient)
│
└─ JavaScript
   ├─ Mouse Movement Tracking
   ├─ Card 3D Tilt Effect
   ├─ Blob Parallax
   ├─ Wave Canvas Animation
   └─ Responsive Detection (touch vs mouse)
```

---

## 🎬 UI State Machine

```
START
  │
  ├─→ Home Screen (index.html)
  │     │
  │     ├─ [Video Call] ──→ videocall.html
  │     │                    │
  │     │                    ├─ [Input Room ID]
  │     │                    │  │
  │     │                    ├─ [Join Room]
  │     │                    │  │
  │     │                    └─ Video Call Interface
  │     │                       ├─ Local Video + Landmarks
  │     │                       ├─ Remote Video + Caption
  │     │                       ├─ Predictions Overlay
  │     │                       ├─ Control Buttons
  │     │                       │  ├─ Mic Toggle
  │     │                       │  ├─ Camera Toggle
  │     │                       │  ├─ Training Toggle
  │     │                       │  ├─ Chat Toggle
  │     │                       │  └─ People List
  │     │                       └─ Side Panels (Training/Chat/Info)
  │     │                          │
  │     │                          ├─ Training Panel
  │     │                          │  ├─ Collect Frames
  │     │                          │  ├─ Train Model
  │     │                          │  └─ Save to Firebase
  │     │                          │
  │     │                          ├─ Chat Panel
  │     │                          │  ├─ Message List
  │     │                          │  └─ Input Field
  │     │                          │
  │     │                          └─ Info Panel
  │     │                             ├─ Meeting Code
  │     │                             └─ Copy Button
  │     │
  │     ├─ [Live Translation] ──→ translation.html
  │     │                          │
  │     │                          ├─ Your Camera
  │     │                          ├─ Real-time Text Output
  │     │                          ├─ Sign Cards Display
  │     │                          ├─ STT Toggle
  │     │                          ├─ TTS Toggle
  │     │                          └─ Caption Log
  │     │
  │     └─ [AI Training] ──→ training.html
  │                           │
  │                           ├─ Label Selector
  │                           ├─ Your Camera
  │                           ├─ Frame Counter
  │                           ├─ Collect Button
  │                           ├─ Train Button
  │                           └─ Dataset Preview
  │
END
```

---

## 📐 CSS Layout Grid

### Home Screen (index.html)
```
┌───────────────────────────────────────────────────┐
│  100vw × 100dvh (Full Viewport)                   │
│                                                      │
│  ┌──────────────────────────────────────────────┐  │
│  │  Fixed Background Layers                     │  │
│  │  • Gradient radials                          │  │
│  │  • Animated blobs (Z-index: -1)              │  │
│  │  • Spline canvas waves (Z-index: 0)          │  │
│  │  • Cursor glow (Z-index: 1)                  │  │
│  └──────────────────────────────────────────────┘  │
│                                                      │
│  ┌──────────────────────────────────────────────┐  │
│  │  Flex Container (Z-index: 2)                 │  │
│  │  display: flex                               │  │
│  │  flex-direction: column                      │  │
│  │  align-items: center                         │  │
│  │  justify-content: center                     │  │
│  │                                               │  │
│  │  ┌──────────────────────────────────────┐   │  │
│  │  │  Header (margin-bottom: 50px)        │   │  │
│  │  │  • Logo Icon (36px material icon)    │   │  │
│  │  │  • H1 Title (clamp(2,6vw,3.5)rem)   │   │  │
│  │  │  • Subtitle (clamp(.9,2.5vw,1.2)rem)│   │  │
│  │  │  Animation: fadeInDown 0.8s          │   │  │
│  │  └──────────────────────────────────────┘   │  │
│  │                                               │  │
│  │  ┌──────────────────────────────────────┐   │  │
│  │  │ Cards Container                      │   │  │
│  │  │ display: flex                        │   │  │
│  │  │ gap: 24px                            │   │  │
│  │  │ flex-wrap: wrap                      │   │  │
│  │  │ justify-content: center              │   │  │
│  │  │                                       │   │  │
│  │  │ ┌────────┐ ┌────────┐ ┌────────┐   │   │  │
│  │  │ │ Card 1 │ │ Card 2 │ │ Card 3 │   │   │  │
│  │  │ │(Video │ │ Live   │ │ AI     │   │   │  │
│  │  │ │ Call) │ │Trans.) │ │Train.)│   │   │  │
│  │  │ │       │ │        │ │       │   │   │  │
│  │  │ │ flex: │ │ flex:  │ │ flex: │   │   │  │
│  │  │ │1 1 300│ │1 1 300 │ │1 1 300│   │   │  │
│  │  │ └────────┘ └────────┘ └────────┘   │   │  │
│  │  │ Animation delays:                    │   │  │
│  │  │ • Card 1: 0.1s fadeInUp             │   │  │
│  │  │ • Card 2: 0.2s fadeInUp             │   │  │
│  │  │ • Card 3: 0.3s fadeInUp             │   │  │
│  │  └──────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────┘  │
│                                                      │
└───────────────────────────────────────────────────┘

Desktop Breakpoint (>900px):
├─ 3 columns
├─ Cards side-by-side
├─ Full header visible
└─ No scroll needed

Tablet Breakpoint (600-900px):
├─ Flexible wrap (2 cards, then 1)
├─ Smaller padding
├─ Scroll if needed
└─ Touch-friendly spacing

Mobile Breakpoint (<600px):
├─ Single column
├─ Full width cards
├─ 24px padding
├─ Scroll: yes
└─ No hover effects
```

### Video Call Screen (videocall.html)
```
┌─────────────────────────────────────────────────┐
│ Header: Meeting Code | Clock | Settings         │
├─────────────────────────────────────────────────┤
│  flex-direction: row                            │
│                                                  │
│  ┌──────────────────┐  ┌──────────────────┐   │
│  │   Local Video    │  │  Remote Video    │   │
│  │   flex: 1        │  │  flex: 1         │   │
│  │   position: rel  │  │  position: rel   │   │
│  │                  │  │                  │   │
│  │  Canvas:         │  │  Overlay:        │   │
│  │  • Hand         │  │  • Remote Caption│   │
│  │    Landmarks    │  │  • Participant   │   │
│  │    (MP overlay) │  │    Name          │   │
│  │                  │  │                  │   │
│  │  Overlay:        │  │  Volume Meter:   │   │
│  │  • Prediction    │  │  • Remote Volume │   │
│  │  • Confidence    │  │                  │   │
│  │  • Sign Cards    │  │                  │   │
│  └──────────────────┘  └──────────────────┘   │
│                                                  │
├─────────────────────────────────────────────────┤
│  Control Bar (Bottom)                           │
│  display: flex                                  │
│  justify-content: center                        │
│  gap: 16px                                      │
│  padding: 20px                                  │
│                                                  │
│  Buttons: [🎤] [📹] [☎️] [🚀] [📢] [💬] [👥]  │
│  • Glass effect (rgba + blur)                  │
│  • Hover: scale + glow                         │
│  • Active state: different color               │
└─────────────────────────────────────────────────┘

Side Panels (Absolute positioning):
right: 0
top: 0
height: 100%
width: 300px (desktop) / 100% (mobile)
transform: translateX(0/400px) based on visible
transition: 0.3s cubic-bezier
background: var(--glass-bg)
z-index: 10
```

---

## 🔄 Data Flow Diagram

### User Gesture → Recognition → Display

```
User performs gesture
    │
    ├─ [Camera Capture @ 30fps]
    │  └─ Frame sent to MediaPipe
    │
    ├─ [MediaPipe Hand Landmark Detection]
    │  └─ Returns 21 keypoints (x, y, z) per hand
    │
    ├─ [Draw Landmarks on Canvas]
    │  └─ Blue dots + connecting lines visualize hands
    │
    ├─ [Prepare Features]
    │  └─ Flatten 21 landmarks × 3 coords = 63 values
    │
    ├─ [TensorFlow.js Model Prediction]
    │  └─ Input (63,) → Dense Layers → Output (N_classes,)
    │
    ├─ [Post-process Results]
    │  │  • Get highest probability class
    │  │  • Extract confidence score
    │  │  • Apply confidence threshold (e.g., > 0.85)
    │  │
    │  └─ if confidence > threshold:
    │      │  dispatch prediction
    │      │
    │      └─ if NOT > threshold:
    │         │  show "No confident prediction"
    │         │
    │         └─ wait for next frame
    │
    ├─ [Display in Local Overlay]
    │  │  • Text: Gesture label
    │  │  • Confidence: % score
    │  │  • Sign Cards: Fetch images for label
    │  │
    │  └─ predictionDiv.textContent = label
    │
    ├─ [Emit via Socket.io to Remote Peer]
    │  │  socket.emit('gesture-recognized', {
    │  │      userId: myId,
    │  │      gesture: label,
    │  │      confidence: score
    │  │  })
    │  │
    │  └─ Server broadcasts to room
    │
    └─ [Display on Remote Video]
       remotePredictionDiv.textContent = label
```

---

## 🎛️ Component Library (Reusable UI Patterns)

### 1. Button (Primary)
```html
<button class="btn-primary">
    <i class="material-icons">icon_name</i>
    Label
</button>
```
```css
background: var(--gradient-primary);
padding: 16px 32px;
border-radius: 12px;
transition: all 0.3s;
box-shadow: 0 8px 20px rgba(59, 130, 246, 0.4);
```

### 2. Glass Panel
```css
background: var(--glass-bg);
border: 1px solid var(--glass-border);
backdrop-filter: blur(12px);
border-radius: 32px;
```

### 3. Input Field
```css
background: rgba(0, 0, 0, 0.3);
border: 1px solid var(--glass-border);
padding: 14px 20px;
border-radius: 12px;
color: white;
transition: all 0.2s;

&:focus-within {
    border-color: var(--primary-color);
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}
```

### 4. Video Container
```css
position: relative;
width: 100%;
aspect-ratio: 16 / 9;
background: rgba(0, 0, 0, 0.8);
border-radius: 16px;
overflow: hidden;
```

### 5. Overlay Text
```css
position: absolute;
top: 50%;
left: 50%;
transform: translate(-50%, -50%);
background: rgba(0, 0, 0, 0.6);
padding: 12px 24px;
border-radius: 8px;
font-size: 1.2rem;
z-index: 5;
```

---

## 🎯 Performance Metrics

### Page Load
- Home: ~500ms (mostly CSS animations + canvas setup)
- Video Call: ~1-2s (MediaPipe + TensorFlow model loading)
- Inference: ~50-100ms per frame (Browser GPU acceleration)

### Network
- Gesture prediction: ~100 bytes Socket.io emission
- Chat message: ~200-500 bytes
- Training batch: ~100KB for 500 frames
- Video stream: 2-5 Mbps (WebRTC auto-adjusts)

### Browser Memory
- Home screen: ~50 MB
- Video call (idle): ~150 MB
- Video call (running): ~250-300 MB
- Training data buffer: ~10 MB (30 frames max)

---

## 📚 File Reference Quick Lookup

| File | Purpose | Size | Key Elements |
|------|---------|------|--------------|
| `index.html` | Home page | ~400 lines | 3 cards, animations |
| `videocall.html` | Video call UI | ~800 lines | Videos, buttons, overlays |
| `translation.html` | Sign-to-text | ~600 lines | Camera, predictions |
| `training.html` | Data collection | ~500 lines | Frame collector |
| `style.css` | Main styles | ~1200 lines | Variables, responsive |
| `script.js` | Video call logic | ~2000 lines | WebRTC, ML, Socket.io |
| `translation.js` | Translation logic | ~1500 lines | Gesture detection |
| `training.js` | Training logic | ~1200 lines | Data capture |
| `server.js` | Backend | ~600 lines | Express, Socket.io, APIs |
| `firebase-config.js` | DB config | ~50 lines | Credentials |

---

## 🎓 Key Concepts for Presentation

### "Glassmorphism = Depth Without Heaviness"
> By using semi-transparent layers with backdrop blur, we create a premium feel while maintaining readability. It's like layered glass panels floating above the background.

### "Real-time = Socket.io WebSocket"
> Instead of polling (asking server for updates repeatedly), WebSocket opens a persistent connection. When user A makes a gesture, it's instantly broadcast to user B through this connection.

### "Client-side ML = Privacy by Design"
> The MediaPipe hand detection and TensorFlow.js model run entirely in the user's browser. The server never sees raw video—only gesture labels. This is why users trust the app with video data.

### "Responsive Design ≠ Just Smaller Screens"
> True responsive design adapts layouts, interactions, and even features based on device. Mobile users don't get hover effects; touch devices get larger buttons.

### "Predictions = Probability Distribution"
> The ML model doesn't give a yes/no answer. It outputs probabilities for each gesture class. We only display results with >85% confidence to avoid false positives.

---

## 🚀 Quick Demo Checklist

- [ ] Open home page → Show animations
- [ ] Hover cards → Demonstrate 3D tilt & lift effect
- [ ] Navigate to video call → Show two-user setup
- [ ] Perform gesture → Show real-time recognition
- [ ] Toggle training panel → Show data collection
- [ ] Send chat message → Show real-time sync
- [ ] Resize browser → Show responsive scaling
- [ ] Open translation mode → Show standalone operation

---

Good luck with your presentation! 🎉
