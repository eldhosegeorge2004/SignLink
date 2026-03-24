# SignLink - Detailed UI Component Breakdown

## 🎨 Complete Component Library

### 1. Material Design Icons Integration

The app uses **Google Material Icons** via CDN:
```html
<link href="https://fonts.googleapis.com/icon?family=Material+Icons">
<span class="material-icons">video_camera_front</span>
```

**Common icons used:**
- `sign_language` - Logo (36px)
- `video_camera_front` - Video call
- `translate` - Translation
- `model_training` - AI training
- `mic`, `mic_off` - Microphone toggle
- `videocam`, `videocam_off` - Camera toggle
- `call_end` - Hang up button
- `chat_bubble` - Chat
- `people` - Participants list
- `info` - Information

---

## 📄 Screen-by-Screen Component Breakdown

### SCREEN 1: Home Page (index.html)

#### Structure:
```html
<body>
  <!-- Visual Effects Layer -->
  <div class="cursor-glow"></div>
  <canvas id="spline-canvas"></canvas>
  <div class="bg-blobs">
    <div class="blob blob-1"></div>
    <div class="blob blob-2"></div>
    <div class="blob blob-3"></div>
  </div>

  <!-- Content Layer -->
  <header>
    <div class="logo-area">
      <span class="material-icons logo-icon">sign_language</span>
    </div>
    <h1>Welcome to SignLink</h1>
    <p class="subtitle">Choose how you want to connect today.</p>
  </header>

  <div class="cards-container">
    <a href="videocall.html" class="card">
      <!-- Card Content -->
    </a>
    <!-- More cards -->
  </div>
</body>
```

#### Component 1: Header
**Position:** Top, centered
**Content:**
- Logo icon (36px, Material Icons)
- H1 title with gradient text
- Subtitle with muted color

**CSS:**
```css
header {
    text-align: center;
    margin-bottom: 50px;
    animation: fadeInDown 0.8s;
}

h1 {
    font-size: clamp(2rem, 6vw, 3.5rem);  /* Responsive scaling */
    background: linear-gradient(135deg, #fff 30%, #a5d6ff 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    letter-spacing: -1px;
}
```

**Sizing:**
- Title: 2rem (mobile) → 3.5rem (desktop)
- Subtitle: 0.9rem → 1.2rem
- Gap: 12px between logo and text

#### Component 2: Card
**Type:** Interactive Link
**Dimensions:** `300-360px width × auto height`
**Layout:** Flex column

**Sub-components:**
```html
<a class="card" href="videocall.html">
  <!-- Image Wrapper -->
  <div class="card-image-wrapper">
    <img src="videocall_card.png" alt="Video Call Illustration">
  </div>

  <!-- Content -->
  <div class="card-content">
    <h2>Video Call</h2>
    <p>Connect with others in real-time...</p>
  </div>

  <!-- Icon -->
  <span class="material-icons card-icon">video_camera_front</span>
</a>
```

**CSS Properties:**
```css
.card {
    background: var(--glass-bg);  /* rgba(22, 27, 34, 0.6) */
    border: 1px solid var(--glass-border);
    backdrop-filter: blur(12px);
    border-radius: 32px;
    padding: 32px;
    
    /* Animations */
    transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
    animation: fadeInUp 0.8s both;
    
    /* Hover Effects */
}

.card:hover {
    transform: translateY(-12px) scale(1.02);
    background: rgba(47, 129, 247, 0.08);
    border-color: var(--primary);
    box-shadow: 0 30px 60px rgba(0, 0, 0, 0.4), 
                0 0 20px rgba(47, 129, 247, 0.4);
}

/* 3D Tilt on hover - controlled by JavaScript */
.card:hover {
    transform: perspective(1000px) 
               rotateX(var(--tiltX)deg) 
               rotateY(var(--tiltY)deg) 
               translateY(-5px);
}
```

**Staggered Animation:**
```css
.card:nth-child(1) { animation-delay: 0.1s; }
.card:nth-child(2) { animation-delay: 0.2s; }
.card:nth-child(3) { animation-delay: 0.3s; }
```

**Image Wrapper:**
```css
.card-image-wrapper {
    width: 100%;
    height: 180px;
    border-radius: 20px;
    overflow: hidden;
    background: rgba(0, 0, 0, 0.2);
    margin-bottom: 24px;
}

.card-image-wrapper img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.6s;
}

.card:hover .card-image-wrapper img {
    transform: scale(1.1);  /* Zoom on hover */
}
```

#### Component 3: Background Effects

**Blob Animation:**
```css
.blob {
    position: absolute;
    border-radius: 50%;
    opacity: 0.15;
    animation: move-blob 20s infinite alternate;
}

.blob-1 {
    width: 500px;
    height: 500px;
    background: var(--primary);
    top: -100px;
    left: -100px;
    animation-duration: 25s;
}

@keyframes move-blob {
    0% { transform: translate(0, 0) scale(1); }
    100% { transform: translate(100px, 50px) scale(1.1); }
}
```

**Wave Canvas (JavaScript drawing):**
```javascript
// 5 sine waves on canvas, mouse-interactive
// Each wave:
// - Amplitude: 30-70px
// - Speed: 0.003-0.011 per frame
// - Color: Blue/Purple with opacity
// - Mouse distortion: 250px radius influence
```

**Cursor Glow:**
```css
.cursor-glow {
    position: fixed;
    width: 600px;
    height: 600px;
    background: radial-gradient(circle, 
                rgba(47, 129, 247, 0.08) 0%, 
                transparent 70%);
    border-radius: 50%;
    pointer-events: none;
    z-index: 1;
}

/* Follows mouse with JavaScript */
```

---

### SCREEN 2: Video Call (videocall.html)

#### Main Layout Structure:
```
┌─────────────────────────────────────┐
│  Header: Logo | Code | Clock | Menu │
├─────────────────────────────────────┤
│                                     │
│  Video Grid (flex-row)              │
│  ├─ Local Video (flex: 1)           │
│  └─ Remote Video (flex: 1)          │
│                                     │
├─────────────────────────────────────┤
│  Control Bar (flex, centered)       │
│  └─ 7 Action Buttons                │
└─────────────────────────────────────┘

Side Panels (Absolute):
├─ Training Panel
├─ Chat Panel
├─ Info Panel
└─ People Panel
```

#### Component 1: Header

```html
<header>
    <div class="logo">
        <span class="material-icons">sign_language</span>
        SignLink
    </div>
    
    <div class="meeting-info">
        <span id="meetingCodeDisplay">Room: ABC123</span>
        <button id="copyCodeBtn">Copy</button>
    </div>
    
    <div class="clock" id="clock">14:32</div>
</header>
```

**CSS:**
```css
header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 30px 60px;
    background: rgba(0, 0, 0, 0.2);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.logo {
    display: flex;
    align-items: center;
    gap: 12px;
    font-weight: 700;
    font-size: 26px;
}

.clock {
    background: var(--glass-bg);
    padding: 8px 16px;
    border-radius: 20px;
    border: 1px solid var(--glass-border);
}
```

#### Component 2: Video Grid

```html
<div class="video-grid">
    <!-- Local Video -->
    <div class="video-container local">
        <video id="localVideo" autoplay muted playsinline></video>
        <canvas id="localCanvas"></canvas>
        
        <!-- Prediction Overlay -->
        <div id="prediction-overlay">
            <div id="prediction">HELLO</div>
            <div id="prediction-sign-cards-container">
                <!-- Sign card images injected here -->
            </div>
        </div>
    </div>

    <!-- Remote Video -->
    <div class="video-container remote">
        <video id="remoteVideo" autoplay playsinline></video>
        
        <!-- Remote Caption Overlay -->
        <div id="remote-caption-overlay">
            <div id="remotePrediction">HELLO</div>
        </div>
    </div>
</div>
```

**CSS:**
```css
.video-grid {
    display: flex;
    gap: 16px;
    flex: 1;
    width: 100%;
    max-width: 1600px;
    height: 100%;
    padding: 20px;
}

.video-container {
    position: relative;
    flex: 1;
    background: rgba(0, 0, 0, 0.8);
    border-radius: 16px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
}

.video-container video {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.video-container canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 2;
}
```

**Prediction Overlay:**
```css
#prediction-overlay {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.7);
    padding: 16px 24px;
    border-radius: 12px;
    backdrop-filter: blur(10px);
    text-align: center;
    z-index: 5;
}

#prediction {
    font-size: 1.8rem;
    font-weight: 700;
    color: #3b82f6;
    margin-bottom: 12px;
}

#prediction-sign-cards-container {
    display: flex;
    gap: 8px;
    justify-content: center;
    flex-wrap: wrap;
    max-width: 300px;
}

.sign-card-img {
    width: 60px;
    height: 60px;
    border-radius: 8px;
    object-fit: cover;
    border: 2px solid #3b82f6;
}
```

#### Component 3: Control Bar

```html
<div class="control-bar">
    <button id="micBtn" class="control-btn" title="Toggle Microphone">
        <span class="material-icons">mic</span>
    </button>
    
    <button id="camBtn" class="control-btn" title="Toggle Camera">
        <span class="material-icons">videocam</span>
    </button>
    
    <button id="hangupBtn" class="control-btn danger" title="End Call">
        <span class="material-icons">call_end</span>
    </button>
    
    <button id="trainToggleBtn" class="control-btn" title="Toggle Training">
        <span class="material-icons">model_training</span>
    </button>
    
    <button id="ttsBtn" class="control-btn" title="Text to Speech">
        <span class="material-icons">record_voice_over</span>
    </button>
    
    <button id="chatToggleBtn" class="control-btn" title="Open Chat">
        <span class="material-icons">chat_bubble</span>
    </button>
    
    <button id="peopleBtn" class="control-btn" title="Show Participants">
        <span class="material-icons">people</span>
    </button>
</div>
```

**CSS:**
```css
.control-bar {
    display: flex;
    justify-content: center;
    gap: 16px;
    padding: 20px;
    background: rgba(0, 0, 0, 0.2);
    backdrop-filter: blur(10px);
    border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.control-btn {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #ffffff;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.3s;
    position: relative;
}

.control-btn:hover {
    background: rgba(59, 130, 246, 0.2);
    border-color: #3b82f6;
    transform: scale(1.1);
    box-shadow: 0 0 20px rgba(59, 130, 246, 0.3);
}

.control-btn.active {
    background: rgba(59, 130, 246, 0.5);
}

.control-btn.danger {
    background: rgba(239, 68, 68, 0.2);
    border-color: #ef4444;
}

.control-btn.danger:hover {
    background: rgba(239, 68, 68, 0.5);
    box-shadow: 0 0 20px rgba(239, 68, 68, 0.3);
}

.material-icons {
    font-size: 24px;
}
```

#### Component 4: Side Panels

**Training Panel HTML:**
```html
<div id="side-panel" class="side-panel">
    <div class="panel-header">
        <h3>Training Mode</h3>
        <button id="closePanelBtn" class="close-btn">
            <span class="material-icons">close</span>
        </button>
    </div>
    
    <div class="panel-content">
        <label>Gesture Label:</label>
        <input id="labelInput" type="text" placeholder="e.g., HELLO">
        
        <button id="collectBtn" class="btn-primary">
            <span class="material-icons">camera_alt</span>
            Collect Frame
        </button>
        
        <div id="dataCount" class="stat">
            Frames Collected: <span>0</span>/200
        </div>
        
        <button id="trainBtn" class="btn-secondary">
            <span class="material-icons">school</span>
            Train Model
        </button>
        
        <button id="saveBtn" class="btn-secondary">
            <span class="material-icons">save</span>
            Save to Firebase
        </button>
        
        <button id="clearBtn" class="btn-danger">
            <span class="material-icons">delete</span>
            Clear All
        </button>
        
        <div id="trainStatus" class="status-text">Status: Idle</div>
    </div>
</div>
```

**Panel CSS:**
```css
.side-panel {
    position: fixed;
    right: 0;
    top: 0;
    height: 100%;
    width: 300px;
    background: var(--glass-bg);
    border-left: 1px solid var(--glass-border);
    backdrop-filter: blur(12px);
    z-index: 20;
    padding: 24px;
    overflow-y: auto;
    transform: translateX(400px);  /* Hidden by default */
    transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}

.side-panel.visible {
    transform: translateX(0);
}

.panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
    border-bottom: 1px solid var(--glass-border);
    padding-bottom: 16px;
}

.close-btn {
    background: transparent;
    border: none;
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
}

.panel-content label {
    display: block;
    margin-top: 16px;
    margin-bottom: 8px;
    font-size: 0.9rem;
    color: var(--text-muted);
}

.panel-content input {
    width: 100%;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--glass-border);
    padding: 10px;
    border-radius: 8px;
    color: white;
    margin-bottom: 16px;
}

.stat {
    background: rgba(0, 0, 0, 0.2);
    padding: 12px;
    border-radius: 8px;
    margin: 16px 0;
    font-size: 0.9rem;
}

.status-text {
    margin-top: 16px;
    padding: 12px;
    background: rgba(59, 130, 246, 0.1);
    border-left: 3px solid #3b82f6;
    border-radius: 4px;
    font-size: 0.85rem;
    color: #a5d6ff;
}
```

**Chat Panel HTML:**
```html
<div id="chat-panel" class="side-panel">
    <!-- Header same as above -->
    
    <div class="panel-content">
        <div id="chatMessages" class="chat-messages">
            <!-- Messages dynamically added -->
        </div>
        
        <input id="chatInput" 
               type="text" 
               placeholder="Type a message..." 
               class="chat-input">
        
        <button id="sendChatBtn" class="btn-primary">Send</button>
    </div>
</div>
```

**Chat CSS:**
```css
.chat-messages {
    height: 300px;
    overflow-y: auto;
    margin-bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.chat-message {
    padding: 12px;
    background: rgba(59, 130, 246, 0.1);
    border-radius: 8px;
    border-left: 3px solid #3b82f6;
    font-size: 0.9rem;
}

.chat-message.own {
    background: rgba(139, 92, 246, 0.1);
    border-left-color: #8b5cf6;
    align-self: flex-end;
    max-width: 80%;
}

.chat-message-name {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-bottom: 4px;
}

.chat-message-text {
    font-size: 0.9rem;
    color: white;
}

.chat-input {
    width: 100%;
    padding: 12px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    color: white;
    margin-bottom: 12px;
    font-family: var(--font-body);
}
```

---

### SCREEN 3: Live Translation (translation.html)

**Layout:**
```
┌─────────────────────────────────────┐
│  Header: Title | Mode Select        │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────┐   │
│  │   Your Camera               │   │
│  │   + Hand Landmarks Overlay  │   │
│  │                             │   │
│  │   Recognized: HELLO WORLD   │   │
│  │   Confidence: ████████░░ 89%│   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─ Sign Cards ────────────────┐   │
│  │ [🤟] [🖐] [✊] [👆] ...      │   │
│  │  H    E   L   L             │   │
│  └─────────────────────────────┘   │
│                                     │
│  [🎤 STT] [📢 TTS] [↩️ CLEAR]     │
│                                     │
│  ┌─ Caption Log ───────────────┐   │
│  │ 14:32 - HELLO               │   │
│  │ 14:33 - HOW ARE YOU         │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

**Key Differences from Video Call:**
- No remote video
- No chat panel needed
- Focus on gesture output
- Text-to-speech prominently displayed

---

### SCREEN 4: AI Training (training.html)

**Layout:**
```
┌─────────────────────────────────────┐
│  Title: AI Model Training           │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────┐   │
│  │   Your Camera               │   │
│  │   (Frame Collection Source) │   │
│  └─────────────────────────────┘   │
│                                     │
│  Label: [Dropdown or Input]         │
│  Frames: [████████░░ 45/200]       │
│                                     │
│  [📸 Collect] [🧪 Train]            │
│  [💾 Save]    [🗑️ Clear All]        │
│                                     │
│  Training Status: Ready             │
│                                     │
│  ┌─ Dataset Preview ────────────┐  │
│  │ Label    | Frames | Updated  │  │
│  │ HELLO    | 125    | 2h ago   │  │
│  │ HI       | 89     | 5m ago   │  │
│  └─────────────────────────────┘  │
└─────────────────────────────────────┘
```

---

## 🎨 CSS Variables Reference

```css
:root {
    /* Colors */
    --bg-color: #050510;
    --primary-color: #3b82f6;
    --secondary-color: #8b5cf6;
    --accent-color: #06b6d4;
    --danger-color: #ef4444;
    
    --text-main: #ffffff;
    --text-muted: #94a3b8;
    
    /* Glass Effect */
    --glass-bg: rgba(255, 255, 255, 0.03);
    --glass-border: rgba(255, 255, 255, 0.08);
    --glass-highlight: rgba(255, 255, 255, 0.1);
    
    /* Gradients */
    --gradient-primary: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
    
    /* Typography */
    --font-heading: 'Outfit', sans-serif;
    --font-body: 'Inter', sans-serif;
    
    /* Easing */
    --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
    --ease-elastic: cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

---

## 📐 Spacing & Sizing Scale

| Scale | Rem | Px | Usage |
|-------|-----|----|----- |
| 2xs | 0.5 | 8 | Micro gaps |
| xs | 0.75 | 12 | Small gaps |
| sm | 1 | 16 | Default padding |
| md | 1.5 | 24 | Section padding |
| lg | 2 | 32 | Large spacing |
| xl | 3 | 48 | Extra large gaps |

---

Great! Now you have comprehensive documentation to explain every aspect of the UI and the backend architecture! 🎉
