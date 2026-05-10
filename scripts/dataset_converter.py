# ==================== DATASET CONVERTER ====================
# This script converts a folder of sign language images into a JSON dataset.
# It uses MediaPipe to extract hand landmarks from images and normalizes them.
# The output is a JSON file with landmarks for training AI models.

# ==================== IMPORTS ====================
import cv2  # OpenCV library for image processing
import mediapipe as mp  # MediaPipe library for hand detection
import json  # JSON library for data serialization
import os  # Operating system library for file operations
import math  # Math library for calculations
import sys  # System library for stdout operations

# ==================== MEDIAPIPE HANDS INITIALIZATION ====================
# Initialize MediaPipe Hands for hand landmark detection
mp_hands = mp.solutions.hands  # Access the Hands solution from MediaPipe

# We use static_image_mode=True to ensure maximum accuracy on individual photos
# This setting is optimized for processing single images rather than video streams
hands = mp_hands.Hands(
    static_image_mode=True,  # Treat each image as independent (better accuracy)
    max_num_hands=1,  # Detect only one hand per image
    min_detection_confidence=0.5  # Minimum confidence threshold (0.0 to 1.0)
)

# ==================== LANDMARK PREPROCESSING FUNCTION ====================
def preprocess_landmarks(landmarks):
    """
    Converts raw MediaPipe landmarks into a translation and scale invariant
    array of 63 numbers. This matches the JavaScript logic in script.js.
    
    Translation invariance: All landmarks are shifted so the wrist is at origin (0,0,0)
    Scale invariance: All landmarks are normalized by the distance from wrist to index finger MCP
    """
    wrist = landmarks[0]  # Get wrist landmark (landmark 0)

    # 1. Translation Invariance: Shift all points relative to the wrist (Origin 0,0,0)
    shifted = []  # List to store shifted landmarks
    for p in landmarks:  # Loop through all 21 landmarks
        shifted.append({  # Add shifted coordinates
            "x": p.x - wrist.x,  # Shift x relative to wrist
            "y": p.y - wrist.y,  # Shift y relative to wrist
            "z": p.z - wrist.z  # Shift z relative to wrist
        })

    # 2. Scale Invariance: Normalize by distance from wrist to index finger MCP (landmark 5)
    index_mcp = shifted[5]  # Get index finger MCP joint (landmark 5)
    # Calculate Euclidean distance from wrist to index MCP
    distance = math.sqrt(index_mcp["x"]**2 + index_mcp["y"]**2 + index_mcp["z"]**2) or 1e-6  # Avoid division by zero
    
    # 3. Flatten into a simple array of 63 numbers (21 landmarks * 3 coordinates)
    flat = []  # List to store flattened coordinates
    for p in shifted:  # Loop through shifted landmarks
        flat.extend([  # Add normalized coordinates
            p["x"] / distance,  # Normalized x
            p["y"] / distance,  # Normalized y
            p["z"] / distance  # Normalized z
        ])
    return flat  # Return flattened array

# ==================== DATASET CONVERSION FUNCTION ====================
def convert_dataset(input_dir, output_file):
    """
    Converts a folder of images organized by label into a JSON dataset.
    
    Expected structure:
    input_dir/
        +-- HELLO/
        ¦   +-- image1.jpg
        ¦   +-- image2.jpg
        ¦   +-- ...
        +-- THANK_YOU/
        ¦   +-- image1.jpg
        ¦   +-- ...
        +-- ...
    
    Output: JSON file with format:
    [
        {"label": "HELLO", "landmarks": [x1, y1, z1, x2, y2, z2, ...]},
        {"label": "THANK_YOU", "landmarks": [...]},
        ...
    ]
    """
    dataset = []  # List to store all processed samples

    # Check if input directory exists
    if not os.path.exists(input_dir):
        print("Error: Input directory not found.")  # Print error
        return  # Exit function

    print("Scanning directory: " + input_dir)  # Print progress

    # Expecting subfolders named after labels (e.g., "HELLO", "THANK_YOU")
    labels = [f for f in os.listdir(input_dir) if os.path.isdir(os.path.join(input_dir, f))]  # Get all subdirectories
    
    if not labels:  # Check if any labels found
        print("No subfolders (labels) found. Please organize your images into folders named after the signs.")  # Print error
        return  # Exit function

    # Process each label folder
    for label in labels:  # Loop through each label
        label_path = os.path.join(input_dir, label)  # Get full path to label folder
        print("\nProcessing label: [" + label + "]")  # Print progress

        # Get all image files in the label folder
        files = [f for f in os.listdir(label_path) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.gif'))]  # Filter image files
        success_count = 0  # Track successful extractions

        # Process each image file
        for i, img_name in enumerate(files):  # Loop through files with index
            img_path = os.path.join(label_path, img_name)  # Get full image path

            # Progress indicator (show every 10 images or at the end)
            if (i + 1) % 10 == 0 or (i + 1) == len(files):
                sys.stdout.write("\r  Progress: " + str(i + 1) + "/" + str(len(files)) + " images...")  # Write progress
                sys.stdout.flush()  # Flush output

            image = cv2.imread(img_path)  # Read image using OpenCV
            if image is None:  # Check if image loaded successfully
                continue  # Skip to next image if failed

            # Convert to RGB (OpenCV default is BGR, MediaPipe needs RGB)
            image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)  # Convert color space
            results = hands.process(image_rgb)  # Process image with MediaPipe Hands

            # Check if any hands were detected
            if results.multi_hand_landmarks:  # If hands detected
                for hand_landmarks in results.multi_hand_landmarks:  # Loop through detected hands
                    # We take only the first hand detected
                    processed = preprocess_landmarks(hand_landmarks.landmark)  # Preprocess landmarks
                    dataset.append({  # Add to dataset
                        "label": label,  # Sign label
                        "landmarks": processed  # Processed landmarks
                    })
                    success_count += 1  # Increment success counter
                    break  # Only process first hand

        print("\n  Done: Extracted " + str(success_count) + " samples for " + label + ".")  # Print completion
    
    # Save the final JSON file
    with open(output_file, 'w') as f:  # Open file for writing
        json.dump(dataset, f)  # Write dataset as JSON

    # Print summary
    print("\n" + "="*40)  # Print separator
    print("SUCCESS: Total " + str(len(dataset)) + " samples converted.")  # Print total
    print("Dataset saved as: " + output_file)  # Print output path
    print("="*40)  # Print separator

# ==================== MAIN EXECUTION ====================
if __name__ == "__main__":  # Run only when executed directly (not when imported)
    # You can change these paths as needed
    INPUT_FOLDER = "../dataset_photos"  # Input folder with organized images
    OUTPUT_JSON = "../final_dataset.json"  # Output JSON file path

    convert_dataset(INPUT_FOLDER, OUTPUT_JSON)  # Run conversion
