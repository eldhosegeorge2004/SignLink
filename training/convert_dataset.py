import os
import cv2
import mediapipe as mp
import numpy as np
import json

# --- CONFIGURATION ---
# UPDATE THIS PATH to where your "Indian" folder is located
DATASET_PATH = r"C:\Users\shali\OneDrive\Desktop\Shalin\Project Phase 2\archive\Indian" 

OUTPUT_JSON = "../public/dataset.json"
OUTPUT_X = "X.npy"
OUTPUT_Y = "y.npy"
OUTPUT_LABELS = "labels.json"
MODEL_PATH = os.path.join(os.path.dirname(__file__), 'hand_landmarker.task')

# Classes: 0-9, A-Z
CLASSES = [str(i) for i in range(10)] + [chr(i) for i in range(65, 91)]

# --- MEDIAPIPE TASKS SETUP ---
BaseOptions = mp.tasks.BaseOptions
HandLandmarker = mp.tasks.vision.HandLandmarker
HandLandmarkerOptions = mp.tasks.vision.HandLandmarkerOptions
VisionRunningMode = mp.tasks.vision.RunningMode

# Check if model exists
if not os.path.exists(MODEL_PATH):
    print(f"Error: Model file not found at {MODEL_PATH}")
    print("Please ensure 'hand_landmarker.task' is in the training directory.")
    exit(1)

# Create a landmarker instance with the image mode:
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
    # Landmarks is a list of objects with x, y, z
    
    # 1. Get Wrist
    wrist = landmarks[0]
    
    # 2. Shift
    shifted = []
    for p in landmarks:
        shifted.append({
            'x': p.x - wrist.x,
            'y': p.y - wrist.y,
            'z': p.z - wrist.z
        })
        
    # 3. Calculate Scale (Distance from Wrist to Index MCP (id 5))
    index_mcp = shifted[5]
    distance = np.sqrt(index_mcp['x']**2 + index_mcp['y']**2 + index_mcp['z']**2) + 1e-6
    
    # 4. Normalize and Flatten
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

    data_for_json = [] 
    X_data = []
    y_data = []
    
    label_map = {label: idx for idx, label in enumerate(CLASSES)}
    
    print(f"Scanning dataset at: {DATASET_PATH}")
    
    processed_images = 0
    
    for label in CLASSES:
        label_dir = os.path.join(DATASET_PATH, label)
        if not os.path.exists(label_dir):
            print(f"Warning: Folder for label '{label}' not found. Skipping.")
            continue
            
        print(f"Processing class: {label}...")
        
        files = os.listdir(label_dir)
        class_count = 0
        
        for i, file_name in enumerate(files):
            if not file_name.lower().endswith(('.jpg', '.jpeg', '.png')):
                continue
                
            img_path = os.path.join(label_dir, file_name)
            image = cv2.imread(img_path)
            if image is None:
                continue
            
            # Convert to RGB for MediaPipe
            image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            
            # Create MP Image
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=image_rgb)
            
            # Detect
            detection_result = landmarker.detect(mp_image)
            
            if detection_result.hand_landmarks:
                # Take the first hand
                landmarks_list = detection_result.hand_landmarks[0]
                
                # Preprocess
                flat_landmarks = preprocess_landmarks(landmarks_list)
                
                # Verify size
                if len(flat_landmarks) == 63:
                    X_data.append(flat_landmarks)
                    y_data.append(label_map[label])
                    
                    # For JSON
                    rounded_landmarks = [round(x, 6) for x in flat_landmarks]
                    data_for_json.append({
                        "label": label,
                        "landmarks": rounded_landmarks
                    })
                    
                    processed_images += 1
                    class_count += 1
            
            if i % 100 == 0:
                print(f"  Processed {i}/{len(files)} images...", end='\r')
        
        print(f"  Finished class {label}. Valid samples: {class_count}")

    print(f"\nProcessing Complete!")
    print(f"Total valid samples: {processed_images}")
    
    if processed_images == 0:
        print("No samples collected. Exiting.")
        return

    # Save NPY
    print("Saving X.npy and y.npy...")
    np.save(OUTPUT_X, np.array(X_data))
    
    # Create One-Hot Encoding for y
    y_indices = np.array(y_data)
    y_one_hot = np.eye(len(CLASSES))[y_indices] 
    np.save(OUTPUT_Y, y_one_hot)
    
    # Save Labels Mapping
    with open(OUTPUT_LABELS, 'w') as f:
        json.dump(CLASSES, f)
        
    print(f"Saved numpy files in {os.getcwd()}")
    
    # Save JSON
    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    print(f"Saving {OUTPUT_JSON}...")
    try:
        with open(OUTPUT_JSON, 'w') as f:
            json.dump(data_for_json, f)
        print("Saved dataset.json!")
    except Exception as e:
        print(f"Error saving JSON: {e}")

if __name__ == "__main__":
    main()
