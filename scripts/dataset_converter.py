import cv2
import mediapipe as mp
import json
import os
import math
import sys

# Initialize MediaPipe Hands
mp_hands = mp.solutions.hands
# We use static_image_mode=True to ensure maximum accuracy on individual photos
hands = mp_hands.Hands(
    static_image_mode=True, 
    max_num_hands=1, 
    min_detection_confidence=0.5
)

def preprocess_landmarks(landmarks):
    """
    Converts raw MediaPipe landmarks into a translation and scale invariant 
    array of 63 numbers. This matches the JavaScript logic in script.js.
    """
    wrist = landmarks[0]
    
    # 1. Translation Invariance: Shift all points relative to the wrist (Origin 0,0,0)
    shifted = []
    for p in landmarks:
        shifted.append({
            'x': p.x - wrist.x,
            'y': p.y - wrist.y,
            'z': p.z - wrist.z
        })
    
    # 2. Scale Invariance: Normalize by distance from wrist to index finger MCP (landmark 5)
    index_mcp = shifted[5]
    distance = math.sqrt(index_mcp['x']**2 + index_mcp['y']**2 + index_mcp['z']**2) or 1e-6
    
    # 3. Flatten into a simple array of 63 numbers
    flat = []
    for p in shifted:
        flat.extend([p['x'] / distance, p['y'] / distance, p['z'] / distance])
    return flat

def convert_dataset(input_dir, output_file):
    dataset = []
    
    if not os.path.exists(input_dir):
        print(f"Error: Input directory '{input_dir}' not found.")
        return

    print(f"Scanning directory: {input_dir}")
    
    # Expecting subfolders named after labels (e.g., 'HELLO', 'THANK_YOU')
    labels = [f for f in os.listdir(input_dir) if os.path.isdir(os.path.join(input_dir, f))]
    
    if not labels:
        print("No subfolders (labels) found. Please organize your images into folders named after the signs.")
        return

    for label in labels:
        label_path = os.path.join(input_dir, label)
        print(f"\nProcessing label: [{label}]")
        
        files = [f for f in os.listdir(label_path) if f.lower().endswith(('.png', '.jpg', '.jpeg'))]
        success_count = 0
        
        for i, img_name in enumerate(files):
            img_path = os.path.join(label_path, img_name)
            
            # Progress indicator
            if (i + 1) % 10 == 0 or (i + 1) == len(files):
                sys.stdout.write(f"\r  Progress: {i + 1}/{len(files)} images...")
                sys.stdout.flush()

            image = cv2.imread(img_path)
            if image is None:
                continue
            
            # Convert to RGB (OpenCV default is BGR, MediaPipe needs RGB)
            image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            results = hands.process(image_rgb)
            
            if results.multi_hand_landmarks:
                for hand_landmarks in results.multi_hand_landmarks:
                    # We take only the first hand detected
                    processed = preprocess_landmarks(hand_landmarks.landmark)
                    dataset.append({
                        "label": label,
                        "landmarks": processed
                    })
                    success_count += 1
                    break 
        
        print(f"\n  Done: Extracted {success_count} samples for '{label}'.")

    # Save the final JSON
    with open(output_file, 'w') as f:
        json.dump(dataset, f)
    
    print(f"\n" + "="*40)
    print(f"SUCCESS: Total {len(dataset)} samples converted.")
    print(f"Dataset saved as: {output_file}")
    print("="*40)

if __name__ == "__main__":
    # You can change these paths as needed
    INPUT_FOLDER = "../dataset_photos" 
    OUTPUT_JSON = "../final_dataset.json"
    
    convert_dataset(INPUT_FOLDER, OUTPUT_JSON)
