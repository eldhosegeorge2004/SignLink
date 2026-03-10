import os
import cv2
import mediapipe as mp
import numpy as np
import json
import random
import shutil

# --- CONFIGURATION ---
# NOTE: This script is for converting pre-existing IMAGE datasets (like Kaggle ASL/ISL datasets)
# For dynamic signs recorded through the training interface, data is already in the correct format
# and this script is not needed. The training.js handles dynamic recording directly.

# UPDATE THIS PATH to where your dataset folder is located
# For ASL: r"..\\datasets\\American"
# For ISL: r"C:\\Users\\path\\to\\Indian"
DATASET_PATH = r"..\datasets\American"
OUTPUT_JSON = "../public/dataset.json"
OUTPUT_X = "X.npy"
OUTPUT_Y = "y.npy"
OUTPUT_LABELS = "labels.json"
MODEL_PATH = os.path.join(os.path.dirname(__file__), 'hand_landmarker.task')

# Optimization: Max samples per class to speed up processing
MAX_SAMPLES_PER_CLASS = 800
CHECKPOINT_DIR = "temp_checkpoints"

# Classes: 0-9, A-Z
CLASSES = [str(i) for i in range(10)] + [chr(i) for i in range(65, 91)]

# --- MEDIAPIPE TASKS SETUP ---
BaseOptions = mp.tasks.BaseOptions
HandLandmarker = mp.tasks.vision.HandLandmarker
HandLandmarkerOptions = mp.tasks.vision.HandLandmarkerOptions
VisionRunningMode = mp.tasks.vision.RunningMode

if not os.path.exists(MODEL_PATH):
    print(f"Error: Model file not found at {MODEL_PATH}")
    print("Please ensure 'hand_landmarker.task' is in the training directory.")
    exit(1)

options = HandLandmarkerOptions(
    base_options=BaseOptions(model_asset_path=MODEL_PATH),
    running_mode=VisionRunningMode.IMAGE,
    num_hands=1,
    min_hand_detection_confidence=0.5)

landmarker = HandLandmarker.create_from_options(options)

def preprocess_landmarks(landmarks):
    """
    Must match the JavaScript logic in training.js / translation.js
    1. Translation Invariance (Shift to wrist)
    2. Scale Invariance (Normalize by hand size)
    """
    wrist = landmarks[0]
    
    shifted = []
    for p in landmarks:
        shifted.append({
            'x': p.x - wrist.x,
            'y': p.y - wrist.y,
            'z': p.z - wrist.z
        })
        
    index_mcp = shifted[5]
    distance = np.sqrt(index_mcp['x']**2 + index_mcp['y']**2 + index_mcp['z']**2) + 1e-6
    
    flat_data = []
    for p in shifted:
        flat_data.append(p['x'] / distance)
        flat_data.append(p['y'] / distance)
        flat_data.append(p['z'] / distance)
        
    return flat_data

def main():
    if not os.path.exists(DATASET_PATH):
        print(f"ERROR: Dataset path not found: {DATASET_PATH}")
        return

    os.makedirs(CHECKPOINT_DIR, exist_ok=True)
    label_map = {label: idx for idx, label in enumerate(CLASSES)}
    processed_images = 0
    
    print(f"Scanning dataset at: {DATASET_PATH} (Max {MAX_SAMPLES_PER_CLASS} per class)")
    
    for label in CLASSES:
        checkpoint_X = os.path.join(CHECKPOINT_DIR, f"X_{label}.npy")
        checkpoint_json = os.path.join(CHECKPOINT_DIR, f"json_{label}.json")
        
        if os.path.exists(checkpoint_X) and os.path.exists(checkpoint_json):
            print(f"Skipping class: {label} (Found saved checkpoint)")
            continue
            
        label_dir = os.path.join(DATASET_PATH, label)
        if not os.path.exists(label_dir):
            print(f"Warning: Folder for label '{label}' not found. Skipping.")
            continue
            
        print(f"Processing class: {label}...")
        
        files = [f for f in os.listdir(label_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.gif'))]
        random.seed(42) # Consistent sampling if re-run
        random.shuffle(files)
        files = files[:MAX_SAMPLES_PER_CLASS]
        
        class_X = []
        class_json = []
        class_count = 0
        
        for i, file_name in enumerate(files):
            img_path = os.path.join(label_dir, file_name)
            image = cv2.imread(img_path)
            if image is None:
                continue
            
            image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=image_rgb)
            detection_result = landmarker.detect(mp_image)
            
            if detection_result.hand_landmarks:
                flat_landmarks = preprocess_landmarks(detection_result.hand_landmarks[0])
                if len(flat_landmarks) == 63:
                    class_X.append(flat_landmarks)
                    class_json.append({
                        "label": label,
                        "landmarks": [round(x, 6) for x in flat_landmarks]
                    })
                    class_count += 1
            
            if i % 50 == 0:
                print(f"  Processed {i}/{len(files)} images...", end='\r')
                
        print(f"  Finished class {label}. Valid samples: {class_count}")
        
        # Save checkpoint for this class
        np.save(checkpoint_X, np.array(class_X))
        with open(checkpoint_json, 'w') as f:
            json.dump(class_json, f)

    print("\nAll classes processed! Merging checkpoints...")
    
    # Merge Phase
    final_X = []
    final_y = []
    final_json = []
    
    for label in CLASSES:
        checkpoint_X = os.path.join(CHECKPOINT_DIR, f"X_{label}.npy")
        checkpoint_json = os.path.join(CHECKPOINT_DIR, f"json_{label}.json")
        
        if os.path.exists(checkpoint_X) and os.path.exists(checkpoint_json):
            X_arr = np.load(checkpoint_X)
            if len(X_arr) > 0:
                final_X.extend(X_arr.tolist())
                final_y.extend([label_map[label]] * len(X_arr))
                
            with open(checkpoint_json, 'r') as f:
                data = json.load(f)
                final_json.extend(data)
                processed_images += len(data)

    if processed_images == 0:
        print("No samples collected. Exiting.")
        return

    # Save NPY files
    print("Saving final X.npy and y.npy...")
    np.save(OUTPUT_X, np.array(final_X))
    
    y_indices = np.array(final_y)
    y_one_hot = np.eye(len(CLASSES))[y_indices] 
    np.save(OUTPUT_Y, y_one_hot)
    
    with open(OUTPUT_LABELS, 'w') as f:
        json.dump(CLASSES, f)
        
    print(f"Saved numpy files in {os.getcwd()}")
    
    # Save the huge JSON map
    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    print(f"Saving {OUTPUT_JSON}...")
    try:
        with open(OUTPUT_JSON, 'w') as f:
            json.dump(final_json, f)
        print("Saved dataset.json!")
    except Exception as e:
        print(f"Error saving JSON: {e}")
        
    print("Cleaning up temporary checkpoints...")
    try:
        shutil.rmtree(CHECKPOINT_DIR)
    except Exception as e:
        print(f"Warning: could not delete temp folder: {e}")

    print(f"Done! Total valid samples in final dataset: {processed_images}")

if __name__ == "__main__":
    main()
