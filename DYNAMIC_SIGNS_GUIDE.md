# Dynamic Signs Feature Guide

## Overview

SignLink now supports **Dynamic Signs** - sign language gestures that involve movement and sequences of poses, in addition to static signs. This allows you to record and recognize complex signs like "Thank You", "Please", "Sorry", and other movements.

## What's New?

### 1. Two Types of Signs

- **Static Signs**: Single pose signs (letters A-Z, numbers, "Hello", etc.)
- **Dynamic Signs**: Movement-based signs that require a sequence of poses (2-3 seconds of movement)

### 2. Recording Mode Toggle

In the AI Training Studio, you can now switch between:
- **Static Mode**: Hold button to capture individual frames
- **Dynamic Mode**: Start/Stop recording to capture movement sequences

### 3. Dual Model Architecture

- **Static Model**: Dense Neural Network (existing)
- **Dynamic Model**: LSTM (Long Short-Term Memory) network for temporal sequence recognition

## How to Use

### Recording Dynamic Signs

1. **Open Training Studio**
   - Navigate to the AI Training page
   - Select your target language (ISL/ASL)

2. **Switch to Dynamic Mode**
   - Click the "Dynamic" button in the Recording Mode section
   - You'll see Start/Stop recording controls appear

3. **Enter Sign Name**
   - Type the name of the dynamic sign you want to record (e.g., "Thank You")

4. **Record the Sign**
   - Click "Start Recording"
   - Perform the sign movement (2-3 seconds, aim for 20-30 frames)
   - Click "Stop Recording" or wait for auto-stop at 30 frames
   - The recording indicator shows frame count and progress

5. **Record Multiple Samples**
   - Record the same sign 5-10 times from different angles
   - Try slight variations to improve model robustness

6. **Train the Model**
   - Once you have enough data (minimum 5 samples for 2+ signs), click "Train Model"
   - Both static and dynamic models will be trained automatically
   - Wait for training to complete

7. **Save to Application**
   - Click "Save to Application" to make models available in Live Translation and Video Call

### Using Dynamic Signs in Live Translation

1. **Open Translation Mode**
   - Navigate to Live Translation page
   - Models will load automatically (you'll see "Local Dynamic" in status)

2. **Perform Dynamic Signs**
   - Simply perform the sign movement in front of camera
   - The system maintains a 30-frame buffer
   - When a dynamic sign is detected, it shows with a 🔄 icon
   - The frame buffer clears after successful detection

3. **Combining Static and Dynamic**
   - You can mix static and dynamic signs freely
   - The system automatically selects the best prediction
   - Static signs respond immediately, dynamic signs need a full sequence

## Technical Details

### Data Structure

**Static Sign:**
```json
{
  "label": "Hello",
  "type": "static",
  "landmarks": [63 values]
}
```

**Dynamic Sign:**
```json
{
  "label": "Thank You",
  "type": "dynamic",
  "frames": [[63 values], [63 values], ...],
  "frameCount": 25,
  "recordedAt": 1234567890
}
```

### Model Architecture

**Static Model:**
- Dense(64) → Dropout(0.2) → Dense(32) → Dense(classes)
- Input: Single frame (63 features)

**Dynamic Model:**
- LSTM(64) → Dropout(0.2) → LSTM(32) → Dense(classes)
- Input: Sequence of 30 frames (30 × 63)
- Sequences are padded/truncated to 30 frames

### Frame Buffer Strategy

- Maintains sliding window of last 30 frames
- Captures at ~10 FPS during recording
- Predicts every frame during live recognition
- Minimum 15 frames required for dynamic prediction
- Buffer clears after high-confidence detection (>75%)

### Prediction Logic

1. All models (Server Static, Local Static, Local Dynamic) run simultaneously
2. Each generates confidence scores
3. Best prediction is selected (highest confidence)
4. Dynamic signs require >70% confidence
5. Static signs require >60% confidence
6. 🔄 icon indicates dynamic sign detection

## Storage

- Static models: `localStorage://my-isl-model-static`
- Dynamic models: `localStorage://my-isl-model-dynamic`
- Labels: `isl_labels-static` and `isl_labels-dynamic`
- Training data: `isl_data` (contains both types)

## Tips for Best Results

### Recording Dynamic Signs

1. **Consistent Speed**: Perform signs at consistent speed across samples
2. **Full Movement**: Capture the complete gesture from start to finish
3. **Lighting**: Ensure good lighting for hand detection
4. **Camera Distance**: Keep hands visible in frame throughout
5. **Multiple Samples**: Record 8-10 samples per sign for better accuracy

### Sign Design

1. **Distinct Movements**: Make dynamic signs clearly different from each other
2. **Optimal Duration**: 2-3 seconds is ideal (20-30 frames at 10 FPS)
3. **Avoid Ambiguity**: Don't create dynamic versions of static signs
4. **Natural Flow**: Use smooth, natural movements

### Performance

1. **Model Size**: Dynamic models are larger than static models
2. **Latency**: Dynamic signs have slight delay (~0.5-1 second) vs instant static
3. **Memory**: Frame buffer uses more memory
4. **Training Time**: LSTM models train faster (30 epochs vs 50)

## Troubleshooting

**"Recording too short" error:**
- Record for at least 1-1.5 seconds to capture 10+ frames

**Dynamic signs not detected:**
- Ensure you recorded enough training samples (5+ per sign)
- Check that the model was trained and saved
- Verify models loaded (check browser console)

**Low accuracy:**
- Record more samples (aim for 10+ per sign)
- Ensure consistent performance across samples
- Check hand is clearly visible throughout movement

**Model not saving:**
- Check browser console for errors
- Ensure localStorage has space
- Try exporting and re-importing data

## Example Dynamic Signs

**Good candidates for dynamic signs:**
- Thank You (hand moving from chin outward)
- Please (circular motion on chest)
- Sorry (fist circular motion on chest)
- Yes (head nod - if using head tracking)
- Help (hand raising motion)
- Come (beckoning motion)
- Go (pushing motion)

**Should remain static:**
- Individual letters (A-Z)
- Numbers (0-9)
- Simple gestures (OK, thumbs up)

## Python Training (Advanced)

For large datasets or offline training:

1. **Prepare Data:**
   - Export from training interface or use custom dataset
   - Separate static and dynamic data

2. **Train Models:**
   ```bash
   cd training
   python train.py
   ```

3. **Convert to TensorFlow.js:**
   ```bash
   tensorflowjs_converter --input_format keras isl_model_static.h5 ../public/model_static
   tensorflowjs_converter --input_format keras isl_model_dynamic.h5 ../public/model_dynamic
   ```

4. **Update Labels:**
   - Copy `labels_static.json` and `labels_dynamic.json` to public folder

## Future Enhancements

Potential improvements for future versions:
- Auto-segmentation (detect start/end of signs)
- Bidirectional LSTM for better accuracy
- Attention mechanism for key frame detection
- Video dataset import
- Real-time performance metrics
- Sign difficulty ratings
- Multi-hand dynamic signs

## Support

For issues or questions:
1. Check browser console for errors
2. Verify MediaPipe hands are detected
3. Ensure models are loaded successfully
4. Review this guide for best practices

---

**Note**: Dynamic signs feature is experimental and works best with clear, distinct movements. Static sign recognition remains the primary method for single-pose gestures.
